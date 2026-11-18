import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // onnxruntime-web ships its own wasm loader; pre-bundling it breaks the wasm lookup
  optimizeDeps: { exclude: ['onnxruntime-web'] },
  worker: { format: 'es' },
})
