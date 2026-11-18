import { execFileSync } from 'node:child_process';

/** decode any audio file to mono float32 via ffmpeg */
export function decodeFile(path: string, sr = 44100): Float32Array {
  const buf = execFileSync('ffmpeg', ['-v', 'quiet', '-i', path, '-ac', '1', '-ar', String(sr), '-f', 'f32le', '-'], {
    maxBuffer: 1 << 30,
  });
  return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
}
