import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { execSync } from 'child_process'

function buildSortsPlugin() {
  return {
    name: 'build-sorts',
    configureServer(server) {
      server.watcher.add('src/default_sorts.ts')
      server.watcher.on('change', (file) => {
        if (file.endsWith('default_sorts.ts')) {
          console.log('[build:sorts] Regenerating default_sorts.js...')
          execSync('npm run build:sorts')
          console.log('[build:sorts] Done.')
        }
      })
    }
  }
}

export default defineConfig({
  base: './',
  plugins: [svelte(), buildSortsPlugin()]
})
