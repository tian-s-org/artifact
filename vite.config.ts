import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))

/* 开发期两个进程：Vite 在 4330 管前端热更新，API 在 4331 管文件、SSE 和画板资源。
   生产是一个进程（server/index.ts）同时干这两件事，所以前端只写相对路径。 */
const API = process.env.ARTIFACT_API ?? 'http://127.0.0.1:4331'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(here, 'src'),
      // 包已经合并到同一仓库，这两个名字保留为内部模块别名，免得改一堆 import
      '@tian-s-org/schema': path.resolve(here, 'src/protocol/index.ts'),
      '@tian-s-org/canvas-core': path.resolve(here, 'src/core/index.ts'),
    },
  },
  server: {
    host: '127.0.0.1',
    port: Number(process.env.ARTIFACT_PORT) || 4330,
    strictPort: true,
    proxy: {
      '/api': API,
      '/events': API,
      '/files': API,
    },
  },
  build: {
    target: 'es2022',
    outDir: 'dist',
    emptyOutDir: true,
  },
})
