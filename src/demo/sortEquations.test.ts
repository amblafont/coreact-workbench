import { describe, expect, it } from 'vitest';
import {
    Drawing,
    DrawingStore,
    SortStore,
    findFirstOrderRuleApplications,
    type Artefact
} from '../index.svelte.ts';
import { exportDrawingsToRocq } from '../rocq_export.ts';
import { parseHrx } from '../hrx/codec.ts';
import { exportHrx } from '../hrx/export.ts';
import { loadHrxArchive } from '../hrx/load.ts';
import { newSortStore, makeVertex, makeEdge } from './helpers.ts';

function triangleEdges(drawing: Drawing): Record<string, Artefact> {
    const v = makeVertex(drawing, 'v');
    return {
        '1': makeEdge(drawing, 'e1', v, v),
        '2': makeEdge(drawing, 'e2', v, v),
        o: makeEdge(drawing, 'o', v, v)
    };
}

describe('sort equations', () => {
    it('parses n-ary and chained equations when the sort is declared', () => {
        const sortStore = newSortStore();
        const triangle = sortStore.getSort('Triangle')!;
        expect(triangle.equations.map(eq => eq.raw)).toEqual([
            '1.source = o.source',
            '1.target = 2.source',
            '2.target = o.target'
        ]);
        expect(triangle.equations[0].paths).toEqual([['1', 'source'], ['o', 'source']]);

        sortStore.newSort(
            'Chain',
            { a: 'Edge', b: 'Edge', c: 'Edge' },
            {},
            () => null,
            undefined,
            ['a.source = b.source = c.source']
        );
        expect(sortStore.getSort('Chain')!.equations[0].paths).toHaveLength(3);

        expect(() => sortStore.newSort(
            'BadPath', { a: 'Edge' }, {}, () => null, undefined, ['a.missing = a.source']
        )).toThrow(/unknown dependency 'missing'/);
        expect(() => sortStore.newSort(
            'BadDepth', { a: 'Edge' }, {}, () => null, undefined, ['a = a.source']
        )).toThrow(/must end at a dependency with no dependencies/);
    });

    it('rejects triangles whose endpoints are not provably equal, and accepts those that are', () => {
        const strict = makeDrawingForSorts();
        const a = makeVertex(strict, 'a');
        const b = makeVertex(strict, 'b');
        const c = makeVertex(strict, 'c');
        const invalid = {
            '1': makeEdge(strict, 'ac', a, c),
            '2': makeEdge(strict, 'cb', c, b),
            o: makeEdge(strict, 'ba', b, a)
        };
        expect(() => strict.newArtefact('Triangle', invalid, {}, 'root'))
            .toThrow(/violates equation '1.source = o.source'/);

        const provable = makeDrawingForSorts();
        const x = makeVertex(provable, 'x');
        const y = makeVertex(provable, 'y');
        const z = makeVertex(provable, 'z');
        provable.newEqualityArtefact([x, y], 'root');
        expect(provable.newArtefact('Triangle', {
            '1': makeEdge(provable, 'xz', x, z),
            '2': makeEdge(provable, 'zy', z, y),
            o: makeEdge(provable, 'yx', y, x)
        }, {}, 'root')).toBeDefined();
    });

    it('validates deep paths through dependency sorts', () => {
        const sortStore = newSortStore();
        sortStore.newSort('Wrap', { t: 'Triangle' }, {}, () => null, undefined, [
            't.1.source = t.o.source = t.2.target'
        ]);
        const drawing = new Drawing(sortStore);

        const bad = makeVertex(drawing, 'bad');
        const other = makeVertex(drawing, 'other');
        const badTriangle = drawing.newArtefact('Triangle', {
            '1': makeEdge(drawing, 'bad1', bad, other),
            '2': makeEdge(drawing, 'bad2', other, other),
            o: makeEdge(drawing, 'bado', other, bad)
        }, {}, 'root', false);
        expect(() => drawing.newArtefact('Wrap', { t: badTriangle }, {}, 'root'))
            .toThrow(/violates equation 't.1.source = t.o.source = t.2.target'/);

        const goodTriangle = drawing.newArtefact('Triangle', triangleEdges(drawing), {}, 'root');
        expect(drawing.newArtefact('Wrap', { t: goodTriangle }, {}, 'root')).toBeDefined();
    });

    it('rolls back mutations that break an existing equation', () => {
        const drawing = makeDrawingForSorts();
        const x = makeVertex(drawing, 'x');
        const y = makeVertex(drawing, 'y');
        const z = makeVertex(drawing, 'z');
        const w = makeVertex(drawing, 'w');
        const xy = drawing.newEqualityArtefact([x, y], 'root');
        const zw = drawing.newEqualityArtefact([z, w], 'root');
        const triangle = drawing.newArtefact('Triangle', {
            '1': makeEdge(drawing, 'yz', y, z),
            '2': makeEdge(drawing, 'zw', z, w),
            o: makeEdge(drawing, 'xz', x, z)
        }, {}, 'root');

        expect(() => drawing.removeEqualityChild(xy, x)).toThrow(/violates equation/);
        expect(drawing.getArtefacts()).toContain(xy);
        expect(drawing.getArtefacts()).toContain(triangle);

        drawing.addLayer('child', 'Child', 'root');
        expect(() => drawing.setArtefactLayer(zw, 'child')).toThrow(/violates equation/);
        expect(zw.layerId).toBe('root');
    });

    it('round-trips equations through HRX and detects schema conflicts', () => {
        const sortStore = newSortStore();
        const drawing = new Drawing(sortStore);
        drawing.newArtefact('Triangle', triangleEdges(drawing), {}, 'root');
        const drawingStore = new DrawingStore();
        drawingStore.addDrawing('TriangleDrawing', drawing);

        const hrx = exportHrx(['TriangleDrawing'], sortStore, drawingStore);
        const records = JSON.parse(parseHrx(hrx).sections.get('sorts.json')!) as Array<{
            name: string;
            equations?: string[];
        }>;
        expect(records.find(record => record.name === 'Triangle')!.equations).toEqual([
            '1.source = o.source',
            '1.target = 2.source',
            '2.target = o.target'
        ]);

        const freshSorts = new SortStore();
        const freshDrawings = new DrawingStore();
        const loaded = loadHrxArchive(hrx, freshSorts, freshDrawings);
        expect(loaded.sortsAdded).toContain('Triangle');
        expect(freshSorts.getSort('Triangle')!.equations).toHaveLength(3);

        const legacySorts = new SortStore();
        legacySorts.newSort('Vertex', {}, { position: 'position' }, () => null);
        legacySorts.newSort('Edge', { source: 'Vertex', target: 'Vertex' }, {}, () => null);
        legacySorts.newSort('Triangle', { '1': 'Edge', '2': 'Edge', o: 'Edge' }, {}, () => null);
        expect(() => loadHrxArchive(hrx, legacySorts, new DrawingStore()))
            .toThrow(/different dependencies, data fields, or equations/);
    });

    it('constrains rule matching and provability checks by sort equations', () => {
        const sortStore = newSortStore();

        const rule = new Drawing(sortStore);
        const rx = makeVertex(rule, 'rx');
        rule.newArtefact('Triangle', {
            '1': makeEdge(rule, 're1', rx, rx),
            '2': makeEdge(rule, 're2', rx, rx),
            o: makeEdge(rule, 'ro', rx, rx)
        }, {}, 'root');
        rule.addLayer('conclusion', 'Conclusion', 'root');
        makeEdge(rule, 'conclusion-edge', rx, rx, 'conclusion');
        rule.setIsRule(true);

        const invalidHost = new Drawing(sortStore);
        const a = makeVertex(invalidHost, 'a');
        const b = makeVertex(invalidHost, 'b');
        const c = makeVertex(invalidHost, 'c');
        invalidHost.newArtefact('Triangle', {
            '1': makeEdge(invalidHost, 'ac', a, c),
            '2': makeEdge(invalidHost, 'cb', c, b),
            o: makeEdge(invalidHost, 'ba', b, a)
        }, {}, 'root', false);
        expect(findFirstOrderRuleApplications(rule, invalidHost, { flexible: true })).toHaveLength(0);

        invalidHost.newEqualityArtefact([a, b], 'root');
        invalidHost.newEqualityArtefact([a, c], 'root');
        expect(findFirstOrderRuleApplications(rule, invalidHost, { flexible: true })).toHaveLength(1);

        const provability = new Drawing(sortStore);
        const pa = makeVertex(provability, 'pa');
        const pb = makeVertex(provability, 'pb');
        const pc = makeVertex(provability, 'pc');
        provability.newArtefact('Triangle', {
            '1': makeEdge(provability, 'pac', pa, pc),
            '2': makeEdge(provability, 'pcb', pc, pb),
            o: makeEdge(provability, 'pba', pb, pa)
        }, {}, 'root', false);
        const px = makeVertex(provability, 'px');
        provability.addLayer('conclusion', 'Conclusion', 'root');
        provability.newArtefact('Triangle', {
            '1': makeEdge(provability, 'ce1', px, px),
            '2': makeEdge(provability, 'ce2', px, px),
            o: makeEdge(provability, 'co', px, px)
        }, {}, 'conclusion');
        expect(provability.checkLayerProvable('conclusion').provable).toBe(false);
    });

    it('exports unified Rocq headers, including nested sorts', () => {
        const sortStore = newSortStore();
        sortStore.newSort('Wrap', { t: 'Triangle' }, {}, () => null, undefined, [
            't.1.source = t.o.source'
        ]);
        const drawingStore = new DrawingStore();
        drawingStore.addDrawing('D', new Drawing(sortStore));
        const code = exportDrawingsToRocq(drawingStore.getAllDrawings(), sortStore);

        expect(code).toContain(
            'Parameter Triangle : forall `(x1_source : Vertex) `(x1_target : Vertex) `(x2_target : Vertex), ' +
            'Edge x1_source x1_target -> Edge x1_target x2_target -> Edge x1_source x2_target -> Type.'
        );
        expect(code).toContain(
            'Parameter Wrap : forall `(t_1_source : Vertex) `(t_1_target : Vertex) `(t_1 : Edge t_1_source t_1_target) ' +
            '`(t_2_target : Vertex) `(t_2 : Edge t_1_target t_2_target) `(t_o : Edge t_1_source t_2_target), ' +
            'Triangle t_1 t_2 t_o -> Type.'
        );
    });
});

function makeDrawingForSorts(): Drawing {
    return new Drawing(newSortStore());
}
