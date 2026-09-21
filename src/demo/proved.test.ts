import { describe, it, expect } from 'vitest';
import {
    DrawingStore,
    getFirstOrderStatementChildLayer,
    computeProved,
    type Drawing,
    type Layer
} from '../index.svelte.ts';
import { makeDrawing, makeVertex, makeEdge, makeStore, newSortStore } from './helpers';

function childIdOf(child: Layer | null): string | null {
    return child ? child.id : null;
}

function buildProvableStatement(): Drawing {
    const host = makeDrawing();
    const a = makeVertex(host, 'a');
    const b = makeVertex(host, 'b');
    makeEdge(host, 'g', a, b);
    host.addLayer('child', 'Child Layer', 'root');
    makeEdge(host, 'c', a, b, 'child');
    return host;
}

function buildUnprovableStatement(): Drawing {
    const host = makeDrawing();
    const a = makeVertex(host, 'a');
    const b = makeVertex(host, 'b');
    host.addLayer('child', 'Child Layer', 'root');
    makeEdge(host, 'c', a, b, 'child');
    return host;
}

describe('getFirstOrderStatementChildLayer', () => {
    it('returns the child layer for a root plus exactly one child', () => {
        const host = buildProvableStatement();
        expect(childIdOf(getFirstOrderStatementChildLayer(host))).toBe('child');
    });

    it('returns null when the drawing has only a root layer', () => {
        expect(getFirstOrderStatementChildLayer(makeDrawing())).toBeNull();
    });

    it('returns null when the child has a child of its own (three layers)', () => {
        const host = makeDrawing();
        host.addLayer('child', 'Child Layer', 'root');
        host.addLayer('grandchild', 'Grandchild Layer', 'child');
        expect(getFirstOrderStatementChildLayer(host)).toBeNull();
    });

    it('returns null when the root has two children', () => {
        const host = makeDrawing();
        host.addLayer('child1', 'Child 1', 'root');
        host.addLayer('child2', 'Child 2', 'root');
        expect(getFirstOrderStatementChildLayer(host)).toBeNull();
    });
});

describe('computeProved', () => {
    it('is true when the child layer of a first-order statement is provable', () => {
        expect(computeProved(buildProvableStatement())).toBe(true);
    });

    it('is false when the child layer is not provable', () => {
        expect(computeProved(buildUnprovableStatement())).toBe(false);
    });

    it('is false for drawings that are not first-order statements', () => {
        expect(computeProved(makeDrawing())).toBe(false);
    });
});

describe('proved flag management', () => {
    it('does not pre-set the proved flag when a drawing is added', () => {
        const store = makeStore();
        const host = buildProvableStatement();
        store.addDrawing('Statement', host);
        expect(store.getDrawing('Statement')?.proved).toBe(false);
    });

    it('preserves proved across an export/import round-trip', () => {
        const store = makeStore();
        store.addDrawing('Statement', buildProvableStatement());
        store.setDrawingProved('Statement', true);
        const json = store.exportDrawingsJSON(['Statement']);

        const imported = new DrawingStore();
        imported.importDrawingsJSON(json, newSortStore());
        expect(imported.getDrawing('Statement')?.proved).toBe(true);
    });

    it('keeps the cached proved flag when the drawing content changes', () => {
        const store = makeStore();
        const host = buildProvableStatement();
        store.addDrawing('Statement', host);
        store.setDrawingProved('Statement', true);

        host.removeLayer('child');
        expect(store.getDrawing('Statement')?.proved).toBe(true);
    });
});

describe('DrawingStore.setDrawingProved', () => {
    it('updates the proved flag on the stored record', () => {
        const store = makeStore();
        const host = buildProvableStatement();
        store.addDrawing('Statement', host);
        store.setDrawingProved('Statement', false);
        expect(store.getDrawing('Statement')?.proved).toBe(false);
        store.setDrawingProved('Statement', true);
        expect(store.getDrawing('Statement')?.proved).toBe(true);
    });

    it('throws for a missing drawing', () => {
        const store = makeStore();
        expect(() => store.setDrawingProved('Nope', true)).toThrow(/Consistency Check Failed/);
    });
});