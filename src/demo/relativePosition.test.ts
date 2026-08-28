import { describe, it, expect } from 'vitest';
import { Drawing, SortStore } from '../index';
import type { D3Context } from '../types';

function sortStoreWithRelativeChain(): SortStore {
    const store = new SortStore();
    const noop = (_data: any, context: D3Context): D3Context | null => context.append('g');
    store.newSort('Anchor', {}, { position: 'position' }, noop);
    store.newSort('R1', { anchor: 'Anchor' }, { position: { type: 'relativePosition', target: 'anchor.position' } }, noop);
    store.newSort('R2', { prev: 'R1' }, { position: { type: 'relativePosition', target: 'prev.position' } }, noop);
    store.newSort('R3', { prev: 'R2' }, { position: { type: 'relativePosition', target: 'prev.position' } }, noop);
    return store;
}

function builtChain(): { drawing: Drawing; anchor: ReturnType<Drawing['newArtefact']>; r1: ReturnType<Drawing['newArtefact']>; r2: ReturnType<Drawing['newArtefact']>; r3: ReturnType<Drawing['newArtefact']> } {
    const store = sortStoreWithRelativeChain();
    const drawing = new Drawing(store);
    const anchor = drawing.newArtefact('Anchor', {}, { position: [100, 100] }, 'root');
    const r1 = drawing.newArtefact('R1', { anchor }, { position: [10, 20] }, 'root');
    const r2 = drawing.newArtefact('R2', { prev: r1 }, { position: [30, 40] }, 'root');
    const r3 = drawing.newArtefact('R3', { prev: r2 }, { position: [50, 60] }, 'root');
    return { drawing, anchor, r1, r2, r3 };
}

describe('nested relativePosition resolution', () => {
    it('composes a 4-deep relative chain into an absolute position', () => {
        const { drawing, r3 } = builtChain();
        const r3Def = drawing.sortStore.getSort('R3')!;
        const resolved = r3.getResolvedData(undefined, undefined, r3Def, (n) => drawing.sortStore.getSort(n));
        // anchor.abs (100,100) + r1 (10,20) + r2 (30,40) + r3 (50,60)
        expect(resolved.position).toEqual([190, 220]);
        expect(resolved.prev.position).toEqual([140, 160]);
        expect(resolved.prev.prev.position).toEqual([110, 120]);
    });

    it('recomputes the whole chain when the anchor moves', () => {
        const { drawing, anchor, r1, r2, r3 } = builtChain();
        anchor.data.position = [300, 300];

        const r3Def = drawing.sortStore.getSort('R3')!;
        const r2Def = drawing.sortStore.getSort('R2')!;
        const r1Def = drawing.sortStore.getSort('R1')!;

        expect(r1.getResolvedData(undefined, undefined, r1Def, (n) => drawing.sortStore.getSort(n)).position).toEqual([310, 320]);
        expect(r2.getResolvedData(undefined, undefined, r2Def, (n) => drawing.sortStore.getSort(n)).position).toEqual([340, 360]);
        expect(r3.getResolvedData(undefined, undefined, r3Def, (n) => drawing.sortStore.getSort(n)).position).toEqual([390, 420]);
    });

    it('an intermediate sort resolves its own position against the anchor', () => {
        const { drawing, r1 } = builtChain();
        const r1Def = drawing.sortStore.getSort('R1')!;
        const resolved = r1.getResolvedData(undefined, undefined, r1Def, (n) => drawing.sortStore.getSort(n));
        expect(resolved.position).toEqual([110, 120]);
        expect(resolved.anchor.position).toEqual([100, 100]);
    });
});
