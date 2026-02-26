import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { viteStaticCopy } from 'vite-plugin-static-copy'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    viteStaticCopy({
      targets: [
        {
          src: 'node_modules/@undecaf/zbar-wasm/dist/zbar.wasm',
          dest: ''
        },
        {
          src: 'node_modules/@vladmandic/face-api/model/ssd_mobilenetv1_model.bin',
          dest: 'models'
        },
        {
          src: 'node_modules/@vladmandic/face-api/model/ssd_mobilenetv1_model-weights_manifest.json',
          dest: 'models'
        },
        {
          src: 'node_modules/@vladmandic/face-api/model/face_landmark_68_model.bin',
          dest: 'models'
        },
        {
          src: 'node_modules/@vladmandic/face-api/model/face_landmark_68_model-weights_manifest.json',
          dest: 'models'
        },
        {
          src: 'node_modules/@vladmandic/face-api/model/face_recognition_model.bin',
          dest: 'models'
        },
        {
          src: 'node_modules/@vladmandic/face-api/model/face_recognition_model-weights_manifest.json',
          dest: 'models'
        },
        {
          src: 'node_modules/@vladmandic/face-api/model/tiny_face_detector_model.bin',
          dest: 'models'
        },
        {
          src: 'node_modules/@vladmandic/face-api/model/tiny_face_detector_model-weights_manifest.json',
          dest: 'models'
        }
      ]
    })
  ],
  optimizeDeps: {
    exclude: ['@undecaf/zbar-wasm']
  }
})
