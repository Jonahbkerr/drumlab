import { readFileSync } from 'node:fs';
import * as ort from 'onnxruntime-web';
import { createAdtof } from '../src/engine/chart/adtof';
import type { AdtofRuntime } from '../src/engine/chart/adtof';

let rt: Promise<AdtofRuntime> | null = null;

/** the same ONNX files the app serves, run through onnxruntime-web's wasm backend */
export function loadModel(): Promise<AdtofRuntime> {
  ort.env.wasm.numThreads = 1;
  rt ??= createAdtof(ort, readFileSync('public/models/adtof-cnn.onnx'), readFileSync('public/models/adtof-rnn.onnx'));
  return rt;
}
