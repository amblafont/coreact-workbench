import { describe, it, expect } from 'vitest';
import { flushSync } from 'svelte';
import { Drawing, DrawingStore } from '../index.svelte.ts';
import { newSortStore, makeDrawing } from '../demo/helpers';

describe('core reactivity ($state)', () => {
    it('artefact.data mutations are tracked by $derived', () => {
        const drawing = makeDrawing();
        const art = drawing.newArtefact('Vertex', {}, { position: [0, 0], label: 'v0' }, 'root');
        let label = $derived(art.data.label);
        const read = () => label;
        expect(read()).toBe('v0');
        art.data.label = 'v1';
        expect(read()).toBe('v1');
    });

    it('artefact.sortName changes are tracked', () => {
        const drawing = makeDrawing();
        const art = drawing.newArtefact('Vertex', {}, { position: [0, 0] }, 'root');
        let name = $derived(art.sortName);
        const read = () => name;
        expect(read()).toBe('Vertex');
        art.sortName = 'Edge';
        expect(read()).toBe('Edge');
    });

    it('newArtefact (array push) recomputes derived artefact list', () => {
        const drawing = makeDrawing();
        let count = $derived(drawing.getArtefacts().length);
        const read = () => count;
        expect(read()).toBe(0);
        drawing.newArtefact('Vertex', {}, { position: [0, 0] }, 'root');
        expect(read()).toBe(1);
        drawing.newArtefact('Vertex', {}, { position: [2, 2] }, 'root');
        expect(read()).toBe(2);
    });

    it('removeArtefact (array reassign) recomputes derived artefact list', () => {
        const drawing = makeDrawing();
        const a = drawing.newArtefact('Vertex', {}, { position: [0, 0] }, 'root');
        const b = drawing.newArtefact('Vertex', {}, { position: [2, 2] }, 'root');
        let count = $derived(drawing.getArtefacts().length);
        const read = () => count;
        expect(read()).toBe(2);
        drawing.removeArtefact(a);
        expect(read()).toBe(1);
        drawing.removeArtefact(b);
        expect(read()).toBe(0);
    });

    it('layer add/remove recompute getAllLayers', () => {
        const drawing = makeDrawing();
        let count = $derived(drawing.getAllLayers().length);
        const read = () => count;
        expect(read()).toBe(1);
        drawing.addLayer('l1', 'Layer 1', 'root');
        expect(read()).toBe(2);
        drawing.removeLayer('l1');
        expect(read()).toBe(1);
    });

    it('layer.visible changes are tracked', () => {
        const drawing = makeDrawing();
        drawing.addLayer('l1', 'Layer 1', 'root');
        const layer = drawing.getLayer('l1')!;
        let visible = $derived(layer.visible);
        const read = () => visible;
        expect(read()).toBe(true);
        layer.visible = false;
        expect(read()).toBe(false);
        layer.visible = true;
        expect(read()).toBe(true);
    });

    it('focusedLayerId changes are tracked', () => {
        const drawing = makeDrawing();
        drawing.addLayer('l1', 'Layer 1', 'root');
        let focused = $derived(drawing.getFocusedLayerId());
        const read = () => focused;
        expect(read()).toBe(null);
        drawing.setFocusedLayer('l1');
        expect(read()).toBe('l1');
        drawing.setFocusedLayer(null);
        expect(read()).toBe(null);
    });

    it('ruleFlag changes are tracked via the isRule getter', () => {
        const sortStore = newSortStore();
        const rule = new Drawing(sortStore);
        const vx = rule.newArtefact('Vertex', {}, { position: [0, 0], label: 'x' }, 'root');
        const vy = rule.newArtefact('Vertex', {}, { position: [1, 0], label: 'y' }, 'root');
        rule.addLayer('conclusion', 'Conclusion', 'root');
        rule.newEqualityArtefact([vx, vy], 'conclusion');
        let isRule = $derived(rule.isRule);
        const read = () => isRule;
        expect(read()).toBe(false);
        rule.setIsRule(true);
        expect(read()).toBe(true);
        rule.setIsRule(false);
        expect(read()).toBe(false);
    });

    it('addDrawing/deleteDrawing recompute getAllDrawings', () => {
        const store = new DrawingStore();
        let count = $derived(store.getAllDrawings().length);
        const read = () => count;
        expect(read()).toBe(0);
        store.addDrawing('A', makeDrawing());
        expect(read()).toBe(1);
        store.addDrawing('B', makeDrawing());
        expect(read()).toBe(2);
        store.deleteDrawing('A');
        expect(read()).toBe(1);
    });

    it('svgElement assignment does not schedule effects (loop hazard guard)', () => {
        const drawing = makeDrawing();
        const art = drawing.newArtefact('Vertex', {}, { position: [0, 0], label: 'v0' }, 'root');
        let labelSeen = $state('');
        const readSeen = () => labelSeen;
        const cleanup = $effect.root(() => {
            $effect(() => {
                labelSeen = art.data.label;
            });
        });
        flushSync();
        expect(readSeen()).toBe('v0');
        art.data.label = 'v1';
        flushSync();
        expect(readSeen()).toBe('v1');
        art.svgElement = {} as any;
        flushSync();
        expect(readSeen()).toBe('v1');
        cleanup();
    });
});