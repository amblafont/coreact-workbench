import { describe, it, expect } from 'vitest';
import { makeDrawing, makeVertex, makeEdge, makeStore } from './helpers';

describe('Drawing.moveArtefact', () => {
    it('swaps two same-sort same-layer artefacts', () => {
        const d = makeDrawing();
        const v0 = makeVertex(d, 'v0');
        const v1 = makeVertex(d, 'v1');
        const v2 = makeVertex(d, 'v2');

        expect(d.getArtefacts()).toEqual([v0, v1, v2]);

        d.moveArtefact(v1, -1);
        expect(d.getArtefacts()).toEqual([v1, v0, v2]);
    });

    it('swaps down instead of up when delta = 1', () => {
        const d = makeDrawing();
        const v0 = makeVertex(d, 'v0');
        const v1 = makeVertex(d, 'v1');
        const v2 = makeVertex(d, 'v2');

        d.moveArtefact(v1, 1);
        expect(d.getArtefacts()).toEqual([v0, v2, v1]);
    });

    it('skips artefacts of a different sort when scanning for a neighbour', () => {
        const d = makeDrawing();
        const v0 = makeVertex(d, 'v0');
        const e0 = makeEdge(d, 'e0', v0, v0);
        const v1 = makeVertex(d, 'v1');

        d.moveArtefact(v1, -1);
        expect(d.getArtefacts()).toEqual([v0, v1, e0]);
    });

    it('skips artefacts in a different layer', () => {
        const d = makeDrawing();
        const v0 = makeVertex(d, 'v0');
        d.addLayer('layer-1', 'L1', 'root');
        const v1 = d.newArtefact('Vertex', {}, { position: [0, 0], label: 'v1' }, 'layer-1');
        const v2 = makeVertex(d, 'v2');

        d.moveArtefact(v1, -1);
        expect(d.getArtefacts()).toEqual([v0, v1, v2]);
    });

    it('is a no-op when the artefact is first and delta = -1', () => {
        const d = makeDrawing();
        const v0 = makeVertex(d, 'v0');
        const v1 = makeVertex(d, 'v1');

        d.moveArtefact(v0, -1);
        expect(d.getArtefacts()).toEqual([v0, v1]);
    });

    it('is a no-op when the artefact is last and delta = 1', () => {
        const d = makeDrawing();
        const v0 = makeVertex(d, 'v0');
        const v1 = makeVertex(d, 'v1');

        d.moveArtefact(v1, 1);
        expect(d.getArtefacts()).toEqual([v0, v1]);
    });

    it('is a no-op when the artefact is the only one of its sort', () => {
        const d = makeDrawing();
        const v0 = makeVertex(d, 'v0');
        const e0 = makeEdge(d, 'e0', v0, v0);
        const e1 = makeEdge(d, 'e1', v0, v0);

        d.moveArtefact(v0, 1);
        expect(d.getArtefacts()).toEqual([v0, e0, e1]);
    });

    it('throws when the artefact is not in the drawing', () => {
        const d = makeDrawing();
        const foreign = makeDrawing();
        const v0 = makeVertex(foreign, 'v0');

        expect(() => d.moveArtefact(v0, 1)).toThrow(/Consistency Check Failed.*does not belong/);
    });

    it('does not affect artefacts of other sorts', () => {
        const d = makeDrawing();
        const v0 = makeVertex(d, 'v0');
        const e0 = makeEdge(d, 'e0', v0, v0);
        const v1 = makeVertex(d, 'v1');
        const e1 = makeEdge(d, 'e1', v1, v1);

        d.moveArtefact(v1, -1);
        expect(d.getArtefacts()).toEqual([v0, v1, e0, e1]);
    });
});

describe('moveArtefact roundtrip (save → load)', () => {
    it('preserves the reordered order for a vertex-only drawing', () => {
        const store = makeStore();
        const d = makeDrawing();
        const v0 = makeVertex(d, 'v0');
        const v1 = makeVertex(d, 'v1');
        const v2 = makeVertex(d, 'v2');

        d.moveArtefact(v1, -1);
        expect(d.getArtefacts()).toEqual([v1, v0, v2]);

        store.saveDrawing('Test', d);

        const d2 = makeDrawing();
        store.loadDrawing('Test', d2);

        const labels = d2.getArtefacts().map(a => a.data.label);
        expect(labels).toEqual(['v1', 'v0', 'v2']);
    });

    it('preserves the reordered order for a mixed-sort drawing', () => {
        const store = makeStore();
        const d = makeDrawing();
        const v0 = makeVertex(d, 'v0');
        makeEdge(d, 'e0', v0, v0);
        const v1 = makeVertex(d, 'v1');
        makeEdge(d, 'e1', v1, v1);

        d.moveArtefact(v1, -1);
        expect(d.getArtefacts().map(a => a.data.label)).toEqual(['v0', 'v1', 'e0', 'e1']);

        store.saveDrawing('Test', d);

        const d2 = makeDrawing();
        store.loadDrawing('Test', d2);

        expect(d2.getArtefacts().map(a => a.data.label)).toEqual(['v0', 'v1', 'e0', 'e1']);
    });
});
