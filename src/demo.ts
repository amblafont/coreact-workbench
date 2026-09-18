import { buildDemo } from './demo/buildDemo';
import { sortStore, drawing, drawingStore } from './ui/store';
const globalScope = globalThis as unknown as { sortStore: typeof sortStore };
globalScope.sortStore = sortStore;

buildDemo({ sortStore, drawing, drawingStore });

export { buildDemo };
