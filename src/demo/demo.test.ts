import { describe, it, expect } from 'vitest';
import { buildDemo, newDemoContext } from './buildDemo';

describe('default sort registration', () => {
    it('registers the five default sorts', () => {
        const { sortStore } = newDemoContext();
        const names = sortStore.getAllSorts().map(s => s.name);
        expect(names).toEqual(expect.arrayContaining(['Vertex', 'Edge', 'Pullback', 'Triangle', 'Equality']));
    });
});

describe('demo drawing construction', () => {
    it('builds the full demo drawing with expected layers and artefacts', () => {
        const ctx = newDemoContext();
        buildDemo(ctx);
        const { drawing } = ctx;

        const layerNames = drawing.getAllLayers().map(l => l.name);
        expect(layerNames).toContain('Root Layer');
        expect(layerNames).toContain('Child Layer 1');
        expect(layerNames).toContain('Child Layer 2');
        expect(layerNames).toContain('Leaf Layer');

        const artefacts = drawing.getArtefacts();
        const labels = artefacts.map(a => a.data.label).filter(Boolean);
        expect(labels).toContain('v0');
        expect(labels).toContain('v1');
        expect(labels).toContain('v2');
        expect(labels).toContain('e0');
        expect(labels).toContain('e1');
        expect(labels).toContain('e2');
        expect(labels).toContain('A');
        expect(labels).toContain('p1');
        expect(labels).toContain('p2');
        expect(labels).toContain('q1');
        expect(labels).toContain('q2');
        expect(labels).toContain('r1');
        expect(labels).toContain('r2');
        expect(labels).toContain('cd0');

        expect(artefacts.some(a => a.sortName === 'Pullback')).toBe(true);
        expect(artefacts.some(a => a.sortName === 'Triangle')).toBe(true);
        expect(artefacts.some(a => a.sortName === 'Equality')).toBe(true);

        expect(labels).not.toContain('tv0');
        expect(labels).not.toContain('tv1');
        expect(labels).not.toContain('te0');
    });
});

describe('demo drawing store', () => {
    it('saves and reloads the demo and rule drawings', () => {
        const ctx = newDemoContext();
        buildDemo(ctx);
        const { drawingStore, drawing } = ctx;

        const expectedNames = [
            'Initial Drawing',
            'Rule Drawing Demo',
            'ComposableEdges',
            'IsMonoInChildLayer',
            'IsMonoInRoot',
            'ComposableEdgesChildEq',
            'ChildEqApply',
            'SecondOrderComp',
            'SharedEdgeTriangles',
            'SimpleMono'
        ];
        for (const name of expectedNames) {
            expect(drawingStore.getDrawing(name)).toBeDefined();
        }

        const initial = drawingStore.getDrawing('Initial Drawing')!;
        const demo = drawingStore.getDrawing('Rule Drawing Demo')!;
        const comp = drawingStore.getDrawing('ComposableEdges')!;
        const soComp = drawingStore.getDrawing('SecondOrderComp')!;

        expect(initial.drawing.isRule).toBe(false);
        expect(demo.drawing.isRule).toBe(false);
        expect(comp.drawing.isRule).toBe(true);
        expect(drawingStore.checkIsFirstOrder(comp.drawing)).toBe(true);
        expect(soComp.drawing.isRule).toBe(true);
        expect(drawingStore.checkIsFirstOrder(soComp.drawing)).toBe(false);

        // buildDemo stores a clone of the canvas drawing as 'Rule Drawing Demo'
        // while the canvas drawing itself keeps its content
        expect(drawing.isRule).toBe(false);
        expect(drawing.getArtefacts().length).toBe(demo.drawing.getArtefacts().length);
    });
});
