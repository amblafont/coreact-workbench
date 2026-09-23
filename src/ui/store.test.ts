import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SvelteSet } from 'svelte/reactivity';
import { getDrawing, drawingStore, ui, sortStore, rocqRecorder, syncProvedStatus, getSelectedDrawingNames, deleteSelectedDrawings, renameDrawingName, pushToast, dismissToast, applyRuleAt,
    resetInteractionState, togglePositionPicker, isPositionPickerActive, isDraftPickerActive,
    applyPickedPosition, startPositionPicker, selectArtefactToInspect, removeArtefactNode,
    toggleEqualityExtend, equalityChildren, onArtefactNodeClick, createDraftArtefact,
    splitFirstOrderRecording, openProofEditor, closeProofEditor, updateDrawingRocqProof, suggestAdmittedProof, toggleRocqRecording
} from './store.svelte.ts';
import { Drawing, DrawingStore, getFirstOrderStatementChildLayer } from '../index.svelte.ts';
import { registerDefaultSorts } from '../demo/buildDemo';
import { buildComposableEdgesRule, makeDrawing, makeEdge, makeVertex } from '../demo/helpers';

describe('export selection bookkeeping', () => {
    beforeEach(() => {
        getDrawing().clear(false);
        drawingStore.clear();
        drawingStore.addDrawing('Initial Drawing', new Drawing(sortStore));
        drawingStore.addDrawing('Rule Drawing Demo', new Drawing(sortStore));
        ui.exportSelection = new SvelteSet(['Initial Drawing', 'Rule Drawing Demo']);
        vi.stubGlobal('confirm', () => true);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        ui.exportSelection = new SvelteSet();
    });

    it('removes deleted drawing names from the export selection', () => {
        deleteSelectedDrawings(['Initial Drawing']);
        expect(ui.exportSelection).toEqual(new Set(['Rule Drawing Demo']));
        const names = getSelectedDrawingNames();
        expect(names).toEqual(['Rule Drawing Demo']);
        expect(() => drawingStore.exportDrawingsJSON(names)).not.toThrow();
    });

    it('migrates the export selection across a rename', () => {
        renameDrawingName('Initial Drawing', 'Renamed Drawing');
        expect(ui.exportSelection).toEqual(new Set(['Renamed Drawing', 'Rule Drawing Demo']));
        expect(getSelectedDrawingNames()).toEqual(expect.arrayContaining(['Renamed Drawing', 'Rule Drawing Demo']));
    });

    it('filters stale names out of the export selection', () => {
        ui.exportSelection = new SvelteSet(['Initial Drawing', 'Ghost Drawing']);
        expect(getSelectedDrawingNames()).toEqual(['Initial Drawing']);
    });
});

describe('toasts', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
        ui.toasts = [];
    });

    it('pushes a toast with unique ids', () => {
        pushToast('error', 'boom');
        expect(ui.toasts).toHaveLength(1);
        expect(ui.toasts[0].kind).toBe('error');
        expect(ui.toasts[0].message).toBe('boom');
        pushToast('error', 'again');
        expect(ui.toasts).toHaveLength(2);
        expect(ui.toasts[0].id).not.toBe(ui.toasts[1].id);
    });

    it('dismisses a toast by id', () => {
        pushToast('info', 'hi');
        const id = ui.toasts[0].id;
        dismissToast(id);
        expect(ui.toasts).toEqual([]);
    });

    it('auto-dismisses after the kind-specific delay', () => {
        pushToast('info', 'hi');
        vi.advanceTimersByTime(3999);
        expect(ui.toasts).toHaveLength(1);
        vi.advanceTimersByTime(1);
        expect(ui.toasts).toEqual([]);
    });
});

describe('first-order statement proved status', () => {
    beforeEach(() => {
        registerDefaultSorts(sortStore);
        getDrawing().clear(true);
        drawingStore.clear();
        ui.activeDrawingName = null;
        vi.stubGlobal('confirm', () => true);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        ui.activeDrawingName = null;
    });

    function buildStatement(provable: boolean): void {
        const a = getDrawing().newArtefact('Vertex', {}, { position: [0, 0], label: 'a' }, 'root');
        const b = getDrawing().newArtefact('Vertex', {}, { position: [0, 0], label: 'b' }, 'root');
        if (provable) {
            getDrawing().newArtefact('Edge', { source: a, target: b }, { width: 2, bend: 0, label: 'g' }, 'root');
        }
        getDrawing().addLayer('goal', 'Goal', 'root');
        getDrawing().newArtefact('Edge', { source: a, target: b }, { width: 2, bend: 0, label: 'c' }, 'goal');
    }

    it('marks a provable first-order statement as proved', () => {
        buildStatement(true);
        drawingStore.addDrawing('Statement', getDrawing());
        ui.activeDrawingName = 'Statement';
        syncProvedStatus();
        expect(drawingStore.getDrawing('Statement')?.proved).toBe(true);
    });

    it('clears a previously set proved flag when the statement is no longer provable', () => {
        buildStatement(false);
        drawingStore.addDrawing('Statement', getDrawing());
        drawingStore.setDrawingProved('Statement', true);
        ui.activeDrawingName = 'Statement';
        syncProvedStatus();
        expect(drawingStore.getDrawing('Statement')?.proved).toBe(false);
    });

    it('handles an unsaved active drawing without crashing', () => {
        buildStatement(true);
        syncProvedStatus();
        expect(true).toBe(true);
    });

    it('records an exact proof to the rocq recorder when proved', () => {
        buildStatement(true);
        drawingStore.addDrawing('Statement', getDrawing());
        ui.activeDrawingName = 'Statement';
        rocqRecorder.start(getDrawing(), 'Statement', sortStore);
        syncProvedStatus();
        const script = rocqRecorder.stop();
        expect(script).toContain('exact ');
    });
});

describe('active drawing after rule application', () => {
    beforeEach(() => {
        registerDefaultSorts(sortStore);
        getDrawing().clear(true);
        drawingStore.clear();
        ui.activeDrawingName = null;
    });

    afterEach(() => {
        ui.activeDrawingName = null;
    });

    it('mutates the stored active drawing when a rule is applied', () => {
        const { rule } = buildComposableEdgesRule();
        drawingStore.addDrawing('CompRule', rule);

        const v0 = getDrawing().newArtefact('Vertex', {}, { position: [0, 0], label: 'v0' }, 'root');
        const v1 = getDrawing().newArtefact('Vertex', {}, { position: [0, 0], label: 'v1' }, 'root');
        const v2 = getDrawing().newArtefact('Vertex', {}, { position: [0, 0], label: 'v2' }, 'root');
        getDrawing().newArtefact('Edge', { source: v0, target: v1 }, { width: 2, bend: 0, label: 'e1' }, 'root');
        getDrawing().newArtefact('Edge', { source: v1, target: v2 }, { width: 2, bend: 0, label: 'e2' }, 'root');

        drawingStore.addDrawing('HostDrawing', getDrawing());
        ui.activeDrawingName = 'HostDrawing';
        expect(drawingStore.getDrawing('HostDrawing')?.drawing.getArtefacts().length).toBe(5);

        applyRuleAt('CompRule', 0);

        expect(getDrawing().getArtefacts().length).toBe(6);
        const saved = drawingStore.getDrawing('HostDrawing');
        expect(saved).toBeDefined();
        expect(saved?.drawing.getArtefacts().length).toBe(6);
    });

    it('preserves parentName of the active drawing across a rule application', () => {
        const { rule } = buildComposableEdgesRule();
        drawingStore.addDrawing('CompRule', rule);

        const v0 = getDrawing().newArtefact('Vertex', {}, { position: [0, 0], label: 'v0' }, 'root');
        const v1 = getDrawing().newArtefact('Vertex', {}, { position: [0, 0], label: 'v1' }, 'root');
        const v2 = getDrawing().newArtefact('Vertex', {}, { position: [0, 0], label: 'v2' }, 'root');
        getDrawing().newArtefact('Edge', { source: v0, target: v1 }, { width: 2, bend: 0, label: 'e1' }, 'root');
        getDrawing().newArtefact('Edge', { source: v1, target: v2 }, { width: 2, bend: 0, label: 'e2' }, 'root');

        drawingStore.addDrawing('ChildDrawing', getDrawing());
        drawingStore.setDrawingParent('ChildDrawing', 'ParentDrawing');
        ui.activeDrawingName = 'ChildDrawing';

        expect(drawingStore.getDrawing('ChildDrawing')?.parentName).toBe('ParentDrawing');

        applyRuleAt('CompRule', 0);

        const saved = drawingStore.getDrawing('ChildDrawing');
        expect(saved?.parentName).toBe('ParentDrawing');
        expect(saved?.drawing.getArtefacts().length).toBe(6);
    });

    it('mutates the unsaved canvas when no active drawing is set', () => {
        const { rule } = buildComposableEdgesRule();
        drawingStore.addDrawing('CompRule', rule);

        const v0 = getDrawing().newArtefact('Vertex', {}, { position: [0, 0], label: 'v0' }, 'root');
        const v1 = getDrawing().newArtefact('Vertex', {}, { position: [0, 0], label: 'v1' }, 'root');
        const v2 = getDrawing().newArtefact('Vertex', {}, { position: [0, 0], label: 'v2' }, 'root');
        getDrawing().newArtefact('Edge', { source: v0, target: v1 }, { width: 2, bend: 0, label: 'e1' }, 'root');
        getDrawing().newArtefact('Edge', { source: v1, target: v2 }, { width: 2, bend: 0, label: 'e2' }, 'root');

        ui.activeDrawingName = null;

        expect(() => applyRuleAt('CompRule', 0)).not.toThrow();
        expect(getDrawing().getArtefacts().length).toBe(6);
        expect(drawingStore.getAllDrawings().map(d => d.name)).toEqual(['CompRule']);
    });
});

describe('goal solved toast on rule application', () => {
    beforeEach(() => {
        registerDefaultSorts(sortStore);
        getDrawing().clear(true);
        drawingStore.clear();
        ui.activeDrawingName = null;
        ui.toasts = [];
    });

    afterEach(() => {
        ui.activeDrawingName = null;
        ui.toasts = [];
    });

    it('pushes a success toast when the applied rule solves the goal', () => {
        const rule = makeDrawing();
        const rv0 = makeVertex(rule, 'rv0');
        const rv1 = makeVertex(rule, 'rv1');
        makeEdge(rule, 're1', rv0, rv1);
        rule.addLayer('conclusion', 'Conclusion', 'root');
        makeEdge(rule, 'rg', rv1, rv0, 'conclusion');
        rule.setIsRule(true);
        drawingStore.addDrawing('RevRule', rule);

        getDrawing().addLayer('goal', 'Goal', 'root');
        const hv0 = getDrawing().newArtefact('Vertex', {}, { position: [0, 0], label: 'hv0' }, 'root');
        const hv1 = getDrawing().newArtefact('Vertex', {}, { position: [0, 0], label: 'hv1' }, 'root');
        getDrawing().newArtefact('Edge', { source: hv0, target: hv1 }, { width: 2, bend: 0, label: 'he1' }, 'root');
        getDrawing().newArtefact('Edge', { source: hv1, target: hv0 }, { width: 2, bend: 0, label: 'hg' }, 'goal');

        drawingStore.addDrawing('Statement', getDrawing());
        ui.activeDrawingName = 'Statement';
        expect(getDrawing().checkLayerProvable('goal').provable).toBe(false);

        applyRuleAt('RevRule', 0);

        expect(ui.toasts.filter(t => t.kind === 'success').map(t => t.message)).toContain('Goal solved');
    });

    it('does not push a success toast when the goal was already proved', () => {
        const { rule } = buildComposableEdgesRule();
        drawingStore.addDrawing('CompRule', rule);

        getDrawing().addLayer('goal', 'Goal', 'root');
        const hv0 = getDrawing().newArtefact('Vertex', {}, { position: [0, 0], label: 'hv0' }, 'root');
        const hv1 = getDrawing().newArtefact('Vertex', {}, { position: [0, 0], label: 'hv1' }, 'root');
        const hv2 = getDrawing().newArtefact('Vertex', {}, { position: [0, 0], label: 'hv2' }, 'root');
        getDrawing().newArtefact('Edge', { source: hv0, target: hv1 }, { width: 2, bend: 0, label: 'he1' }, 'root');
        getDrawing().newArtefact('Edge', { source: hv1, target: hv2 }, { width: 2, bend: 0, label: 'he2' }, 'root');
        getDrawing().newArtefact('Edge', { source: hv0, target: hv2 }, { width: 2, bend: 0, label: 'he3' }, 'root');
        getDrawing().newArtefact('Edge', { source: hv0, target: hv2 }, { width: 2, bend: 0, label: 'hg' }, 'goal');

        drawingStore.addDrawing('Statement', getDrawing());
        ui.activeDrawingName = 'Statement';
        expect(getDrawing().checkLayerProvable('goal').provable).toBe(true);

        applyRuleAt('CompRule', 0);

        expect(ui.toasts.some(t => t.kind === 'success')).toBe(false);
    });

    it('does not push a success toast when the drawing has no goal', () => {
        const { rule } = buildComposableEdgesRule();
        drawingStore.addDrawing('CompRule', rule);

        const v0 = getDrawing().newArtefact('Vertex', {}, { position: [0, 0], label: 'v0' }, 'root');
        const v1 = getDrawing().newArtefact('Vertex', {}, { position: [0, 0], label: 'v1' }, 'root');
        const v2 = getDrawing().newArtefact('Vertex', {}, { position: [0, 0], label: 'v2' }, 'root');
        getDrawing().newArtefact('Edge', { source: v0, target: v1 }, { width: 2, bend: 0, label: 'he1' }, 'root');
        getDrawing().newArtefact('Edge', { source: v1, target: v2 }, { width: 2, bend: 0, label: 'he2' }, 'root');

        drawingStore.addDrawing('Statement', getDrawing());
        ui.activeDrawingName = 'Statement';

        applyRuleAt('CompRule', 0);

        expect(ui.toasts.some(t => t.kind === 'success')).toBe(false);
    });
});

describe('position picker', () => {
    const noop = (_data: any, _context: any): any => null;

    beforeEach(() => {
        registerDefaultSorts(sortStore);
        if (!sortStore.getSort('Anchor')) sortStore.newSort('Anchor', {}, { position: 'position' }, noop);
        if (!sortStore.getSort('Rel')) sortStore.newSort('Rel', { anchor: 'Anchor' }, { position: { type: 'relativePosition', target: 'anchor.position' } }, noop);
        getDrawing().clear(true);
        drawingStore.clear();
        ui.activeDrawingName = null;
        resetInteractionState();
        vi.stubGlobal('confirm', () => true);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        resetInteractionState();
    });

    it('bails out when the picked artefact has been removed (bypassing the prune sweep)', () => {
        const a = getDrawing().newArtefact('Vertex', {}, { position: [0, 0], label: 'a' }, 'root');
        togglePositionPicker(a, 'position');
        expect(isPositionPickerActive(a, 'position')).toBe(true);

        getDrawing().removeArtefact(a);
        expect(getDrawing().getArtefactById(a.id)).toBeUndefined();
        expect(() => applyPickedPosition(5, 5)).not.toThrow();
        expect(ui.positionPicker).toBeNull();
        expect(a.data.position).toEqual([0, 0]);
    });

    it('writes a draft relativePosition offset relative to its dependency', () => {
        const anchor = getDrawing().newArtefact('Anchor', {}, { position: [100, 100] }, 'root');
        ui.draftArtefact = { sortName: 'Rel', dependencies: { anchor }, data: { position: [0, 0] }, layerId: 'root' };
        startPositionPicker({ kind: 'draft', attrName: 'position' });

        applyPickedPosition(110, 120);

        expect(ui.draftArtefact!.data.position).toEqual([10, 20]);
        expect(ui.positionPicker).toBeNull();
    });

    it('writes an absolute position onto a real artefact and clears the picker', () => {
        const a = getDrawing().newArtefact('Vertex', {}, { position: [0, 0], label: 'a' }, 'root');
        togglePositionPicker(a, 'position');
        expect(isPositionPickerActive(a, 'position')).toBe(true);

        applyPickedPosition(400, 500);

        expect(a.data.position).toEqual([400, 500]);
        expect(ui.positionPicker).toBeNull();
    });

    it('does not treat a draft picker as active on a real artefact sharing its data object', () => {
        const a = getDrawing().newArtefact('Vertex', {}, { position: [0, 0], label: 'a' }, 'root');
        ui.draftArtefact = { sortName: 'Vertex', dependencies: {}, data: a.data, layerId: 'root' };
        startPositionPicker({ kind: 'draft', attrName: 'position' });

        expect(isDraftPickerActive('position')).toBe(true);
        expect(isPositionPickerActive(a, 'position')).toBe(false);
    });

    it('clears inspection and the picker when the picked artefact is removed as a transitive dependent', () => {
        const v = getDrawing().newArtefact('Vertex', {}, { position: [0, 0], label: 'v' }, 'root');
        const e = getDrawing().newArtefact('Edge', { source: v, target: v }, { width: 2, bend: 0, label: 'e' }, 'root');
        selectArtefactToInspect(e);
        togglePositionPicker(e, 'bend');
        expect(ui.inspectedArtefact).toBe(e);

        removeArtefactNode(v);

        expect(getDrawing().getArtefactById(e.id)).toBeUndefined();
        expect(ui.inspectedArtefact).toBeNull();
        expect(ui.positionPicker).toBeNull();
    });

    it('clears inspection and the picker when the picked artefact is removed directly', () => {
        const a = getDrawing().newArtefact('Vertex', {}, { position: [0, 0], label: 'a' }, 'root');
        selectArtefactToInspect(a);
        togglePositionPicker(a, 'position');
        expect(ui.inspectedArtefact).toBe(a);

        removeArtefactNode(a);

        expect(ui.inspectedArtefact).toBeNull();
        expect(ui.positionPicker).toBeNull();
    });
});

describe('equality extend picking', () => {
    beforeEach(() => {
        registerDefaultSorts(sortStore);
        getDrawing().clear(true);
        drawingStore.clear();
        ui.activeDrawingName = null;
        resetInteractionState();
        vi.stubGlobal('confirm', () => true);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        resetInteractionState();
    });

    function makeVertices(...labels: string[]): ReturnType<Drawing['newArtefact']>[] {
        return labels.map(label => getDrawing().newArtefact('Vertex', {}, { position: [0, 0], label }, 'root'));
    }

    it('adds a picked artefact as an additional equalized child', () => {
        const [v0, v1, v2] = makeVertices('v0', 'v1', 'v2');
        const eq = getDrawing().newEqualityArtefact([v0, v1], 'root');

        toggleEqualityExtend(eq);
        expect(ui.equalityExtendTarget).toBe(eq);

        onArtefactNodeClick(v2);

        expect(equalityChildren(eq).map(c => c.data.label)).toEqual(['v0', 'v1', 'v2']);
        expect(ui.equalityExtendTarget).toBe(eq);
    });

    it('dedupes a child already in the equality', () => {
        const [v0, v1, v2] = makeVertices('v0', 'v1', 'v2');
        const eq = getDrawing().newEqualityArtefact([v0, v1, v2], 'root');

        toggleEqualityExtend(eq);
        onArtefactNodeClick(v2);

        expect(equalityChildren(eq)).toHaveLength(3);
        expect(ui.equalityExtendTarget).toBe(eq);
    });

    it('rejects an artefact of a different sort with an error toast', () => {
        const [v0, v1] = makeVertices('v0', 'v1');
        const e = getDrawing().newArtefact('Edge', { source: v0, target: v1 }, { width: 2, bend: 0, label: 'e' }, 'root');
        const eq = getDrawing().newEqualityArtefact([v0, v1], 'root');

        toggleEqualityExtend(eq);
        onArtefactNodeClick(e);

        expect(ui.toasts.some(t => t.kind === 'error')).toBe(true);
        expect(equalityChildren(eq)).toHaveLength(2);
        expect(ui.equalityExtendTarget).toBe(eq);
    });

    it('merges overlapping equalities on the same layer and keeps the extend target', () => {
        const [v0, v1, v3] = makeVertices('v0', 'v1', 'v3');
        const eqA = getDrawing().newEqualityArtefact([v0, v1], 'root');
        getDrawing().newEqualityArtefact([v3, v1], 'root');

        toggleEqualityExtend(eqA);
        onArtefactNodeClick(v3);

        expect(equalityChildren(eqA).map(c => c.data.label).sort()).toEqual(['v0', 'v1', 'v3']);
        expect(getDrawing().getArtefacts().filter(a => a.sortName === 'Equality')).toHaveLength(1);
        expect(ui.equalityExtendTarget).toBe(eqA);
    });

    it('switches the extend target when another equality row is clicked', () => {
        const [v0, v1, v2, v3] = makeVertices('v0', 'v1', 'v2', 'v3');
        const eqA = getDrawing().newEqualityArtefact([v0, v1], 'root');
        const eqB = getDrawing().newEqualityArtefact([v2, v3], 'root');

        toggleEqualityExtend(eqA);
        onArtefactNodeClick(eqB);

        expect(ui.equalityExtendTarget).toBe(eqB);

        toggleEqualityExtend(eqB);
        expect(ui.equalityExtendTarget).toBeNull();
    });

    it('falls back to inspection once extend picking is off', () => {
        const [v0, v1] = makeVertices('v0', 'v1');
        const eq = getDrawing().newEqualityArtefact([v0, v1], 'root');
        const other = makeVertices('other')[0];

        toggleEqualityExtend(eq);
        toggleEqualityExtend(eq);
        expect(ui.equalityExtendTarget).toBeNull();

        onArtefactNodeClick(other);
        expect(ui.inspectedArtefact).toBe(other);
    });

    it('clears the extend target when the equality is removed', () => {
        const [v0, v1] = makeVertices('v0', 'v1');
        const eq = getDrawing().newEqualityArtefact([v0, v1], 'root');

        toggleEqualityExtend(eq);
        removeArtefactNode(eq);

        expect(ui.equalityExtendTarget).toBeNull();
    });

    it('resetInteractionState clears the extend target', () => {
        const [v0, v1] = makeVertices('v0', 'v1');
        const eq = getDrawing().newEqualityArtefact([v0, v1], 'root');

        toggleEqualityExtend(eq);
        expect(ui.equalityExtendTarget).toBe(eq);

        resetInteractionState();
        expect(ui.equalityExtendTarget).toBeNull();
    });

    it('keeps an equality draft open to pick more than two children until validated', () => {
        const [v0, v1, v2] = makeVertices('v0', 'v1', 'v2');
        ui.draftArtefact = { sortName: 'Equality', dependencies: {}, data: {}, layerId: 'root' };
        ui.dependencyPickingFor = 'Equality';

        onArtefactNodeClick(v0);
        onArtefactNodeClick(v1);

        expect(ui.draftArtefact).not.toBeNull();
        expect(equalityChildren(ui.draftArtefact!)).toHaveLength(2);
        expect(getDrawing().getArtefacts()).toHaveLength(3);

        onArtefactNodeClick(v2);

        expect(ui.draftArtefact).not.toBeNull();
        expect(equalityChildren(ui.draftArtefact!)).toHaveLength(3);

        const created = createDraftArtefact();

        expect(created?.sortName).toBe('Equality');
        expect(equalityChildren(created!)).toHaveLength(3);
        expect(ui.draftArtefact).toBeNull();
        expect(ui.dependencyPickingFor).toBeNull();
    });
});

describe('rocq recording proof attachment', () => {
    beforeEach(() => {
        registerDefaultSorts(sortStore);
        getDrawing().clear(true);
        drawingStore.clear();
        ui.activeDrawingName = null;
        vi.stubGlobal('confirm', () => true);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        ui.activeDrawingName = null;
        if (rocqRecorder.isActive()) {
            rocqRecorder.stop();
        }
    });

    function buildStatement(): Drawing {
        const stmt = getDrawing();
        const a = makeVertex(stmt, 'a');
        const b = makeVertex(stmt, 'b');
        makeEdge(stmt, 'g', a, b);
        stmt.addLayer('conc', 'Conclusion', 'root');
        makeEdge(stmt, 'c', a, b, 'conc');
        return stmt;
    }

    it('renames the working drawing to "(proof)" and adds a first-order rule clone carrying the proof', () => {
        const stmt = buildStatement();
        drawingStore.addDrawing('Statement', stmt);
        ui.activeDrawingName = 'Statement';
        ui.exportSelection = new SvelteSet(['Statement']);

        const snapshot = DrawingStore.cloneDrawing(stmt, sortStore);
        const script = 'Lemma Statement_rule : Type.\\nintros_sigma ().\\nAbort.\\n';
        const { proofName } = splitFirstOrderRecording('Statement', snapshot, script);

        expect(proofName).toBe('Statement (proof)');
        expect(drawingStore.getDrawing('Statement (proof)')?.drawing).toBe(stmt);
        const rule = drawingStore.getDrawing('Statement');
        expect(rule?.drawing).toBe(snapshot);
        expect(rule!.drawing.isRule).toBe(true);
        expect(rule!.drawing.rocqProof).toBe(script);
        expect(getFirstOrderStatementChildLayer(rule!.drawing)).not.toBeNull();
        expect(ui.activeDrawingName).toBe('Statement (proof)');
        expect(ui.exportSelection.has('Statement (proof)')).toBe(true);
        expect(ui.exportSelection.has('Statement')).toBe(false);
    });

    it('auto-uniquifies the proof working name on collision', () => {
        const stmt = buildStatement();
        drawingStore.addDrawing('Statement', stmt);
        const snapshot = DrawingStore.cloneDrawing(stmt, sortStore);
        drawingStore.addDrawing('Statement (proof)', new Drawing(sortStore));

        const { proofName } = splitFirstOrderRecording('Statement', snapshot, 'Lemma Statement_rule : True.\\nexact I.\\nQed.\\n');
        expect(proofName).toBe('Statement (proof) (2)');
        expect(drawingStore.getDrawing('Statement')?.drawing).toBe(snapshot);
        expect(drawingStore.getDrawing('Statement (proof) (2)')?.drawing).toBe(stmt);
    });

    it('rejects a snapshot that is not a first-order statement', () => {
        const nonStatement = new Drawing(sortStore);
        makeVertex(nonStatement, 'x');
        makeVertex(nonStatement, 'y');
        drawingStore.addDrawing('NotStatement', nonStatement);

        const snapshot = DrawingStore.cloneDrawing(nonStatement, sortStore);
        expect(() => splitFirstOrderRecording('NotStatement', snapshot, 'script')).toThrow(/not a first-order statement/);
    });

    it('rejects a recording whose drawing is no longer in the store', () => {
        const stmt = buildStatement();
        const snapshot = DrawingStore.cloneDrawing(stmt, sortStore);
        expect(() => splitFirstOrderRecording('Missing', snapshot, 'script')).toThrow(/does not exist/);
    });

    it('round-trips the attached proof through drawing JSON export and import', () => {
        const stmt = buildStatement();
        stmt.setIsRule(true);
        stmt.setRocqProof('Lemma Statement_rule : True.\\nexact I.\\nQed.\\n');
        drawingStore.addDrawing('Statement', stmt);

        const json = drawingStore.exportDrawingsJSON(['Statement']);
        const freshStore = new DrawingStore();
        freshStore.importDrawingsJSON(json, sortStore);

        const restored = freshStore.getDrawing('Statement');
        expect(restored?.drawing.rocqProof).toBe('Lemma Statement_rule : True.\\nexact I.\\nQed.\\n');
        expect(restored?.drawing.isRule).toBe(true);
    });

    it('openProofEditor and closeProofEditor track the edited drawing in ui', () => {
        const stmt = buildStatement();
        drawingStore.addDrawing('Statement', stmt);

        openProofEditor('Statement');
        expect(ui.proofEditorName).toBe('Statement');
        closeProofEditor();
        expect(ui.proofEditorName).toBeNull();
        expect(ui.proofEditorDraft).toBeNull();
    });

    it('openProofEditor with a draft prefills the editor without attaching', () => {
        const stmt = buildStatement();
        stmt.setRocqProof(null);
        drawingStore.addDrawing('Statement', stmt);

        openProofEditor('Statement', 'draft script');
        expect(ui.proofEditorName).toBe('Statement');
        expect(ui.proofEditorDraft).toBe('draft script');
        expect(drawingStore.getDrawing('Statement')?.drawing.rocqProof).toBeNull();
        closeProofEditor();
    });

    it('updateDrawingRocqProof replaces the attached proof', () => {
        const stmt = buildStatement();
        stmt.setRocqProof('old script');
        drawingStore.addDrawing('Statement', stmt);

        updateDrawingRocqProof('Statement', 'new script');
        expect(ui.proofEditorName).toBeNull();
        expect(drawingStore.getDrawing('Statement')?.drawing.rocqProof).toBe('new script');
    });

    it('updateDrawingRocqProof with an empty script clears the proof', () => {
        const stmt = buildStatement();
        stmt.setRocqProof('some script');
        drawingStore.addDrawing('Statement', stmt);

        updateDrawingRocqProof('Statement', '   \n  ');
        expect(drawingStore.getDrawing('Statement')?.drawing.rocqProof).toBeNull();
    });

    it('updateDrawingRocqProof reports a missing drawing', () => {
        updateDrawingRocqProof('DoesNotExist', 'script');
        const toast = ui.toasts[ui.toasts.length - 1];
        expect(toast.kind).toBe('error');
        expect(String(toast.message)).toContain('does not exist');
        ui.toasts = [];
    });

    it('suggestAdmittedProof opens the editor with a generated admitted lemma draft without attaching it', () => {
        const stmt = buildStatement();
        stmt.setRocqProof(null);
        drawingStore.addDrawing('Statement', stmt);

        suggestAdmittedProof('Statement');

        expect(ui.proofEditorName).toBe('Statement');
        const draft = ui.proofEditorDraft;
        expect(draft).toContain('Lemma Statement_rule :');
        expect(draft).toContain('admit.');
        expect(draft).toContain('Admitted.');
        expect(drawingStore.getDrawing('Statement')?.drawing.rocqProof).toBeNull();
        closeProofEditor();
    });

    it('suggestAdmittedProof reports a missing drawing', () => {
        suggestAdmittedProof('DoesNotExist');
        const toast = ui.toasts[ui.toasts.length - 1];
        expect(toast.kind).toBe('error');
        expect(String(toast.message)).toContain('does not exist');
        ui.toasts = [];
    });

    it('toggleRocqRecording stop splits a recorded first-order statement into a rule with its proof', () => {
        const stmt = buildStatement();
        drawingStore.addDrawing('Statement', stmt);
        ui.activeDrawingName = 'Statement';

        toggleRocqRecording();
        expect(rocqRecorder.isActive()).toBe(true);
        syncProvedStatus();
        toggleRocqRecording();
        expect(rocqRecorder.isActive()).toBe(false);

        const rule = drawingStore.getDrawing('Statement');
        expect(rule?.drawing.isRule).toBe(true);
        expect(rule?.drawing.rocqProof).not.toBeNull();
        expect(rule!.drawing.rocqProof).toContain('Lemma Statement_rule :');
        const working = drawingStore.getDrawing('Statement (proof)');
        expect(working?.drawing).toBe(stmt);
    });
});
