import { defineConfig } from 'vite';

export default defineConfig({
  base: '/',
  build: {
    outDir: 'docs',
    rollupOptions: {
      // force a fixed filename your static pages can reference
      output: { entryFileNames: 'assets/app.js' }
    }
  }
});
