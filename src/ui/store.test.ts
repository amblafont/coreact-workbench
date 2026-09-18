import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { get } from 'svelte/store';
import { drawing, drawingStore, activeDrawingName, sortStore, rocqRecorder, syncProvedStatus, exportSelection, getSelectedDrawingNames, deleteSelectedDrawings, renameDrawingName, toasts, pushToast, dismissToast, applyRuleAt,
    inspectedArtefact, positionPicker, draftArtefact,
    resetInteractionState, togglePositionPicker, isPositionPickerActive, isDraftPickerActive,
    applyPickedPosition, startPositionPicker, selectArtefactToInspect, removeArtefactNode
} from './store.svelte.ts';
import { registerDefaultSorts } from '../demo/buildDemo';
import { buildComposableEdgesRule } from '../demo/helpers';

describe('export selection bookkeeping', () => {
    beforeEach(() => {
        drawing.clear(false);
        drawingStore.clear();
        drawingStore.saveDrawing('Initial Drawing', drawing);
        drawingStore.saveDrawing('Rule Drawing Demo', drawing);
        exportSelection.set(new Set(['Initial Drawing', 'Rule Drawing Demo']));
        vi.stubGlobal('confirm', () => true);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        exportSelection.set(new Set());
    });

    it('removes deleted drawing names from the export selection', () => {
        deleteSelectedDrawings(['Initial Drawing']);
        expect(get(exportSelection)).toEqual(new Set(['Rule Drawing Demo']));
        const names = getSelectedDrawingNames();
        expect(names).toEqual(['Rule Drawing Demo']);
        expect(() => drawingStore.exportDrawingsJSON(names)).not.toThrow();
    });

    it('migrates the export selection across a rename', () => {
        renameDrawingName('Initial Drawing', 'Renamed Drawing');
        expect(get(exportSelection)).toEqual(new Set(['Renamed Drawing', 'Rule Drawing Demo']));
        expect(getSelectedDrawingNames()).toEqual(expect.arrayContaining(['Renamed Drawing', 'Rule Drawing Demo']));
    });

    it('filters stale names out of the export selection', () => {
        exportSelection.set(new Set(['Initial Drawing', 'Ghost Drawing']));
        expect(getSelectedDrawingNames()).toEqual(['Initial Drawing']);
    });
});

describe('toasts', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
        toasts.set([]);
    });

    it('pushes a toast with unique ids', () => {
        pushToast('error', 'boom');
        expect(get(toasts)).toHaveLength(1);
        expect(get(toasts)[0].kind).toBe('error');
        expect(get(toasts)[0].message).toBe('boom');
        pushToast('error', 'again');
        expect(get(toasts)).toHaveLength(2);
        expect(get(toasts)[0].id).not.toBe(get(toasts)[1].id);
    });

    it('dismisses a toast by id', () => {
        pushToast('info', 'hi');
        const id = get(toasts)[0].id;
        dismissToast(id);
        expect(get(toasts)).toEqual([]);
    });

    it('auto-dismisses after the kind-specific delay', () => {
        pushToast('info', 'hi');
        vi.advanceTimersByTime(3999);
        expect(get(toasts)).toHaveLength(1);
        vi.advanceTimersByTime(1);
        expect(get(toasts)).toEqual([]);
    });
});

describe('first-order statement proved status', () => {
    beforeEach(() => {
        registerDefaultSorts(sortStore);
        drawing.clear(true);
        drawingStore.clear();
        activeDrawingName.set(null);
        vi.stubGlobal('confirm', () => true);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        activeDrawingName.set(null);
    });

    function buildStatement(provable: boolean): void {
        const a = drawing.newArtefact('Vertex', {}, { position: [0, 0], label: 'a' }, 'root');
        const b = drawing.newArtefact('Vertex', {}, { position: [0, 0], label: 'b' }, 'root');
        if (provable) {
            drawing.newArtefact('Edge', { source: a, target: b }, { width: 2, bend: 0, label: 'g' }, 'root');
        }
        drawing.addLayer('goal', 'Goal', 'root');
        drawing.newArtefact('Edge', { source: a, target: b }, { width: 2, bend: 0, label: 'c' }, 'goal');
    }

    it('marks a provable first-order statement as proved', () => {
        buildStatement(true);
        drawingStore.saveDrawing('Statement', drawing);
        activeDrawingName.set('Statement');
        syncProvedStatus();
        expect(drawingStore.getDrawing('Statement')?.proved).toBe(true);
    });

    it('clears a previously set proved flag when the statement is no longer provable', () => {
        buildStatement(false);
        drawingStore.saveDrawing('Statement', drawing);
        drawingStore.setDrawingProved('Statement', true);
        activeDrawingName.set('Statement');
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
        drawingStore.saveDrawing('Statement', drawing);
        activeDrawingName.set('Statement');
        rocqRecorder.start(drawing, 'Statement', sortStore);
        syncProvedStatus();
        const script = rocqRecorder.stop();
        expect(script).toContain('exact ');
    });
});

describe('auto-saving drawing after rule application', () => {
    beforeEach(() => {
        registerDefaultSorts(sortStore);
        drawing.clear(true);
        drawingStore.clear();
        activeDrawingName.set(null);
    });

    afterEach(() => {
        activeDrawingName.set(null);
    });

    it('automatically saves the active drawing when a rule is applied', () => {
        const { rule } = buildComposableEdgesRule();
        drawingStore.saveDrawing('CompRule', rule);

        const v0 = drawing.newArtefact('Vertex', {}, { position: [0, 0], label: 'v0' }, 'root');
        const v1 = drawing.newArtefact('Vertex', {}, { position: [0, 0], label: 'v1' }, 'root');
        const v2 = drawing.newArtefact('Vertex', {}, { position: [0, 0], label: 'v2' }, 'root');
        drawing.newArtefact('Edge', { source: v0, target: v1 }, { width: 2, bend: 0, label: 'e1' }, 'root');
        drawing.newArtefact('Edge', { source: v1, target: v2 }, { width: 2, bend: 0, label: 'e2' }, 'root');

        drawingStore.saveDrawing('HostDrawing', drawing);
        activeDrawingName.set('HostDrawing');
        expect(drawingStore.getDrawing('HostDrawing')?.artefacts.length).toBe(5);

        applyRuleAt('CompRule', 0);

        expect(drawing.getArtefacts().length).toBe(6);
        const saved = drawingStore.getDrawing('HostDrawing');
        expect(saved).toBeDefined();
        expect(saved?.artefacts.length).toBe(6);
    });

    it('preserves parentName when auto-saving the active drawing', () => {
        const { rule } = buildComposableEdgesRule();
        drawingStore.saveDrawing('CompRule', rule);

        const v0 = drawing.newArtefact('Vertex', {}, { position: [0, 0], label: 'v0' }, 'root');
        const v1 = drawing.newArtefact('Vertex', {}, { position: [0, 0], label: 'v1' }, 'root');
        const v2 = drawing.newArtefact('Vertex', {}, { position: [0, 0], label: 'v2' }, 'root');
        drawing.newArtefact('Edge', { source: v0, target: v1 }, { width: 2, bend: 0, label: 'e1' }, 'root');
        drawing.newArtefact('Edge', { source: v1, target: v2 }, { width: 2, bend: 0, label: 'e2' }, 'root');

        drawingStore.saveDrawing('ChildDrawing', drawing);
        drawingStore.setDrawingParent('ChildDrawing', 'ParentDrawing');
        activeDrawingName.set('ChildDrawing');

        expect(drawingStore.getDrawing('ChildDrawing')?.parentName).toBe('ParentDrawing');

        applyRuleAt('CompRule', 0);

        const saved = drawingStore.getDrawing('ChildDrawing');
        expect(saved?.parentName).toBe('ParentDrawing');
        expect(saved?.artefacts.length).toBe(6);
    });

    it('skips auto-saving silently when activeDrawingName is null', () => {
        const { rule } = buildComposableEdgesRule();
        drawingStore.saveDrawing('CompRule', rule);

        const v0 = drawing.newArtefact('Vertex', {}, { position: [0, 0], label: 'v0' }, 'root');
        const v1 = drawing.newArtefact('Vertex', {}, { position: [0, 0], label: 'v1' }, 'root');
        const v2 = drawing.newArtefact('Vertex', {}, { position: [0, 0], label: 'v2' }, 'root');
        drawing.newArtefact('Edge', { source: v0, target: v1 }, { width: 2, bend: 0, label: 'e1' }, 'root');
        drawing.newArtefact('Edge', { source: v1, target: v2 }, { width: 2, bend: 0, label: 'e2' }, 'root');

        activeDrawingName.set(null);

        expect(() => applyRuleAt('CompRule', 0)).not.toThrow();
        expect(drawing.getArtefacts().length).toBe(6);
        expect(drawingStore.getAllDrawings().map(d => d.name)).toEqual(['CompRule']);
    });
});

describe('position picker', () => {
    const noop = (_data: any, _context: any): any => null;

    beforeEach(() => {
        registerDefaultSorts(sortStore);
        if (!sortStore.getSort('Anchor')) sortStore.newSort('Anchor', {}, { position: 'position' }, noop);
        if (!sortStore.getSort('Rel')) sortStore.newSort('Rel', { anchor: 'Anchor' }, { position: { type: 'relativePosition', target: 'anchor.position' } }, noop);
        drawing.clear(true);
        drawingStore.clear();
        activeDrawingName.set(null);
        resetInteractionState();
        vi.stubGlobal('confirm', () => true);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        resetInteractionState();
    });

    it('bails out when the picked artefact has been removed (bypassing the prune sweep)', () => {
        const a = drawing.newArtefact('Vertex', {}, { position: [0, 0], label: 'a' }, 'root');
        togglePositionPicker(a, 'position');
        expect(isPositionPickerActive(a, 'position')).toBe(true);

        drawing.removeArtefact(a);
        expect(drawing.getArtefactById(a.id)).toBeUndefined();
        expect(() => applyPickedPosition(5, 5)).not.toThrow();
        expect(get(positionPicker)).toBeNull();
        expect(a.data.position).toEqual([0, 0]);
    });

    it('writes a draft relativePosition offset relative to its dependency', () => {
        const anchor = drawing.newArtefact('Anchor', {}, { position: [100, 100] }, 'root');
        draftArtefact.set({ sortName: 'Rel', dependencies: { anchor }, data: { position: [0, 0] }, layerId: 'root' });
        startPositionPicker({ kind: 'draft', attrName: 'position' });

        applyPickedPosition(110, 120);

        expect(get(draftArtefact)!.data.position).toEqual([10, 20]);
        expect(get(positionPicker)).toBeNull();
    });

    it('writes an absolute position onto a real artefact and clears the picker', () => {
        const a = drawing.newArtefact('Vertex', {}, { position: [0, 0], label: 'a' }, 'root');
        togglePositionPicker(a, 'position');
        expect(isPositionPickerActive(a, 'position')).toBe(true);

        applyPickedPosition(400, 500);

        expect(a.data.position).toEqual([400, 500]);
        expect(get(positionPicker)).toBeNull();
    });

    it('does not treat a draft picker as active on a real artefact sharing its data object', () => {
        const a = drawing.newArtefact('Vertex', {}, { position: [0, 0], label: 'a' }, 'root');
        draftArtefact.set({ sortName: 'Vertex', dependencies: {}, data: a.data, layerId: 'root' });
        startPositionPicker({ kind: 'draft', attrName: 'position' });

        expect(isDraftPickerActive('position')).toBe(true);
        expect(isPositionPickerActive(a, 'position')).toBe(false);
    });

    it('clears inspection and the picker when the picked artefact is removed as a transitive dependent', () => {
        const v = drawing.newArtefact('Vertex', {}, { position: [0, 0], label: 'v' }, 'root');
        const e = drawing.newArtefact('Edge', { source: v, target: v }, { width: 2, bend: 0, label: 'e' }, 'root');
        selectArtefactToInspect(e);
        togglePositionPicker(e, 'bend');
        expect(get(inspectedArtefact)).toBe(e);

        removeArtefactNode(v);

        expect(drawing.getArtefactById(e.id)).toBeUndefined();
        expect(get(inspectedArtefact)).toBeNull();
        expect(get(positionPicker)).toBeNull();
    });

    it('clears inspection and the picker when the picked artefact is removed directly', () => {
        const a = drawing.newArtefact('Vertex', {}, { position: [0, 0], label: 'a' }, 'root');
        selectArtefactToInspect(a);
        togglePositionPicker(a, 'position');
        expect(get(inspectedArtefact)).toBe(a);

        removeArtefactNode(a);

        expect(get(inspectedArtefact)).toBeNull();
        expect(get(positionPicker)).toBeNull();
    });
});
