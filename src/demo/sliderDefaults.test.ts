import { describe, it, expect } from 'vitest';
import { Drawing, DrawingStore, SortStore, withSliderDefaults } from '../index.svelte.ts';
import type { D3Context } from '../types';

const OFFSET: { type: 'slider'; min: number; max: number; default: number } =
    { type: 'slider', min: 0, max: 100, default: 20 };

function sortStoreWithSlider(): SortStore {
    const store = new SortStore();
    const noop = (_data: any, context: D3Context): D3Context | null => context.append('g');
    store.newSort('Node', {}, { position: 'position' }, noop);
    store.newSort('Wire', { from: 'Node', to: 'Node' }, { width: 'number', offset: OFFSET }, noop);
    return store;
}

function drawingWithSlider(): Drawing {
    return new Drawing(sortStoreWithSlider());
}

function wireWithoutOffset(drawing: Drawing): ReturnType<Drawing['newArtefact']> {
    const from = drawing.newArtefact('Node', {}, { position: [0, 0] }, 'root');
    const to = drawing.newArtefact('Node', {}, { position: [10, 10] }, 'root');
    return drawing.newArtefact('Wire', { from, to }, { width: 2 }, 'root');
}

describe('withSliderDefaults', () => {
    it('fills every missing slider with its declared default', () => {
        const store = sortStoreWithSlider();
        const filled = withSliderDefaults(store.getSort('Wire')!, { width: 2 });
        expect(filled).toEqual({ width: 2, offset: 20 });
    });

    it('keeps values that are already present, including 0', () => {
        const store = sortStoreWithSlider();
        const filled = withSliderDefaults(store.getSort('Wire')!, { width: 2, offset: 0 });
        expect(filled.offset).toBe(0);
    });

    it('leaves absent non-slider attributes absent', () => {
        const store = sortStoreWithSlider();
        const filled = withSliderDefaults(store.getSort('Wire')!, { offset: 5 });
        expect('width' in filled).toBe(false);
    });

    it('returns the same object when nothing needs filling', () => {
        const store = sortStoreWithSlider();
        const data = { width: 2, offset: 7 };
        expect(withSliderDefaults(store.getSort('Wire')!, data)).toBe(data);
    });

    it('never mutates the given object', () => {
        const store = sortStoreWithSlider();
        const data: Record<string, any> = { width: 2 };
        withSliderDefaults(store.getSort('Wire')!, data);
        expect(data).toEqual({ width: 2 });
    });
});

describe('newArtefact slider defaults', () => {
    it('creates the artefact with the declared default when the slider is omitted', () => {
        const wire = wireWithoutOffset(drawingWithSlider());
        expect(wire.data.offset).toBe(20);
    });

    it('does not mutate the caller data object', () => {
        const drawing = drawingWithSlider();
        const from = drawing.newArtefact('Node', {}, { position: [0, 0] }, 'root');
        const to = drawing.newArtefact('Node', {}, { position: [10, 10] }, 'root');
        const data: Record<string, any> = { width: 2 };
        drawing.newArtefact('Wire', { from, to }, data, 'root');
        expect(data).toEqual({ width: 2 });
    });

    it('preserves an explicitly provided slider value', () => {
        const drawing = drawingWithSlider();
        const from = drawing.newArtefact('Node', {}, { position: [0, 0] }, 'root');
        const to = drawing.newArtefact('Node', {}, { position: [10, 10] }, 'root');
        const wire = drawing.newArtefact('Wire', { from, to }, { width: 2, offset: 55 }, 'root');
        expect(wire.data.offset).toBe(55);
    });

    it('still rejects a missing non-slider attribute', () => {
        const drawing = drawingWithSlider();
        const from = drawing.newArtefact('Node', {}, { position: [0, 0] }, 'root');
        const to = drawing.newArtefact('Node', {}, { position: [10, 10] }, 'root');
        expect(() => drawing.newArtefact('Wire', { from, to }, { offset: 3 }, 'root'))
            .toThrowError(/Missing data attribute 'width'/);
    });

    it('still rejects a slider of the wrong primitive type', () => {
        const drawing = drawingWithSlider();
        const from = drawing.newArtefact('Node', {}, { position: [0, 0] }, 'root');
        const to = drawing.newArtefact('Node', {}, { position: [10, 10] }, 'root');
        expect(() => drawing.newArtefact('Wire', { from, to }, { width: 2, offset: 'wide' }, 'root'))
            .toThrowError(/Data attribute 'offset' expected to be 'slider', but got 'string'/);
    });
});

describe('adoptArtefact slider defaults', () => {
    function savedDrawingWithoutOffset(): ReturnType<typeof DrawingStore.drawingToSavedDrawing> {
        const store = sortStoreWithSlider();
        const live = new Drawing(store);
        const from = live.newArtefact('Node', {}, { position: [0, 0] }, 'root');
        const to = live.newArtefact('Node', {}, { position: [10, 10] }, 'root');
        live.newArtefact('Wire', { from, to }, { width: 2, offset: 20 }, 'root');

        const saved = DrawingStore.drawingToSavedDrawing('Legacy', live);
        // Simulate a file persisted before the sort declared the slider.
        const savedWire = saved.artefacts.find(a => a.sortName === 'Wire')!;
        delete savedWire.data.offset;
        return saved;
    }

    it('backfills the default when hydrating a saved drawing that lacks the slider', () => {
        const store = sortStoreWithSlider();
        const hydrated = DrawingStore.hydrateDrawing(savedDrawingWithoutOffset(), store);
        const wire = hydrated.getArtefacts().find(a => a.sortName === 'Wire')!;
        expect(wire.data.offset).toBe(20);
    });

    it('does not overwrite a slider value stored in the file', () => {
        const store = sortStoreWithSlider();
        const live = new Drawing(store);
        const from = live.newArtefact('Node', {}, { position: [0, 0] }, 'root');
        const to = live.newArtefact('Node', {}, { position: [10, 10] }, 'root');
        live.newArtefact('Wire', { from, to }, { width: 2, offset: 42 }, 'root');

        const hydrated = DrawingStore.hydrateDrawing(DrawingStore.drawingToSavedDrawing('Keep', live), store);
        const wire = hydrated.getArtefacts().find(a => a.sortName === 'Wire')!;
        expect(wire.data.offset).toBe(42);
    });

    it('round-trips the backfilled default through export', () => {
        const store = sortStoreWithSlider();
        const hydrated = DrawingStore.hydrateDrawing(savedDrawingWithoutOffset(), store);
        const reexported = DrawingStore.drawingToSavedDrawing('Legacy', hydrated);
        expect(reexported.artefacts.find(a => a.sortName === 'Wire')!.data.offset).toBe(20);
    });
});
