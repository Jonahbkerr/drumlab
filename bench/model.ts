import { readFileSync } from 'node:fs';
import * as ort from 'onnxruntime-web';
import { createAdtof } from '../src/engine/chart/adtof';
import type { AdtofRuntime } from '../src/engine/chart/adtof';
import { createDemucs } from '../src/engine/chart/demucs';
import type { DemucsRuntime } from '../src/engine/chart/demucs';

ort.env.wasm.numThreads = 1;

let rt: Promise<AdtofRuntime> | null = null;
let demucs: Promise<DemucsRuntime> | null = null;

/** wasm threads; must be set before the first session is created */
export function setThreads(n: number) {
  ort.env.wasm.numThreads = n;
}

/** the same ONNX files the app serves, run through onnxruntime-web's wasm backend */
export function loadModel(): Promise<AdtofRuntime> {
  rt ??= createAdtof(ort, readFileSync('public/models/adtof-cnn.onnx'), readFileSync('public/models/adtof-rnn.onnx'));
  return rt;
}

/** Demucs drums model (downloaded to local/models/demucs/, not in git) */
export const DEMUCS_PATH = 'local/models/demucs/htdemucs_ft_drums_safe16.onnx';
export function loadDemucs(): Promise<DemucsRuntime> {
  demucs ??= createDemucs(ort, readFileSync(DEMUCS_PATH));
  return demucs;
}
