/// <reference lib="webworker" />
/**
 * Runs song analysis (drum model + beat tracking) and drum separation
 * (Demucs) off the main thread so the UI stays responsive. Models load once
 * per worker and stay warm.
 */
// the WebGPU build also runs the CPU (wasm) backend. Its glue and wasm are
// emitted as files and passed by URL (see resolve.conditions in vite.config).
import * as ort from 'onnxruntime-web/webgpu';
import glueUrl from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.mjs?url';
import wasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url';
import { createAdtof } from './adtof';
import type { AdtofRuntime } from './adtof';
import { analyzeSamples } from './pipeline';
import { createDemucs, matchesCpu, separateDrums } from './demucs';
import { cpuSignature } from './demucs-check';
import type { DemucsRuntime } from './demucs';
import { DEMUCS_CPU_NODES, loadDemucsModel } from './stemmodel';

ort.env.wasm.wasmPaths = { mjs: glueUrl, wasm: wasmUrl };
// the separation model logs harmless 'cannot constant fold' warnings as console errors
ort.env.logLevel = 'error';
// threads need cross-origin isolation (vite.config sets the headers). The drum
// model does a 4-min song in ~5 s on one thread; separation needs them all.
ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(8, navigator.hardwareConcurrency || 1) : 1;

export type AnalyzeRequest =
  /** drum hits + beats from a mono mix */
  | { id: number; kind: 'analyze'; samples: Float32Array; bpm?: number }
  /** separate the drums from a stereo mix, then analyze the drum stem */
  | { id: number; kind: 'stem'; left: Float32Array; right: Float32Array };

let runtime: Promise<AdtofRuntime> | null = null;
let demucs: Promise<DemucsRuntime> | null = null;

/**
 * Separation runs on the GPU (WebGPU) when there is one and it gives the
 * CPU's answer on a test segment (~6x faster: 0.9 s per 7.8 s segment on an
 * M-series Mac); otherwise on the CPU with all threads.
 */
async function loadDemucs(onDownload: (p: number) => void, onPrepare: () => void): Promise<DemucsRuntime> {
  const bytes = await loadDemucsModel(onDownload);
  onPrepare();
  const nav = self.navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } };
  const adapter = await nav.gpu?.requestAdapter().catch(() => null);
  if (adapter) {
    let gpu: DemucsRuntime | null = null;
    try {
      gpu = await createDemucs(ort, bytes, [{ name: 'webgpu', forceCpuNodeNames: DEMUCS_CPU_NODES }]);
      const check = await matchesCpu(gpu, cpuSignature());
      if (check.ok) return gpu;
      console.warn(`drum separation: GPU result differs from CPU (corr ${check.corr.toFixed(3)}), using the CPU`);
      await gpu.session.release();
    } catch (err) {
      console.warn('drum separation: WebGPU unavailable, using the CPU', err);
      await gpu?.session.release().catch(() => {});
    }
  }
  return createDemucs(ort, bytes, ['wasm']);
}

async function loadRuntime(): Promise<AdtofRuntime> {
  const base = import.meta.env.BASE_URL;
  const [cnn, rnn] = await Promise.all(
    ['adtof-cnn', 'adtof-rnn'].map(async (name) => {
      const res = await fetch(`${base}models/${name}.onnx`);
      if (!res.ok) throw new Error(`model ${name} failed to load (${res.status})`);
      return new Uint8Array(await res.arrayBuffer());
    }),
  );
  return createAdtof(ort, cnn, rnn);
}

self.onmessage = async (e: MessageEvent<AnalyzeRequest>) => {
  const req = e.data;
  const { id } = req;
  const progress = (stage: string, p: number) => self.postMessage({ id, type: 'progress', stage, p });
  try {
    runtime ??= loadRuntime();
    if (req.kind === 'stem') {
      demucs ??= loadDemucs(
        (p) => progress('download', p),
        () => progress('prepare', 0),
      );
      let drums: Float32Array;
      try {
        drums = await separateDrums(await demucs, req.left, req.right, (p) => progress('separate', p));
      } catch (err) {
        demucs = null;
        throw err;
      }
      const analysis = await analyzeSamples(drums, await runtime, {}, progress);
      self.postMessage({ id, type: 'done', analysis });
      return;
    }
    const analysis = await analyzeSamples(req.samples, await runtime, { bpm: req.bpm }, progress);
    self.postMessage({ id, type: 'done', analysis });
  } catch (err) {
    runtime = null;
    self.postMessage({ id, type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
