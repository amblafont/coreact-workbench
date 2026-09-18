import { describe, it, expect } from 'vitest';
import { EqualityArtefact } from '../index.svelte.ts';
import { makeDrawing, makeVertex, makeEdge } from './helpers';

describe('consistency checks', () => {
    it('rejects an invalid position attribute', () => {
        const drawing = makeDrawing();
        expect(() =>
            drawing.newArtefact('Vertex', {}, { position: '200, 300', label: 'InvalidPos' })
        ).toThrowError(/Consistency Check Failed/);
    });

    it('rejects a missing dependency', () => {
        const drawing = makeDrawing();
        const v0 = makeVertex(drawing, 'v0');
        expect(() =>
            drawing.newArtefact('Edge', { source: v0 }, { width: 4, bend: 0 })
        ).toThrowError(/Consistency Check Failed/);
    });

    it('rejects a wrong dependency type', () => {
        const drawing = makeDrawing();
        const v0 = makeVertex(drawing, 'v0');
        const v1 = makeVertex(drawing, 'v1');
        const e0 = makeEdge(drawing, 'e0', v0, v1);
        expect(() =>
            drawing.newArtefact('Edge', { source: v0, target: e0 }, { width: 4, bend: 0 })
        ).toThrowError(/Consistency Check Failed/);
    });

    it('rejects an unexpected dependency', () => {
        const drawing = makeDrawing();
        const v0 = makeVertex(drawing, 'v0');
        const v1 = makeVertex(drawing, 'v1');
        expect(() =>
            drawing.newArtefact('Edge', { source: v0, target: v1, unexpected: v0 }, { width: 4, bend: 0 })
        ).toThrowError(/Consistency Check Failed/);
    });

    it('rejects a dependency on an artefact not in a lower ancestor layer', () => {
        const drawing = makeDrawing();
        drawing.addLayer('layer-1', 'Child Layer 1', 'root');
        const v0 = makeVertex(drawing, 'v0');
        const v1 = drawing.newArtefact('Vertex', {}, { position: [100, 100], label: 'v_top' }, 'layer-1');
        expect(() =>
            drawing.newArtefact('Edge', { source: v0, target: v1 }, { width: 2, bend: 0, label: 'invalid_edge' }, 'root')
        ).toThrowError(/Consistency Check Failed/);
    });
});

describe('Drawing.getBestLayerForDependencies', () => {
    it('returns null for no dependencies', () => {
        const drawing = makeDrawing();
        expect(drawing.getBestLayerForDependencies([])).toBeNull();
    });

    it('returns the dependency layer when there is a single dependency', () => {
        const drawing = makeDrawing();
        drawing.addLayer('child', 'Child', 'root');
        const v0 = drawing.newArtefact('Vertex', {}, { position: [0, 0], label: 'v0' }, 'child');
        expect(drawing.getBestLayerForDependencies([v0.layerId])).toBe('child');
    });

    it('returns the deepest layer when all deps live there or in an ancestor', () => {
        const drawing = makeDrawing();
        drawing.addLayer('mid', 'Mid', 'root');
        drawing.addLayer('deep', 'Deep', 'mid');
        const vRoot = makeVertex(drawing, 'vRoot');
        const vMid = drawing.newArtefact('Vertex', {}, { position: [0, 0], label: 'vMid' }, 'mid');
        const vDeep = drawing.newArtefact('Vertex', {}, { position: [0, 0], label: 'vDeep' }, 'deep');
        expect(drawing.getBestLayerForDependencies([vRoot.layerId, vMid.layerId, vDeep.layerId])).toBe('deep');
    });

    it('returns null when a dep is not in the deepest layer or its ancestors', () => {
        const drawing = makeDrawing();
        drawing.addLayer('root2', 'Root 2', null, '#e74c3c');
        drawing.addLayer('a', 'A', 'root');
        drawing.addLayer('b', 'B', 'root2');
        const va = drawing.newArtefact('Vertex', {}, { position: [0, 0], label: 'va' }, 'a');
        const vb = drawing.newArtefact('Vertex', {}, { position: [0, 0], label: 'vb' }, 'b');
        expect(drawing.getBestLayerForDependencies([va.layerId, vb.layerId])).toBeNull();
    });
});

describe('equality artefacts', () => {
    it('creates an equality artefact and merges overlapping children on the same layer', () => {
        const drawing = makeDrawing();
        const v0 = makeVertex(drawing, 'v0');
        const v1 = makeVertex(drawing, 'v1');
        const v2 = makeVertex(drawing, 'v2');

        const eq1 = drawing.newEqualityArtefact([v0, v1], 'root');
        expect(eq1).toBeInstanceOf(EqualityArtefact);
        expect(eq1.children).toHaveLength(2);

        const eq2 = drawing.newEqualityArtefact([v1, v2], 'root');
        expect(eq2).toBeInstanceOf(EqualityArtefact);
        expect(eq2.children).toHaveLength(3);
        expect(eq1.children).toHaveLength(3);
    });

    it('does not merge equalities created in different layers', () => {
        const drawing = makeDrawing();
        drawing.addLayer('layer-1', 'Child Layer 1', 'root');
        const v0 = makeVertex(drawing, 'v0');
        const v1 = makeVertex(drawing, 'v1');
        const v2 = makeVertex(drawing, 'v2');
        const sq_v0 = drawing.newArtefact('Vertex', {}, { position: [400, 400], label: 'A' }, 'root');

        const eqRoot = drawing.newEqualityArtefact([v0, v1], 'root');
        const eqLayer1 = drawing.newEqualityArtefact([v2, sq_v0], 'layer-1');

        expect(eqRoot.children).toHaveLength(2);
        expect(eqLayer1.children).toHaveLength(2);
        expect(eqRoot).not.toBe(eqLayer1);
    });

    it('rejects a degenerate equality (fewer than 2 distinct elements)', () => {
        const drawing = makeDrawing();
        const v0 = makeVertex(drawing, 'v0');
        expect(() => drawing.newEqualityArtefact([v0], 'root')).toThrowError(/Consistency Check Failed/);
    });

    it('rejects an equality across different sorts', () => {
        const drawing = makeDrawing();
        const v0 = makeVertex(drawing, 'v0');
        const v1 = makeVertex(drawing, 'v1');
        const p1 = makeEdge(drawing, 'p1', v0, v1);
        expect(() => drawing.newEqualityArtefact([v0, p1], 'root')).toThrowError(/Consistency Check Failed/);
    });

    it('rejects an equality between artefacts with non-equal dependencies', () => {
        const drawing = makeDrawing();
        const v0 = makeVertex(drawing, 'v0');
        const v1 = makeVertex(drawing, 'v1');
        const v2 = makeVertex(drawing, 'v2');
        const e0 = makeEdge(drawing, 'e0', v0, v1);
        const e1 = makeEdge(drawing, 'e1', v1, v2);
        expect(() => drawing.newEqualityArtefact([e1, e0], 'root')).toThrowError(/Consistency Check Failed/);
    });
});

describe('artefact merge', () => {
    it('merges two vertices and updates dependent artefacts', () => {
        const drawing = makeDrawing();
        drawing.addLayer('layer-1', 'Child Layer 1', 'root');
        const tv0 = drawing.newArtefact('Vertex', {}, { position: [100, 100], label: 'tv0' }, 'root');
        const tv1 = drawing.newArtefact('Vertex', {}, { position: [200, 200], label: 'tv1' }, 'root');
        const sq_v1 = drawing.newArtefact('Vertex', {}, { position: [600, 400], label: 'B' }, 'root');
        const te0 = drawing.newArtefact('Edge', { source: tv0, target: sq_v1 }, { width: 2, bend: 0, label: 'te0' }, 'layer-1');

        expect(drawing.areDependenciesEqual(tv0, tv1)).toBe(true);

        const merged = drawing.mergeArtefacts(tv0, tv1);
        expect(merged).toBe(tv1);
        expect(merged.data.label).toBe('tv0, tv1');
        expect(merged.data.position).toEqual([200, 200]);
        expect(te0.dependencies.source).toBe(merged);
        expect(drawing.getArtefacts()).not.toContain(tv0);
    });

    it('rejects merging artefacts of different sorts/dependencies', () => {
        const drawing = makeDrawing();
        const v0 = makeVertex(drawing, 'v0');
        const v1 = makeVertex(drawing, 'v1');
        const edge = makeEdge(drawing, 'e0', v0, v1);
        expect(() => drawing.mergeArtefacts(v0, edge)).toThrowError(/Consistency Check Failed/);
    });

    it('rejects merging an artefact with itself', () => {
        const drawing = makeDrawing();
        const v0 = makeVertex(drawing, 'v0');
        expect(() => drawing.mergeArtefacts(v0, v0)).toThrowError(/Consistency Check Failed/);
    });
});

describe('artefact duplicate', () => {
    it('duplicates a vertex and adds an equality artefact relating them', () => {
        const drawing = makeDrawing();
        const v0 = drawing.newArtefact('Vertex', {}, { position: [100, 200], label: 'v0' }, 'root');

        const { artefact: v0Dup, equality } = drawing.duplicateArtefact(v0, {}, { position: [150, 250], label: 'v0_copy' }, 'root');

        expect(v0Dup).toBeDefined();
        expect(v0Dup.sortName).toBe('Vertex');
        expect(v0Dup.data.label).toBe('v0_copy');
        expect(v0Dup.data.position).toEqual([150, 250]);
        expect(v0Dup).not.toBe(v0);

        expect(equality).toBeDefined();
        expect(equality.sortName).toBe('Equality');
        expect(drawing.areEqual(v0, v0Dup, 'root')).toBe(true);
        expect(drawing.areProvablyEqual(v0, v0Dup)).toBe(true);
    });

    it('duplicates an edge with identical dependencies and relates them with equality', () => {
        const drawing = makeDrawing();
        const v0 = makeVertex(drawing, 'v0');
        const v1 = makeVertex(drawing, 'v1');
        const e0 = makeEdge(drawing, 'e0', v0, v1);

        const { artefact: e0Dup, equality } = drawing.duplicateArtefact(
            e0,
            { source: v0, target: v1 },
            { width: 3, bend: 0, label: 'e0_copy' },
            'root'
        );

        expect(e0Dup).toBeDefined();
        expect(e0Dup.sortName).toBe('Edge');
        expect(e0Dup.data.width).toBe(3);
        expect(e0Dup.dependencies.source).toBe(v0);
        expect(e0Dup.dependencies.target).toBe(v1);

        expect(equality).toBeDefined();
        expect(drawing.areEqual(e0, e0Dup, 'root')).toBe(true);
        expect(drawing.areProvablyEqual(e0, e0Dup)).toBe(true);
    });

    it('duplicates an edge with provably equal alternative dependencies', () => {
        const drawing = makeDrawing();
        const v0 = makeVertex(drawing, 'v0');
        const v0Alt = makeVertex(drawing, 'v0Alt');
        const v1 = makeVertex(drawing, 'v1');

        // Relate v0 and v0Alt by equality
        drawing.newEqualityArtefact([v0, v0Alt], 'root');
        expect(drawing.areEqual(v0, v0Alt, 'root')).toBe(true);

        const e0 = makeEdge(drawing, 'e0', v0, v1);

        // Duplicate e0 using v0Alt instead of v0 as source
        const { artefact: e0Dup } = drawing.duplicateArtefact(
            e0,
            { source: v0Alt, target: v1 },
            { width: 2, bend: 0, label: 'e0_dup' },
            'root'
        );

        expect(e0Dup.dependencies.source).toBe(v0Alt);
        expect(drawing.areEqual(e0, e0Dup, 'root')).toBe(true);
    });

    it('rejects duplicating with dependencies that are not provably equal', () => {
        const drawing = makeDrawing();
        const v0 = makeVertex(drawing, 'v0');
        const v1 = makeVertex(drawing, 'v1');
        const v2 = makeVertex(drawing, 'v2');
        const e0 = makeEdge(drawing, 'e0', v0, v1);

        expect(() => {
            drawing.duplicateArtefact(
                e0,
                { source: v2, target: v1 },
                { width: 2, bend: 0, label: 'bad_dup' },
                'root'
            );
        }).toThrowError(/Consistency Check Failed: Dependency 'source' for duplicate of 'e0' must be provably equal/);
    });

    it('rejects duplicating an equality artefact', () => {
        const drawing = makeDrawing();
        const v0 = makeVertex(drawing, 'v0');
        const v1 = makeVertex(drawing, 'v1');
        const eq = drawing.newEqualityArtefact([v0, v1], 'root');

        expect(() => {
            drawing.duplicateArtefact(eq, {}, {}, 'root');
        }).toThrowError(/Consistency Check Failed: Cannot duplicate an equality artefact/);
    });

    it('rejects duplicating an artefact that is not in the drawing', () => {
        const drawing1 = makeDrawing();
        const drawing2 = makeDrawing();
        const v = makeVertex(drawing1, 'v');

        expect(() => {
            drawing2.duplicateArtefact(v, {}, { position: [0, 0] }, 'root');
        }).toThrowError(/Consistency Check Failed: Cannot duplicate an artefact that does not exist/);
    });
});

describe('layer provability', () => {
    it('is provable without isMono artefacts and non-provable when an isMono artefact is established in the layer', () => {
        const drawing = makeDrawing();
        drawing.addLayer('prov-child', 'Prov Child', 'root');
        const pv0 = makeVertex(drawing, 'pv0');
        const pv1 = makeVertex(drawing, 'pv1');
        const pre = makeEdge(drawing, 'pre', pv0, pv1);
        const pce = drawing.newArtefact('Edge', { source: pv0, target: pv1 }, { width: 2, bend: 0, label: 'pce' }, 'prov-child');

        drawing.addEqualityArtefactUnchecked([pre, pce], 'root');

        expect(drawing.checkLayerProvable('prov-child').provable).toBe(true);

        drawing.newArtefact('isMono', { arrow: pre }, {}, 'prov-child');

        expect(drawing.checkLayerProvable('prov-child').provable).toBe(false);
    });

    it('is provable if an isMono artefact is established in the layer and in an ancestor layer', () => {
        const drawing = makeDrawing();
        drawing.addLayer('prov-child', 'Prov Child', 'root');
        const pv0 = makeVertex(drawing, 'pv0');
        const pv1 = makeVertex(drawing, 'pv1');
        const pre = makeEdge(drawing, 'pre', pv0, pv1);
        const pce = drawing.newArtefact('Edge', { source: pv0, target: pv1 }, { width: 2, bend: 0, label: 'pce' }, 'prov-child');

        drawing.addEqualityArtefactUnchecked([pre, pce], 'root');

        // isMono established in root AND prov-child
        drawing.newArtefact('isMono', { arrow: pre }, {}, 'root');
        drawing.newArtefact('isMono', { arrow: pre }, {}, 'prov-child');

        expect(drawing.checkLayerProvable('prov-child').provable).toBe(true);
    });

    it('is provable when the parent layer has an artefact with the same dependencies', () => {
        const drawing = makeDrawing();
        drawing.addLayer('prov-child', 'Prov Child', 'root');
        const pv0 = makeVertex(drawing, 'pv0');
        const pv1 = makeVertex(drawing, 'pv1');
        makeEdge(drawing, 'pre', pv0, pv1);
        drawing.newArtefact('Edge', { source: pv0, target: pv1 }, { width: 2, bend: 0, label: 'pce' }, 'prov-child');

        expect(drawing.checkLayerProvable('prov-child').provable).toBe(true);
    });

    it('is not provable when the parent layer has no artefact with the same dependencies', () => {
        const drawing = makeDrawing();
        drawing.addLayer('prov-child', 'Prov Child', 'root');
        const pv0 = makeVertex(drawing, 'pv0');
        const pv1 = makeVertex(drawing, 'pv1');
        const pv2 = makeVertex(drawing, 'pv2');
        makeEdge(drawing, 'pre', pv0, pv1);
        makeEdge(drawing, 'pce', pv0, pv2, 'prov-child');

        expect(drawing.checkLayerProvable('prov-child').provable).toBe(false);
    });

    it('is provable when dependencies are provably equal to those of a parent artefact', () => {
        const drawing = makeDrawing();
        drawing.addLayer('prov-child', 'Prov Child', 'root');
        const pv0 = makeVertex(drawing, 'pv0');
        const pv1 = makeVertex(drawing, 'pv1');
        const pw0 = makeVertex(drawing, 'pw0');
        const pw1 = makeVertex(drawing, 'pw1');
        makeEdge(drawing, 'pre', pw0, pw1);
        makeEdge(drawing, 'pce', pv0, pv1, 'prov-child');
        drawing.newEqualityArtefact([pv0, pw0], 'root');
        drawing.newEqualityArtefact([pv1, pw1], 'root');

        expect(drawing.checkLayerProvable('prov-child').provable).toBe(true);
    });

    it('is provable when child vertices and edge match parent vertices and edge structurally', () => {
        const drawing = makeDrawing();
        drawing.addLayer('prov-child', 'Prov Child', 'root');
        const rx = makeVertex(drawing, 'rx');
        const ry = makeVertex(drawing, 'ry');
        makeEdge(drawing, 'rf', rx, ry);
        const ca = drawing.newArtefact('Vertex', {}, { position: [0, 0], label: 'ca' }, 'prov-child');
        const cb = drawing.newArtefact('Vertex', {}, { position: [0, 0], label: 'cb' }, 'prov-child');
        drawing.newArtefact('Edge', { source: ca, target: cb }, { width: 2, bend: 0, label: 'ce' }, 'prov-child');

        expect(drawing.checkLayerProvable('prov-child').provable).toBe(true);
    });

    it('is not provable when the child edge is reversed', () => {
        const drawing = makeDrawing();
        drawing.addLayer('prov-child', 'Prov Child', 'root');
        const a = makeVertex(drawing, 'a');
        const b = makeVertex(drawing, 'b');
        makeEdge(drawing, 'f', a, b);
        drawing.newArtefact('Edge', { source: b, target: a }, { width: 2, bend: 0, label: 'g' }, 'prov-child');

        expect(drawing.checkLayerProvable('prov-child').provable).toBe(false);
    });

    it('is provable with non-injective matching when only one parent vertex is available', () => {
        const drawing = makeDrawing();
        drawing.addLayer('prov-child', 'Prov Child', 'root');
        const x = makeVertex(drawing, 'x');
        makeEdge(drawing, 'loop', x, x);
        const ca = drawing.newArtefact('Vertex', {}, { position: [0, 0], label: 'ca' }, 'prov-child');
        const cb = drawing.newArtefact('Vertex', {}, { position: [0, 0], label: 'cb' }, 'prov-child');
        drawing.newArtefact('Edge', { source: ca, target: cb }, { width: 2, bend: 0, label: 'ce' }, 'prov-child');

        expect(drawing.checkLayerProvable('prov-child').provable).toBe(true);
    });

    it('is provable when a child equality premise is discharged by a parent equality', () => {
        const drawing = makeDrawing();
        drawing.addLayer('prov-child', 'Prov Child', 'root');
        const rx = makeVertex(drawing, 'rx');
        const ry = makeVertex(drawing, 'ry');
        makeEdge(drawing, 'rf', rx, ry);
        const ca = drawing.newArtefact('Vertex', {}, { position: [0, 0], label: 'ca' }, 'prov-child');
        const cb = drawing.newArtefact('Vertex', {}, { position: [0, 0], label: 'cb' }, 'prov-child');
        drawing.newArtefact('Edge', { source: ca, target: cb }, { width: 2, bend: 0, label: 'ce' }, 'prov-child');
        drawing.addEqualityArtefactUnchecked([ca, cb], 'prov-child');
        drawing.addEqualityArtefactUnchecked([rx, ry], 'root');

        expect(drawing.checkLayerProvable('prov-child').provable).toBe(true);
    });

    it('is not provable when a child equality premise is not discharged by the parent', () => {
        const drawing = makeDrawing();
        drawing.addLayer('prov-child', 'Prov Child', 'root');
        const rx = makeVertex(drawing, 'rx');
        const ry = makeVertex(drawing, 'ry');
        makeEdge(drawing, 'rf', rx, ry);
        const ca = drawing.newArtefact('Vertex', {}, { position: [0, 0], label: 'ca' }, 'prov-child');
        const cb = drawing.newArtefact('Vertex', {}, { position: [0, 0], label: 'cb' }, 'prov-child');
        drawing.newArtefact('Edge', { source: ca, target: cb }, { width: 2, bend: 0, label: 'ce' }, 'prov-child');
        drawing.addEqualityArtefactUnchecked([ca, cb], 'prov-child');

        expect(drawing.checkLayerProvable('prov-child').provable).toBe(false);
    });

    it('matches two child edges sharing a vertex against a parent sharing that vertex', () => {
        const drawing = makeDrawing();
        drawing.addLayer('prov-child', 'Prov Child', 'root');
        const rx = makeVertex(drawing, 'rx');
        const ry = makeVertex(drawing, 'ry');
        const rz = makeVertex(drawing, 'rz');
        makeEdge(drawing, 'r1', rx, ry);
        makeEdge(drawing, 'r2', ry, rz);
        const ca = drawing.newArtefact('Vertex', {}, { position: [0, 0], label: 'ca' }, 'prov-child');
        const cb = drawing.newArtefact('Vertex', {}, { position: [0, 0], label: 'cb' }, 'prov-child');
        const cc = drawing.newArtefact('Vertex', {}, { position: [0, 0], label: 'cc' }, 'prov-child');
        drawing.newArtefact('Edge', { source: ca, target: cb }, { width: 2, bend: 0, label: 'c1' }, 'prov-child');
        drawing.newArtefact('Edge', { source: cb, target: cc }, { width: 2, bend: 0, label: 'c2' }, 'prov-child');

        expect(drawing.checkLayerProvable('prov-child').provable).toBe(true);
    });

    it('does not match two child edges sharing a vertex against a parent that does not share it', () => {
        const drawing = makeDrawing();
        drawing.addLayer('prov-child', 'Prov Child', 'root');
        const rx = makeVertex(drawing, 'rx');
        const ry = makeVertex(drawing, 'ry');
        const rz = makeVertex(drawing, 'rz');
        const rw = makeVertex(drawing, 'rw');
        makeEdge(drawing, 'r1', rx, ry);
        makeEdge(drawing, 'r2', rz, rw);
        const ca = drawing.newArtefact('Vertex', {}, { position: [0, 0], label: 'ca' }, 'prov-child');
        const cb = drawing.newArtefact('Vertex', {}, { position: [0, 0], label: 'cb' }, 'prov-child');
        const cc = drawing.newArtefact('Vertex', {}, { position: [0, 0], label: 'cc' }, 'prov-child');
        drawing.newArtefact('Edge', { source: ca, target: cb }, { width: 2, bend: 0, label: 'c1' }, 'prov-child');
        drawing.newArtefact('Edge', { source: cb, target: cc }, { width: 2, bend: 0, label: 'c2' }, 'prov-child');

        expect(drawing.checkLayerProvable('prov-child').provable).toBe(false);
    });
});
