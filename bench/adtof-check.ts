/**
 * Proves the TypeScript ADTOF path matches the PyTorch reference:
 *   npx tsx bench/adtof-check.ts local/adtof <wav> [<wav> …]
 * (reference files come from tools/adtof_export.py)
 */
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import * as ort from 'onnxruntime-web';
import { adtofSpectrogram } from '../src/engine/chart/adtofSpec';
import { createAdtof, runAdtof } from '../src/engine/chart/adtof';
import { decodeFile } from './audio';

const [dir, ...wavs] = process.argv.slice(2);
ort.env.wasm.numThreads = 1;
const rt = await createAdtof(ort, readFileSync(`${dir}/adtof-cnn.onnx`), readFileSync(`${dir}/adtof-rnn.onnx`));
for (const wav of wavs) {
  const stem = `${dir}/${basename(wav).replace(/\.[^.]+$/, '').replace(/ /g, '_')}`;
  const meta = JSON.parse(readFileSync(`${stem}.json`, 'utf8'));
  const refSpec = new Float32Array(readFileSync(`${stem}.spec.f32`).buffer.slice(0));
  const refAct = new Float32Array(readFileSync(`${stem}.act.f32`).buffer.slice(0));
  const samples = decodeFile(wav);
  const t0 = performance.now();
  const spec = adtofSpectrogram(samples);
  const t1 = performance.now();
  const act = await runAdtof(rt, spec);
  const t2 = performance.now();
  let specMax = 0;
  let specMean = 0;
  for (let i = 0; i < Math.min(refSpec.length, spec.data.length); i++) {
    const d = Math.abs(refSpec[i] - spec.data[i]);
    specMax = Math.max(specMax, d);
    specMean += d;
  }
  specMean /= refSpec.length;
  let actMax = 0;
  for (let i = 0; i < Math.min(refAct.length, act.length); i++) actMax = Math.max(actMax, Math.abs(refAct[i] - act[i]));
  console.log(
    `${basename(wav)}: frames ts=${spec.frames} ref=${meta.frames} bins ts=${spec.bins} ref=${meta.bins} | spec max|d|=${specMax.toExponential(2)} mean=${specMean.toExponential(2)} | act max|d|=${actMax.toExponential(2)} | spec ${((t1 - t0) / 1000).toFixed(2)}s model ${((t2 - t1) / 1000).toFixed(2)}s for ${(samples.length / 44100).toFixed(0)}s audio`,
  );
}
