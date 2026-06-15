import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const rootDir = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(rootDir, 'src'),
      '@daily-feed': path.resolve(rootDir, 'src/daily-feed'),
      '@platforms': path.resolve(rootDir, 'src/platforms'),
      '@shared': path.resolve(rootDir, 'src/shared'),
      '@firebase/firestore-native': path.resolve(rootDir, 'node_modules/firebase/firestore/dist/esm/index.esm.js'),
      'firebase/firestore': path.resolve(rootDir, 'src/services/firebase/firestoreInstrumented.js'),
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          firebase: ['firebase/app', 'firebase/firestore', 'firebase/auth', 'firebase/storage'],
          charts: ['chart.js', 'react-chartjs-2'],
          xlsx: ['xlsx'],
        },
      },
    },
  },
  server: {
    host: true,
    port: 5173,
    strictPort: false,
  },
})
