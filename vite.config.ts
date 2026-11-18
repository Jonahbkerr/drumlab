import react from '@vitejs/plugin-react'
import { defaultClientConditions, defineConfig } from 'vite'

const ISOLATION = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'credentialless',
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // onnxruntime-web's "extern wasm" build loads its wasm glue (.mjs) and wasm
  // from URLs we pass (worker.ts). Its default build inlines the glue, and the
  // thread workers it starts then look for a file the production build does
  // not have, so analysis hung on "Loading the drum model" once threads were on.
  resolve: { conditions: ['onnxruntime-web-use-extern-wasm', ...defaultClientConditions] },
  // onnxruntime-web ships its own wasm loader; pre-bundling it breaks the wasm lookup
  optimizeDeps: { exclude: ['onnxruntime-web'] },
  worker: { format: 'es' },
  // cross-origin isolation lets onnxruntime use several threads, which drum
  // separation needs (one thread is ~8x slower). 'credentialless' still allows
  // the CORS fetch of the separation model from Hugging Face.
  server: { headers: ISOLATION },
  preview: { headers: ISOLATION },
})
