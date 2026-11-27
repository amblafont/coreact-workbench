import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Drawing, DrawingStore, SortStore } from '../index.svelte.ts';
import { registerDefaultSorts } from '../default_sorts/index.ts';
import { makeEdge, makeVertex, newSortStore } from '../demo/helpers.ts';
import { parseHrx, serializeHrx } from './codec';
import { buildModuleApi, parseRequires } from './moduleRuntime';
import { analyseHrxArchive, applyHrxImportPlan, loadHrxArchive, validateHrxPlan } from './load';
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

    it('treats a sort without a data field as having empty data', () => {
        const sections = parseHrx(EXAMPLE).sections;
        const records = JSON.parse(sections.get('sorts.json')!) as Array<Record<string, unknown>>;
        delete records.find(record => record.name === 'Vertex')!.data;
        sections.set('sorts.json', JSON.stringify(records));
        sections.set('drawings.json', '{"drawings":[]}\n');

        const archive = serializeHrx(sections);
        const sortStore = new SortStore();
        const drawingStore = new DrawingStore();
        const plan = analyseHrxArchive(archive, sortStore, drawingStore, { ui: true });

        expect(plan.errors).toEqual([]);
        expect(plan.sorts.map(row => [row.name, row.kind, row.decision])).toEqual([
            ['Vertex', 'new', 'add'],
            ['Edge', 'new', 'add']
        ]);
        expect(plan.sorts.every(row => !row.error)).toBe(true);

        loadHrxArchive(archive, sortStore, drawingStore);
        expect(sortStore.getSort('Vertex')!.attributes).toEqual({});
        expect(sortStore.getSort('Edge')!.attributes.bend).toEqual({
            type: 'slider', min: -500, max: 500, default: 0
        });
    });

    it('matches an existing attribute-free sort when the archive omits data', () => {
        const sections = parseHrx(EXAMPLE).sections;
        const records = JSON.parse(sections.get('sorts.json')!) as Array<Record<string, unknown>>;
        delete records.find(record => record.name === 'Vertex')!.data;
        sections.set('sorts.json', JSON.stringify(records));
        sections.set('drawings.json', '{"drawings":[]}\n');

        const sortStore = new SortStore();
        sortStore.newSort('Vertex', {}, {}, () => null);
        const plan = analyseHrxArchive(serializeHrx(sections), sortStore, new DrawingStore(), { ui: true });

        const vertex = plan.sorts.find(row => row.name === 'Vertex')!;
        expect(vertex.kind).toBe('existing');
        expect(vertex.error).toBeUndefined();
    });

    it('still rejects a sort whose data field is present but not an object', () => {
        const sections = parseHrx(EXAMPLE).sections;
        const records = JSON.parse(sections.get('sorts.json')!) as Array<Record<string, unknown>>;
        records[0].data = null;
        sections.set('sorts.json', JSON.stringify(records));

        expect(() => analyseHrxArchive(serializeHrx(sections), new SortStore(), new DrawingStore()))
            .toThrow(/must have an object 'deps' field/);
    });

    it('imports a sort without a drawing JS section as a no-op draw function', () => {
        const sections = parseHrx(EXAMPLE).sections;
        sections.delete('sorts/Vertex.js');
        const archive = serializeHrx(sections);

        const sortStore = new SortStore();
        const drawingStore = new DrawingStore();
        const plan = analyseHrxArchive(archive, sortStore, drawingStore, { ui: true });
        expect(plan.errors).toEqual([]);
        expect(plan.sorts.every(row => !row.error)).toBe(true);
        expect(plan.sorts.find(row => row.name === 'Vertex')!.decision).toBe('add');

        expect(loadHrxArchive(archive, sortStore, drawingStore).sortsAdded).toEqual(['Vertex', 'Edge']);
        expect(sortStore.getSortSource('Vertex')).toBeUndefined();
        expect(sortStore.getSort('Vertex')!.drawFunction({} as any, {} as any)).toBeNull();

        const exported = parseHrx(exportHrx(['Example'], sortStore, drawingStore)).sections;
        expect(JSON.parse(exported.get('sorts.json')!).map((sort: { name: string }) => sort.name))
            .toEqual(['Vertex', 'Edge']);
        expect(exported.has('sorts/Vertex.js')).toBe(false);
        expect(exported.has('sorts/Edge.js')).toBe(true);
    });

    it('keeps an existing sort drawing when the archive omits its JS section', () => {
        const sections = parseHrx(EXAMPLE).sections;
        sections.delete('sorts/Vertex.js');
        const archive = serializeHrx(sections);

        const sortStore = new SortStore();
        registerDefaultSorts(sortStore);
        const drawingStore = new DrawingStore();
        const originalSource = sortStore.getSortSource('Vertex');
        const originalDraw = sortStore.getSort('Vertex')!.drawFunction;

        const plan = analyseHrxArchive(archive, sortStore, drawingStore, { ui: true });
        const vertex = plan.sorts.find(row => row.name === 'Vertex')!;
        expect(vertex.kind).toBe('existing');
        expect(vertex.error).toBeUndefined();
        expect(vertex.drawFunctionsEqual).toBe(true);
        expect(vertex.replaceDrawFunctions).toBe(false);

        loadHrxArchive(archive, sortStore, drawingStore);
        expect(sortStore.getSortSource('Vertex')).toEqual(originalSource);
        expect(sortStore.getSort('Vertex')!.drawFunction).toBe(originalDraw);
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

describe('HRX import preview', () => {
    it('defaults new sorts and drawings to Add, and existing rows to unchanged or Skip', () => {
        const freshSorts = new SortStore();
        const freshDrawings = new DrawingStore();
        const freshPlan = analyseHrxArchive(EXAMPLE, freshSorts, freshDrawings, { ui: true });
        expect(freshPlan.sorts.map(row => [row.name, row.kind, row.decision])).toEqual([
            ['Vertex', 'new', 'add'],
            ['Edge', 'new', 'add']
        ]);
        expect(freshPlan.drawings[0]).toMatchObject({ name: 'Example', kind: 'new', decision: 'add' });
        expect(validateHrxPlan(freshPlan, freshSorts, freshDrawings).hasErrors).toBe(false);

        const sortStore = new SortStore();
        registerDefaultSorts(sortStore);
        const drawingStore = new DrawingStore();
        loadHrxArchive(EXAMPLE, sortStore, drawingStore);

        const plan = analyseHrxArchive(EXAMPLE, sortStore, drawingStore, { ui: true });
        expect(plan.sorts.map(row => [row.name, row.kind])).toEqual([
            ['Vertex', 'existing'],
            ['Edge', 'existing']
        ]);
        expect(plan.sorts.every(row =>
            row.keepEquations && !row.replaceDrawFunctions && row.equationsEqual && !row.weakerEquations
        )).toBe(true);
        // The built-in sources differ textually from the ones in the example archive.
        expect(plan.sorts.every(row => !row.drawFunctionsEqual)).toBe(true);
        expect(plan.drawings[0]).toMatchObject({ requestedName: 'Example', kind: 'existing', decision: 'skip' });
    });

    it('commits only accepted rows and leaves the stores untouched on Skips', () => {
        const sortStore = new SortStore();
        const drawingStore = new DrawingStore();
        const plan = analyseHrxArchive(EXAMPLE, sortStore, drawingStore, { ui: true });

        for (const row of plan.sorts) row.decision = 'skip';
        plan.drawings[0].decision = 'skip';
        expect(validateHrxPlan(plan, sortStore, drawingStore).hasErrors).toBe(false);

        applyHrxImportPlan(EXAMPLE, plan, sortStore, drawingStore);
        expect(sortStore.getSortNames()).toEqual([]);
        expect(drawingStore.getAllNames()).toEqual([]);
    });

    it('reports and blocks a skipped sort needed by a kept drawing', () => {
        const sortStore = new SortStore();
        const drawingStore = new DrawingStore();
        const plan = analyseHrxArchive(EXAMPLE, sortStore, drawingStore, { ui: true });
        for (const row of plan.sorts) row.decision = 'skip';

        const validation = validateHrxPlan(plan, sortStore, drawingStore);
        expect(validation.hasErrors).toBe(true);
        expect(validation.drawingErrors[0]).toMatch(/Sort 'Vertex' is not available/);
        expect(() => applyHrxImportPlan(EXAMPLE, plan, sortStore, drawingStore))
            .toThrow(/Sort 'Vertex' is not available/);
        expect(sortStore.getSortNames()).toEqual([]);
    });

    it('allows an archive with a missing sort source', () => {
        const sections = parseHrx(EXAMPLE).sections;
        sections.delete('sorts/Edge.js');
        const archive = serializeHrx(sections);
        const sortStore = new SortStore();
        const drawingStore = new DrawingStore();

        const plan = analyseHrxArchive(archive, sortStore, drawingStore, { ui: true });
        expect(plan.sorts.find(row => row.name === 'Edge')!.error).toBeUndefined();
        expect(validateHrxPlan(plan, sortStore, drawingStore).hasErrors).toBe(false);

        applyHrxImportPlan(archive, plan, sortStore, drawingStore);
        expect(sortStore.getSortNames()).toEqual(['Vertex', 'Edge']);
        expect(sortStore.getSortSource('Edge')).toBeUndefined();
    });

    it('renames or replaces an existing drawing on request', () => {
        function modifiedExample(): string {
            const sections = parseHrx(EXAMPLE).sections;
            const drawings = JSON.parse(sections.get('drawings.json')!);
            drawings.drawings[0].artefacts[0].data.position = [999, 999];
            sections.set('drawings.json', JSON.stringify(drawings));
            return serializeHrx(sections);
        }

        const renamedSorts = new SortStore();
        registerDefaultSorts(renamedSorts);
        const renamedDrawings = new DrawingStore();
        loadHrxArchive(EXAMPLE, renamedSorts, renamedDrawings);
        const archive = modifiedExample();
        const renamePlan = analyseHrxArchive(archive, renamedSorts, renamedDrawings, { ui: true });
        expect(renamePlan.drawings[0].decision).toBe('skip');
        renamePlan.drawings[0].decision = 'rename';
        renamePlan.drawings[0].renameTo = 'Imported copy';
        applyHrxImportPlan(archive, renamePlan, renamedSorts, renamedDrawings);
        expect(renamedDrawings.getDrawing('Imported copy')).toBeDefined();
        expect(renamedDrawings.getDrawing('Example')!.drawing.getArtefacts()[0].data.position)
            .toEqual([218, 345]);

        const replaceSorts = new SortStore();
        registerDefaultSorts(replaceSorts);
        const replaceDrawings = new DrawingStore();
        loadHrxArchive(EXAMPLE, replaceSorts, replaceDrawings);
        const replacePlan = analyseHrxArchive(archive, replaceSorts, replaceDrawings, { ui: true });
        replacePlan.drawings[0].decision = 'replace';
        applyHrxImportPlan(archive, replacePlan, replaceSorts, replaceDrawings);
        expect(replaceDrawings.getDrawing('Example')!.drawing.getArtefacts()[0].data.position)
            .toEqual([999, 999]);
    });

    it('suggests unique names for duplicate drawing names inside one archive', () => {
        const sections = parseHrx(EXAMPLE).sections;
        const drawings = JSON.parse(sections.get('drawings.json')!);
        drawings.drawings.push(structuredClone(drawings.drawings[0]));
        sections.set('drawings.json', JSON.stringify(drawings));
        const archive = serializeHrx(sections);

        const sortStore = new SortStore();
        const drawingStore = new DrawingStore();
        const plan = analyseHrxArchive(archive, sortStore, drawingStore, { ui: true });
        expect(plan.drawings.map(row => row.name)).toEqual(['Example', 'Example (1)']);

        applyHrxImportPlan(archive, plan, sortStore, drawingStore);
        expect(drawingStore.getDrawing('Example')).toBeDefined();
        expect(drawingStore.getDrawing('Example (1)')).toBeDefined();
    });

    it('applies the two existing-sort toggles independently', () => {
        const archiveSorts = newSortStore();
        const archiveDrawing = new Drawing(archiveSorts);
        const v = makeVertex(archiveDrawing, 'v');
        const e1 = makeEdge(archiveDrawing, 'e1', v, v);
        const e2 = makeEdge(archiveDrawing, 'e2', v, v);
        const e3 = makeEdge(archiveDrawing, 'e3', v, v);
        archiveDrawing.newArtefact('Triangle', { '1': e1, '2': e2, o: e3 }, { bend: 0 }, 'root');
        const archiveStore = new DrawingStore();
        archiveStore.addDrawing('TriangleDrawing', archiveDrawing);

        const sections = parseHrx(exportHrx(['TriangleDrawing'], archiveSorts, archiveStore)).sections;
        sections.set('sorts/Vertex.js', `${sections.get('sorts/Vertex.js')}\n// preview marker\n`);
        const records = JSON.parse(sections.get('sorts.json')!);
        records.find((record: { name: string }) => record.name === 'Triangle').equations = [];
        sections.set('sorts.json', JSON.stringify(records));
        const archive = serializeHrx(sections);

        const workspace = newSortStore();
        const originalEquations = workspace.getSort('Triangle')!.equations.length;
        const originalBody = workspace.getSortSource('Vertex')!.drawBody;
        const plan = analyseHrxArchive(archive, workspace, new DrawingStore(), { ui: true });

        const triangle = plan.sorts.find(row => row.name === 'Triangle')!;
        expect(triangle.equationsEqual).toBe(false);
        expect(triangle.weakerEquations).toBe(true);
        expect(triangle.keepEquations).toBe(true);
        triangle.keepEquations = false;
        const vertex = plan.sorts.find(row => row.name === 'Vertex')!;
        expect(vertex.equationsEqual).toBe(true);
        expect(vertex.drawFunctionsEqual).toBe(false);
        vertex.replaceDrawFunctions = true;

        applyHrxImportPlan(archive, plan, workspace, new DrawingStore());
        expect(workspace.getSort('Triangle')!.equations.length).toBeLessThan(originalEquations);
        expect(workspace.getSortSource('Vertex')!.drawBody).toContain('preview marker');
        expect(workspace.getSortSource('Vertex')!.drawBody).not.toBe(originalBody);
    });

    it('reports incompatible equations without marking them as weaker', () => {
        const sortStore = newSortStore();
        const drawing = new Drawing(sortStore);
        const v = makeVertex(drawing, 'v');
        const e1 = makeEdge(drawing, 'e1', v, v);
        const e2 = makeEdge(drawing, 'e2', v, v);
        const e3 = makeEdge(drawing, 'e3', v, v);
        drawing.newArtefact('Triangle', { '1': e1, '2': e2, o: e3 }, { bend: 0 }, 'root');
        const drawingStore = new DrawingStore();
        drawingStore.addDrawing('TriangleDrawing', drawing);

        const sections = parseHrx(exportHrx(['TriangleDrawing'], sortStore, drawingStore)).sections;
        const records = JSON.parse(sections.get('sorts.json')!);
        records.find((record: { name: string }) => record.name === 'Triangle').equations = ['1.source = 1.target'];
        sections.set('sorts.json', JSON.stringify(records));
        const archive = serializeHrx(sections);

        const plan = analyseHrxArchive(archive, sortStore, new DrawingStore(), { ui: true });
        const triangle = plan.sorts.find(row => row.name === 'Triangle')!;
        expect(triangle.equationsEqual).toBe(false);
        expect(triangle.weakerEquations).toBe(false);
        expect(triangle.error).toMatch(/different dependencies, data fields, or equations/);
    });

    it('never imports an identical drawing even if the plan requests a change', () => {
        const sortStore = new SortStore();
        registerDefaultSorts(sortStore);
        const drawingStore = new DrawingStore();
        loadHrxArchive(EXAMPLE, sortStore, drawingStore);
        const before = drawingStore.exportDrawingJSON('Example');

        const plan = analyseHrxArchive(EXAMPLE, sortStore, drawingStore, { ui: true });
        expect(plan.drawings[0]).toMatchObject({ collision: 'duplicate', decision: 'skip' });
        plan.drawings[0].decision = 'replace';
        applyHrxImportPlan(EXAMPLE, plan, sortStore, drawingStore);

        expect(drawingStore.getAllNames()).toEqual(['Example']);
        expect(drawingStore.exportDrawingJSON('Example')).toBe(before);
    });
});
