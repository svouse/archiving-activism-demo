import { defineConfig } from 'vite'
import { resolve } from 'node:path'

export default defineConfig({
  base: '/',
  build: {
    outDir: 'docs',
    emptyOutDir: false,
    rollupOptions: {
      input: {
        index: resolve(__dirname, 'index.html'),
        archives: resolve(__dirname, 'public/pages/archives.html'),
        search: resolve(__dirname, 'public/pages/search.html'),
      },
    },
  },
})
