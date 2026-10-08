import { registerDefaultSorts } from './demo/buildDemo';
import { sortStore, drawingStore } from './ui/store.svelte.ts';
import monoShortJson from '../examples/mono-short.json?raw';

const globalScope = globalThis as unknown as { sortStore: typeof sortStore };
globalScope.sortStore = sortStore;

registerDefaultSorts(sortStore);

function loadInitialDrawings(): string {
    try {
        const { names } = drawingStore.importDrawingsJSON(monoShortJson, sortStore);
        return names[0] ?? '';
    } catch (err) {
        console.error('Failed to load examples/mono-short.json:', err);
        return '';
    }
}

export const initialDrawingName = loadInitialDrawings();
