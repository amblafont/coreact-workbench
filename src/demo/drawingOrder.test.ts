import { describe, it, expect } from 'vitest';
import { makeDrawing, makeStore, newSortStore } from './helpers';

describe('DrawingStore.moveDrawing', () => {
    it('swaps sibling root drawings up and down', () => {
        const store = makeStore();
        for (const name of ['A', 'B', 'C']) {
            store.addDrawing(name, makeDrawing());
        }

        store.moveDrawing('C', -1);
        expect(store.getAllNames()).toEqual(['A', 'C', 'B']);

        store.moveDrawing('A', 1);
        expect(store.getAllNames()).toEqual(['C', 'A', 'B']);
    });

    it('reports boundaries and keeps the order unchanged there', () => {
        const store = makeStore();
        for (const name of ['A', 'B', 'C']) {
            store.addDrawing(name, makeDrawing());
        }

        expect(store.canMoveDrawing('A', -1)).toBe(false);
        expect(store.canMoveDrawing('A', 1)).toBe(true);
        expect(store.canMoveDrawing('C', 1)).toBe(false);
        expect(store.canMoveDrawing('C', -1)).toBe(true);

        store.moveDrawing('A', -1);
        store.moveDrawing('C', 1);
        expect(store.getAllNames()).toEqual(['A', 'B', 'C']);
    });

    it('only moves drawings among their siblings', () => {
        const store = makeStore();
        store.addDrawing('Root1', makeDrawing());
        store.addDrawing('Root2', makeDrawing());
        store.addDrawing('Child1', makeDrawing());
        store.addDrawing('Child2', makeDrawing());
        store.setDrawingParent('Child1', 'Root1');
        store.setDrawingParent('Child2', 'Root1');

        store.moveDrawing('Child2', -1);
        expect(store.getAllNames()).toEqual(['Root1', 'Root2', 'Child2', 'Child1']);
        expect(store.canMoveDrawing('Child2', -1)).toBe(false);
        expect(store.canMoveDrawing('Child1', 1)).toBe(false);

        store.moveDrawing('Root2', -1);
        expect(store.getAllNames()).toEqual(['Root2', 'Root1', 'Child2', 'Child1']);
        expect(store.canMoveDrawing('Child2', 1)).toBe(true);
    });

    it('treats a drawing with a missing parent as a root', () => {
        const store = makeStore();
        store.addDrawing('A', makeDrawing());
        store.addDrawing('Orphan', makeDrawing());
        store.setDrawingParent('Orphan', 'Missing');
        store.addDrawing('B', makeDrawing());

        expect(store.canMoveDrawing('Orphan', -1)).toBe(true);
        store.moveDrawing('Orphan', -1);
        expect(store.getAllNames()).toEqual(['Orphan', 'A', 'B']);
    });

    it('rejects an unknown drawing', () => {
        const store = makeStore();
        store.addDrawing('A', makeDrawing());

        expect(store.canMoveDrawing('Missing', 1)).toBe(false);
        expect(() => store.moveDrawing('Missing', 1)).toThrow(/does not exist/);
    });

    it('persists the reordered order through JSON export/import', () => {
        const store = makeStore();
        store.addDrawing('Parent', makeDrawing());
        store.addDrawing('Root2', makeDrawing());
        store.addDrawing('Child1', makeDrawing());
        store.addDrawing('Child2', makeDrawing());
        store.setDrawingParent('Child1', 'Parent');
        store.setDrawingParent('Child2', 'Parent');

        store.moveDrawing('Child2', -1);
        store.moveDrawing('Root2', -1);
        const expected = store.getAllNames();

        const imported = makeStore();
        imported.importDrawingsJSON(store.exportDrawingsJSON(), newSortStore());

        expect(imported.getAllNames()).toEqual(expected);
        expect(imported.getDrawing('Child2')?.parentName).toBe('Parent');
    });
});
