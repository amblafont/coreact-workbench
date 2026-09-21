import { describe, it, expect, beforeEach } from 'vitest';
import { DrawingStore } from '../index.svelte.ts';
import { buildComposableEdgesRule } from '../demo/helpers';

describe('drawing-store reactivity (live-drawing field updates)', () => {
    let store: DrawingStore;

    beforeEach(() => {
        store = new DrawingStore();
    });

    it('markAsRule propagates to a $derived reading the stored drawing', () => {
        const { rule } = buildComposableEdgesRule();
        store.addDrawing('R', rule);
        let isRule = $derived(store.getDrawing('R')?.drawing.isRule);
        const read = () => isRule;
        expect(read()).toBe(true);

        store.markAsRule('R', false);
        expect(read()).toBe(false);

        store.markAsRule('R', true);
        expect(read()).toBe(true);
    });

    it('setDrawingProved propagates to a $derived reading the stored drawing', () => {
        const { rule } = buildComposableEdgesRule();
        store.addDrawing('D', rule);
        let proved = $derived(store.getDrawing('D')?.proved);
        const read = () => proved;
        expect(read()).toBe(false);

        store.setDrawingProved('D', true);
        expect(read()).toBe(true);

        store.setDrawingProved('D', false);
        expect(read()).toBe(false);
    });

    it('setDrawingParent propagates to a $derived reading the stored drawing', () => {
        const { rule } = buildComposableEdgesRule();
        store.addDrawing('C', rule);
        let parentName = $derived(store.getDrawing('C')?.parentName);
        const read = () => parentName;
        expect(read()).toBeUndefined();

        store.setDrawingParent('C', 'ParentDrawing');
        expect(read()).toBe('ParentDrawing');
    });

    it('renameDrawing propagates the updated parentName to children in a $derived', () => {
        const parentDraw = buildComposableEdgesRule().rule;
        const childDraw = buildComposableEdgesRule().rule;
        store.addDrawing('ParentDrawing', parentDraw);
        store.addDrawing('ChildDrawing', childDraw);
        store.setDrawingParent('ChildDrawing', 'ParentDrawing');

        let parentName = $derived(store.getDrawing('ChildDrawing')?.parentName);
        const read = () => parentName;
        expect(read()).toBe('ParentDrawing');

        store.renameDrawing('ParentDrawing', 'RenamedParent');
        expect(read()).toBe('RenamedParent');
    });
});