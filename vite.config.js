import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { viteSingleFile } from 'vite-plugin-singlefile'

export default defineConfig({
  base: './',
  plugins: [
    svelte(),
    ...(process.env.SINGLEFILE ? [viteSingleFile()] : [])
  ],
  build: {
    target: 'esnext',
    cssCodeSplit: false,
    rollupOptions: { output: { inlineDynamicImports: true } }
  }
})
