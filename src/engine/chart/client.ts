import type { ChartAnalysis } from './pipeline';

type Msg =
  | { id: number; type: 'progress'; stage: string; p: number }
  | { id: number; type: 'done'; analysis: ChartAnalysis }
  | { id: number; type: 'error'; message: string };

interface Pending {
  resolve: (a: ChartAnalysis) => void;
  reject: (e: Error) => void;
  onProgress?: (stage: string, p: number) => void;
}

let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, Pending>();

function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (e: MessageEvent<Msg>) => {
    const m = e.data;
    const p = pending.get(m.id);
    if (!p) return;
    if (m.type === 'progress') p.onProgress?.(m.stage, m.p);
    else {
      pending.delete(m.id);
      if (m.type === 'done') p.resolve(m.analysis);
      else p.reject(new Error(m.message));
    }
  };
  worker.onerror = (e) => {
    for (const p of pending.values()) p.reject(new Error(e.message || 'analysis worker crashed'));
    pending.clear();
    worker?.terminate();
    worker = null;
  };
  return worker;
}

/** Analyse 44.1 kHz mono samples in the background. The samples buffer is transferred. */
export function analyzeInWorker(
  samples: Float32Array,
  opts: { bpm?: number } = {},
  onProgress?: (stage: string, p: number) => void,
): Promise<ChartAnalysis> {
  const w = getWorker();
  const id = ++seq;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject, onProgress });
    w.postMessage({ id, kind: 'analyze', samples, bpm: opts.bpm }, [samples.buffer]);
  });
}

/**
 * Separate the drums from a stereo 44.1 kHz mix (Demucs) and analyze the drum
 * stem. Stages: 'download' (the model, first time only), 'separate', then the
 * analysis stages. The sample buffers are transferred.
 */
export function analyzeStemInWorker(
  left: Float32Array,
  right: Float32Array,
  onProgress?: (stage: string, p: number) => void,
): Promise<ChartAnalysis> {
  const w = getWorker();
  const id = ++seq;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject, onProgress });
    w.postMessage({ id, kind: 'stem', left, right }, [left.buffer, right.buffer]);
  });
}
