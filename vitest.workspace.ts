import { defineWorkspace } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { drawBodies } from './vite-plugin-draw-bodies.js';

export default defineWorkspace([
    {
        plugins: [svelte(), drawBodies()],
        test: {
            name: 'node',
            environment: 'node',
            include: ['src/**/*.test.ts'],
            exclude: ['**/*.svelte.test.ts']
        }
    },
    {
        plugins: [svelte(), drawBodies()],
        test: {
            name: 'client',
            environment: 'happy-dom',
            include: ['src/**/*.svelte.test.ts']
        },
        resolve: {
            conditions: ['browser']
        }
    }
]);
