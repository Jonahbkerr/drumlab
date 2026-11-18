import { execFileSync } from 'node:child_process';

/** decode any audio file to mono float32 via ffmpeg */
export function decodeFile(path: string, sr = 44100): Float32Array {
  const buf = execFileSync('ffmpeg', ['-v', 'quiet', '-i', path, '-ac', '1', '-ar', String(sr), '-f', 'f32le', '-'], {
    maxBuffer: 1 << 30,
  });
  return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
}

/** decode to stereo float32 at 44.1 kHz (left, right) via ffmpeg */
export function decodeStereo(path: string, sr = 44100): [Float32Array, Float32Array] {
  const buf = execFileSync('ffmpeg', ['-v', 'quiet', '-i', path, '-ac', '2', '-ar', String(sr), '-f', 'f32le', '-'], {
    maxBuffer: 1 << 30,
  });
  const inter = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
  const n = inter.length >> 1;
  const l = new Float32Array(n);
  const r = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    l[i] = inter[2 * i];
    r[i] = inter[2 * i + 1];
  }
  return [l, r];
}
