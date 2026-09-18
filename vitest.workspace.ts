import { defineWorkspace } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineWorkspace([
    {
        plugins: [svelte()],
        test: {
            name: 'node',
            environment: 'node',
            include: ['src/**/*.test.ts'],
            exclude: ['**/*.svelte.test.ts']
        }
    },
    {
        plugins: [svelte()],
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