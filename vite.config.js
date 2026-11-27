import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { viteSingleFile } from 'vite-plugin-singlefile'
import { drawBodies } from './vite-plugin-draw-bodies.js'

export default defineConfig({
  base: './',
  plugins: [
    svelte(),
    drawBodies(),
    ...(process.env.SINGLEFILE ? [viteSingleFile()] : [])
  ],
  build: {
    target: 'esnext',
    cssCodeSplit: false,
    rollupOptions: { output: { inlineDynamicImports: true } }
  }
})
