import { buildDemo } from './demo/buildDemo';
import { sortStore, getDrawing, drawingStore } from './ui/store.svelte.ts';
const globalScope = globalThis as unknown as { sortStore: typeof sortStore };
globalScope.sortStore = sortStore;

buildDemo({ sortStore, drawing: getDrawing(), drawingStore });

export { buildDemo };
