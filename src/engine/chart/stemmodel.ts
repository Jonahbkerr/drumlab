/**
 * The Demucs drums model: 88 MB, fetched once from Hugging Face, checked
 * against its published SHA-256, then kept in the browser's Cache Storage.
 * Development builds try the local copy first (local/models/demucs/, see
 * README) so tests do not download it again.
 */
export const DEMUCS_FILE = 'htdemucs_ft_drums_safe16.onnx';
export const DEMUCS_URL = `https://huggingface.co/monteslu/htdemucs-ft-webgpu/resolve/main/${DEMUCS_FILE}`;
export const DEMUCS_SHA256 = '5943fde7eff1d73e154f58095df64aad999d6ecf328a5497506bcd63ba034364';
export const DEMUCS_BYTES = 87695109;
const CACHE = 'drumlab-models-v1';

/**
 * Nodes of this exact model file (pinned by its SHA-256) that must run on
 * the CPU when the rest runs on WebGPU, where fp16 breaks them: the input
 * normalization (sums over 2.75M values overflow fp16 -> NaN) and the time
 * decoder's 1-D transposed convolutions (wrong output on WebGPU; found by
 * comparing each branch with the CPU result, local/webgpu-check.ts).
 */
export const DEMUCS_CPU_NODES = [
  '/ReduceMean',
  '/Sub',
  '/Pow',
  '/ReduceMean_1',
  '/Clip',
  '/Sqrt',
  '/Add',
  '/Div',
  '/ReduceMean_2',
  '/Sub_1',
  '/Pow_1',
  '/ReduceMean_3',
  '/Clip_1',
  '/Sqrt_1',
  '/Add_1',
  '/Div_1',
  '/tdecoder.0/conv_tr/ConvTranspose',
  '/tdecoder.1/conv_tr/ConvTranspose',
  '/tdecoder.2/conv_tr/ConvTranspose',
  '/tdecoder.3/conv_tr/ConvTranspose',
];

async function sha256(bytes: Uint8Array): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>);
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, '0')).join('');
}

async function download(url: string, onProgress?: (p: number) => void): Promise<Uint8Array | null> {
  const res = await fetch(url);
  if (!res.ok || !res.body) return null;
  const total = Number(res.headers.get('content-length')) || DEMUCS_BYTES;
  const out = new Uint8Array(Math.max(total, DEMUCS_BYTES));
  const reader = res.body.getReader();
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (n + value.length > out.length) return null; // not the file we expect
    out.set(value, n);
    n += value.length;
    onProgress?.(Math.min(1, n / total));
  }
  return out.subarray(0, n);
}

/** the model bytes, from cache, the dev copy, or Hugging Face (verified) */
export async function loadDemucsModel(onProgress?: (p: number) => void): Promise<Uint8Array> {
  const cache = typeof caches !== 'undefined' ? await caches.open(CACHE) : null;
  const hit = await cache?.match(DEMUCS_URL);
  if (hit) return new Uint8Array(await hit.arrayBuffer());

  const sources = import.meta.env.DEV ? [`/local/models/demucs/${DEMUCS_FILE}`, DEMUCS_URL] : [DEMUCS_URL];
  for (const src of sources) {
    let bytes: Uint8Array | null = null;
    try {
      bytes = await download(src, onProgress);
    } catch {
      bytes = null;
    }
    if (!bytes || bytes.length !== DEMUCS_BYTES || (await sha256(bytes)) !== DEMUCS_SHA256) continue;
    await cache?.put(DEMUCS_URL, new Response(bytes as Uint8Array<ArrayBuffer>, { headers: { 'content-type': 'application/octet-stream' } }));
    return bytes;
  }
  throw new Error('could not download the drum separation model');
}
