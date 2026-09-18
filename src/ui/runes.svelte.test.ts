import { describe, it, expect } from 'vitest';
import { flushSync } from 'svelte';
import { SvelteMap } from 'svelte/reactivity';

describe('client-mode runes harness', () => {
    it('proves the browser condition resolves the reactive SvelteMap', () => {
        expect(SvelteMap).not.toBe(Map);
    });

    it('$state and $derived react under happy-dom', () => {
        let count = $state(0);
        let double = $derived(count * 2);
        const readDouble = () => double;
        expect(readDouble()).toBe(0);
        count = 1;
        expect(readDouble()).toBe(2);
    });

    it('$effect.root + flushSync re-runs on state change', () => {
        let n = $state(0);
        let seen = $state<number | null>(null);
        const readSeen = () => seen;
        const cleanup = $effect.root(() => {
            $effect(() => {
                seen = n;
            });
        });
        flushSync();
        expect(readSeen()).toBe(0);
        n = 1;
        flushSync();
        expect(readSeen()).toBe(1);
        cleanup();
    });

    it('SvelteMap mutations are tracked by $derived', () => {
        const map = new SvelteMap<string, number>();
        let size = $derived(map.size);
        const readSize = () => size;
        expect(readSize()).toBe(0);
        map.set('a', 1);
        expect(readSize()).toBe(1);
        map.delete('a');
        expect(readSize()).toBe(0);
    });
});