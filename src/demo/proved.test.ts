import { describe, it, expect } from 'vitest';
import {
    DrawingStore,
    getFirstOrderStatementChildLayer,
    computeProved,
    type Drawing,
    type Layer
} from '../index';
import { makeDrawing, makeVertex, makeEdge, makeStore } from './helpers';

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

describe('saving a drawing records the proved flag', () => {
    it('marks a provable first-order statement as proved', () => {
        const store = makeStore();
        const host = buildProvableStatement();
        const saved = store.saveDrawing('Statement', host);
        expect(saved.proved).toBe(true);
    });

    it('does not mark an unprovable first-order statement as proved', () => {
        const store = makeStore();
        const host = buildUnprovableStatement();
        const saved = store.saveDrawing('Statement', host);
        expect(saved.proved).toBe(false);
    });

    it('does not mark non-statement drawings as proved', () => {
        const store = makeStore();
        const saved = store.saveDrawing('Plain', makeDrawing());
        expect(saved.proved).toBe(false);
    });

    it('preserves proved across an export/import round-trip', () => {
        const store = makeStore();
        store.saveDrawing('Statement', buildProvableStatement());
        const json = store.exportDrawingsJSON(['Statement']);

        const imported = new DrawingStore();
        const result = imported.importDrawingsJSON(json);
        expect(result.drawings[0].proved).toBe(true);
    });

    it('recomputes proved from content on save', () => {
        const store = makeStore();
        const host = buildProvableStatement();
        store.saveDrawing('Statement', host);

        const reloaded = makeDrawing();
        store.loadDrawing('Statement', reloaded);
        reloaded.removeLayer('child');
        const saved = store.saveDrawing('Statement', reloaded);
        expect(saved.proved).toBe(false);
    });
});

describe('DrawingStore.setDrawingProved', () => {
    it('updates the proved flag on the stored record', () => {
        const store = makeStore();
        const host = buildProvableStatement();
        store.saveDrawing('Statement', host);
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