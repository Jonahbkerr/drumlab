/// <reference lib="webworker" />
/**
 * Runs song analysis (drum model + beat tracking) off the main thread so the
 * UI stays responsive. Models load once per worker and stay warm.
 */
import * as ort from 'onnxruntime-web/wasm';
import wasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.wasm?url';
import { createAdtof } from './adtof';
import type { AdtofRuntime } from './adtof';
import { analyzeSamples } from './pipeline';

ort.env.wasm.wasmPaths = { wasm: wasmUrl };
// threads need cross-origin isolation; one thread does a 4-min song in ~5 s
ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 1) : 1;

export interface AnalyzeRequest {
  id: number;
  samples: Float32Array;
  bpm?: number;
}

let runtime: Promise<AdtofRuntime> | null = null;

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
  const { id, samples, bpm } = e.data;
  try {
    runtime ??= loadRuntime();
    const rt = await runtime;
    const analysis = await analyzeSamples(samples, rt, { bpm }, (stage, p) =>
      self.postMessage({ id, type: 'progress', stage, p }),
    );
    self.postMessage({ id, type: 'done', analysis });
  } catch (err) {
    runtime = null;
    self.postMessage({ id, type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
