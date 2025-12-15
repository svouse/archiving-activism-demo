import { defineConfig } from "vite";

export default defineConfig({
  base: "/",
  build: {
    outDir: "docs",
    emptyOutDir: true,
    rollupOptions: {
      output: {
        entryFileNames: "assets/app.js",
        inlineDynamicImports: true,
      },
    },
  },
});
