import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DrawingStore, SortStore } from '../index.svelte.ts';
import { registerDefaultSorts } from '../default_sorts/index.ts';
import { parseHrx, serializeHrx } from './codec';
import { buildModuleApi, parseRequires } from './moduleRuntime';
import { loadHrxArchive } from './load';
import { exportHrx } from './export';

const EXAMPLE = readFileSync(new URL('../../examples/newformat.hrx', import.meta.url), 'utf8');

function chainableContext(): any {
    const element: any = {};
    for (const method of ['attr', 'append', 'insert', 'style', 'text', 'classed', 'on']) {
        element[method] = () => element;
    }
    return { append: () => element, insert: () => element };
}

describe('HRX codec', () => {
    it('round-trips section bodies', () => {
        const sections = new Map<string, string>([
            ['sorts.json', '[]\n'],
            ['js/a.js', 'return 1;\n']
        ]);
        const parsed = parseHrx(serializeHrx(sections));
        expect(Array.from(parsed.sections.keys())).toEqual(['sorts.json', 'js/a.js']);
        expect(parsed.sections.get('js/a.js')).toBe('return 1;');
    });

    it('lengthens the boundary when a body line would collide', () => {
        const hrx = serializeHrx(new Map([
            ['a.txt', '<===> not a header\nline'],
            ['b.txt', 'plain']
        ]));
        expect(hrx).toContain('<====> a.txt');
        expect(parseHrx(hrx).sections.get('a.txt')).toBe('<===> not a header\nline');
    });
});

describe('HRX archive support', () => {
    it('loads the example archive and exposes its modules', () => {
        const sortStore = new SortStore();
        const drawingStore = new DrawingStore();
        const result = loadHrxArchive(EXAMPLE, sortStore, drawingStore);

        expect(result.sortsAdded).toEqual(['Vertex', 'Edge']);
        expect(result.drawings.map(d => d.name)).toEqual(['Example']);
        expect(sortStore.getSort('Edge')?.attributes.bend).toEqual({
            type: 'slider', min: -500, max: 500, default: 0
        });

        const drawing = drawingStore.getDrawing('Example')!.drawing;
        const artefacts = drawing.getArtefacts();
        expect(artefacts.map(a => a.sortName)).toEqual(['Vertex', 'Vertex', 'Edge']);
        const edge = artefacts.find(a => a.sortName === 'Edge')!;
        expect(edge.dependencies.source.sortName).toBe('Vertex');
        expect(edge.dependencies.target.sortName).toBe('Vertex');
        expect(edge.getResolvedData().source.position).toEqual([412, 353]);

        const archive = parseHrx(EXAMPLE);
        const modules = new Map(
            Array.from(archive.sections.entries())
                .filter(([path]) => path.startsWith('js/'))
                .map(([path, source]) => [path.slice(3, -3), { source, requires: parseRequires(source) }])
        );
        const api = buildModuleApi(modules, Array.from(modules.keys()));
        expect(typeof api.hookStartOffset).toBe('function');
        expect((api.hookStartOffset as (w: number) => number)(2)).toBeGreaterThan(20);
        const midpoint = (api.arrow as { edgeMidpoint: (...args: any[]) => [number, number] })
            .edgeMidpoint([0, 0], [100, 0], 0, 2, false);
        expect(midpoint[0]).toBeCloseTo(47.5);
        expect(midpoint[1]).toBe(0);
    });

    it('binds module APIs into imported draw functions', () => {
        const sortStore = new SortStore();
        loadHrxArchive(EXAMPLE, sortStore, new DrawingStore());

        const edge = sortStore.getSort('Edge')!;
        const result = edge.drawFunction(
            {
                source: { position: [0, 0] },
                target: { position: [100, 0] },
                width: 2,
                bend: 0
            },
            chainableContext()
        );

        expect(result).toBeDefined();
    });

    it('exports only the sorts and modules needed by the selected drawings', () => {
        const sortStore = new SortStore();
        const drawingStore = new DrawingStore();
        registerDefaultSorts(sortStore);
        loadHrxArchive(EXAMPLE, sortStore, drawingStore);

        const hrx = exportHrx(['Example'], sortStore, drawingStore);
        const sections = parseHrx(hrx).sections;
        const sortNames = (JSON.parse(sections.get('sorts.json')!) as Array<{ name: string }>)
            .map(s => s.name);

        expect(sortNames).toEqual(['Vertex', 'Edge']);
        expect(sections.has('sorts/Vertex.js')).toBe(true);
        expect(sections.has('sorts/Edge.js')).toBe(true);
        expect(sections.has('sorts/Pullback.js')).toBe(false);
        expect(sections.has('js/geometry.js')).toBe(true);
        expect(sections.has('js/arrow.js')).toBe(false);
        expect(sections.has('drawings.json')).toBe(true);

        const freshSorts = new SortStore();
        const freshDrawings = new DrawingStore();
        const roundTrip = loadHrxArchive(hrx, freshSorts, freshDrawings);
        expect(roundTrip.sortsAdded).toEqual(['Vertex', 'Edge']);
        expect(freshDrawings.getDrawing('Example')).toBeDefined();
    });
});

describe('built-in sorts', () => {
    it('binds the geometry module into draw functions that use it', () => {
        const sortStore = new SortStore();
        registerDefaultSorts(sortStore);

        const edge = sortStore.getSort('Edge')!;
        const result = edge.drawFunction(
            {
                source: { position: [0, 0] },
                target: { position: [100, 0] },
                width: 2,
                bend: 0
            },
            chainableContext()
        );

        expect(result).toBeDefined();
    });
});

describe('HRX merge policy', () => {
    it('rejects a same-name sort with different data fields', () => {
        const sortStore = new SortStore();
        const drawingStore = new DrawingStore();
        sortStore.newSort('Vertex', {}, { position: 'position', label: 'string' }, () => null);

        expect(() => loadHrxArchive(EXAMPLE, sortStore, drawingStore)).toThrow(/different dependencies, data fields, or equations/);
    });

    it('keeps an existing matching sort definition', () => {
        const sortStore = new SortStore();
        const drawingStore = new DrawingStore();
        registerDefaultSorts(sortStore);
        const originalVertex = sortStore.getSort('Vertex')!.drawFunction;

        const result = loadHrxArchive(EXAMPLE, sortStore, drawingStore);

        expect(result.sortsKept).toEqual(['Vertex', 'Edge']);
        expect(sortStore.getSort('Vertex')!.drawFunction).toBe(originalVertex);
    });

    it('renames structurally different drawings and skips exact duplicates', () => {
        const sortStore = new SortStore();
        const drawingStore = new DrawingStore();
        loadHrxArchive(EXAMPLE, sortStore, drawingStore);

        const second = loadHrxArchive(EXAMPLE, sortStore, drawingStore);
        expect(second.drawings[0].action).toBe('kept');

        const modified = parseHrx(EXAMPLE);
        const drawings = JSON.parse(modified.sections.get('drawings.json')!);
        drawings.drawings[0].artefacts.push({
            id: 'a4', sortName: 'Vertex', layerId: 'root', dependencies: {},
            data: { position: [1, 2], label: 'extra' }
        });
        modified.sections.set('drawings.json', JSON.stringify(drawings));

        const third = loadHrxArchive(serializeHrx(modified.sections), sortStore, drawingStore);
        expect(third.drawings[0].action).toBe('renamed');
        expect(third.drawings[0].name).toBe('Example (1)');
    });

    it('lets the caller choose for drawings differing only in data', () => {
        const sortStore = new SortStore();
        const drawingStore = new DrawingStore();
        loadHrxArchive(EXAMPLE, sortStore, drawingStore);

        const modified = parseHrx(EXAMPLE);
        const drawings = JSON.parse(modified.sections.get('drawings.json')!);
        drawings.drawings[0].artefacts[0].data.position = [999, 999];
        modified.sections.set('drawings.json', JSON.stringify(drawings));

        const kept = loadHrxArchive(serializeHrx(modified.sections), sortStore, drawingStore, {
            resolveDrawingConflict: () => 'keepExisting'
        });
        expect(kept.drawings[0].action).toBe('kept');
        expect(drawingStore.getDrawing('Example')!.drawing.getArtefacts()[0].data.position).toEqual([218, 345]);

        const replaced = loadHrxArchive(serializeHrx(modified.sections), sortStore, drawingStore, {
            resolveDrawingConflict: () => 'keepImported'
        });
        expect(replaced.drawings[0].action).toBe('replaced');
        expect(drawingStore.getDrawing('Example')!.drawing.getArtefacts()[0].data.position).toEqual([999, 999]);
    });
});
