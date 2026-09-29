import { describe, it, expect } from 'vitest';
import { DrawingStore, processWhenReady } from '../index.svelte.ts';
import { makeDrawing, makeVertex, makeEdge, makeStore, newSortStore } from './helpers';

describe('processWhenReady', () => {
    it('keeps the input order when it is already valid', () => {
        const processed: number[] = [];
        processWhenReady(
            [1, 2, 3],
            () => true,
            n => { processed.push(n); },
            () => { throw new Error('should not get stuck'); }
        );
        expect(processed).toEqual([1, 2, 3]);
    });

    it('takes the first ready item each time, so an invalid order is fixed', () => {
        // 3 needs 2, 2 needs 1: only 1 is ready first, then 2 becomes ready, then 3.
        const processed: number[] = [];
        const done = new Set<number>();
        processWhenReady(
            [3, 2, 1],
            n => n === 1 || done.has(n - 1),
            n => { done.add(n); processed.push(n); },
            () => { throw new Error('should not get stuck'); }
        );
        expect(processed).toEqual([1, 2, 3]);
    });

    it('keeps the first ready item when several are ready at once', () => {
        const processed: string[] = [];
        processWhenReady(
            ['b', 'a', 'c'],
            () => true,
            n => { processed.push(n); },
            () => { throw new Error('should not get stuck'); }
        );
        expect(processed).toEqual(['b', 'a', 'c']);
    });

    it('calls onStuck with the items that remain when none is ready', () => {
        const processed: number[] = [];
        let stuckWith: number[] = [];
        expect(() => processWhenReady(
            [1, 2, 3, 4],
            n => n <= 2,
            n => { processed.push(n); },
            remaining => { stuckWith = remaining; throw new Error('stuck'); }
        )).toThrow('stuck');
        expect(processed).toEqual([1, 2]);
        expect(stuckWith).toEqual([3, 4]);
    });

    it('does nothing for an empty list', () => {
        expect(() => processWhenReady(
            [],
            () => true,
            () => { throw new Error('should not process'); },
            () => { throw new Error('should not get stuck'); }
        )).not.toThrow();
    });
});

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

        store.addDrawing('Test', d);

        const d2 = DrawingStore.hydrateDrawing(DrawingStore.drawingToSavedDrawing('Test', store.getDrawing('Test')!.drawing), newSortStore());

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

        store.addDrawing('Test', d);

        const d2 = DrawingStore.hydrateDrawing(DrawingStore.drawingToSavedDrawing('Test', store.getDrawing('Test')!.drawing), newSortStore());

        expect(d2.getArtefacts().map(a => a.data.label)).toEqual(['v0', 'v1', 'e0', 'e1']);
    });

    it('restores an artefact before the dependent artefact it was moved past', () => {
        const store = makeStore();
        const d = makeDrawing();
        const v0 = makeVertex(d, 'v0');
        const v1 = makeVertex(d, 'v1');
        makeEdge(d, 'e0', v1, v0);
        makeVertex(d, 'v2');

        // Scanning for a same-sort neighbour jumps over e0, so v1 lands after it and
        // the saved order no longer respects e0's dependency on v1.
        d.moveArtefact(v1, 1);
        expect(d.getArtefacts().map(a => a.data.label)).toEqual(['v0', 'e0', 'v1', 'v2']);

        store.addDrawing('Test', d);

        const d2 = DrawingStore.hydrateDrawing(DrawingStore.drawingToSavedDrawing('Test', store.getDrawing('Test')!.drawing), newSortStore());

        // Loading takes the first artefact whose dependencies are ready, so e0 waits
        // for v1 and the order stays valid.
        const labels = d2.getArtefacts().map(a => a.data.label);
        expect(labels.indexOf('v1')).toBeLessThan(labels.indexOf('e0'));
    });
});

describe('nested layers stored child-before-parent', () => {
    it('restores the hierarchy and the artefacts that depend on it', () => {
        const d = makeDrawing();
        makeVertex(d, 'v0');
        d.addLayer('parent', 'Parent', 'root');
        d.addLayer('child', 'Child', 'parent');
        d.newArtefact('Vertex', {}, { position: [0, 0], label: 'v1' }, 'child');

        const saved = DrawingStore.drawingToSavedDrawing('Nested', d);
        // A saved drawing can list a child layer before its parent.
        saved.layers.reverse();

        const d2 = DrawingStore.hydrateDrawing(saved, newSortStore());

        expect(d2.getLayer('child')?.parentId).toBe('parent');
        expect(d2.getArtefacts().map(a => a.data.label)).toEqual(['v0', 'v1']);
    });
});
