import { untrack } from 'svelte';
import { SvelteMap, SvelteSet } from 'svelte/reactivity';
import * as d3 from 'd3';
import {
    SortStore,
    Drawing,
    DrawingStore,
    Artefact,
    findFirstOrderRuleApplications,
    findSecondOrderRuleApplications,
    applyFirstOrderRule,
    applySecondOrderRule,
    generateFirstOrderReverseRules,
    filterRedundantRuleApplications,
    filterNoProgressRuleApplications,
    filterSolvesGoalRuleApplications,
    getFirstOrderStatementChildLayer,
    type SortDefinition,
    type Layer,
    type DrawingStoreEntry,
    type RuleApplication,
    type DataAttributeValue,
    type DerivedRule,
    getAttributeType,
    getSliderMeta,
    getRelativePositionMeta
} from '../index.svelte.ts';
import { RocqRecorder } from '../rocq_recording.svelte.ts';
import { exportDrawingsToRocq, drawingExportNames } from '../rocq_export';

// ---------------------------------------------------------------------------
// Core singletons (reactive instances backed by fine-grained $state; derived
// views recompute automatically whenever the signals they read change).
// ---------------------------------------------------------------------------

export const sortStore = new SortStore();
let drawing = $state.raw(new Drawing(sortStore));
export function getDrawing(): Drawing {
    return drawing;
}
export const drawingStore = new DrawingStore();
export const rocqRecorder = new RocqRecorder();

// ---------------------------------------------------------------------------
// Interaction state (single fine-grained $state object; components read and
// write ui.* directly and track the exact signals they touch)
// ---------------------------------------------------------------------------

export interface DraftArtefact {
    sortName: string;
    dependencies: Record<string, Artefact>;
    data: Record<string, DataAttributeValue>;
    layerId: string;
    duplicateOf?: Artefact;
}

export type PositionPicker =
    | { kind: 'draft'; attrName: string }
    | { kind: 'artefact'; id: string; attrName: string };

export type ToastKind = 'info' | 'error';

export interface Toast {
    id: number;
    kind: ToastKind;
    message: string;
}

export const ui = $state({
    activeDrawingName: null as string | null,
    inspectedArtefact: null as Artefact | null,
    draftArtefact: null as DraftArtefact | null,
    dependencyPickingFor: null as string | null,
    positionPicker: null as PositionPicker | null,
    focusedLayerId: null as string | null,
    mergeMode: false,
    mergeFirstArtefact: null as Artefact | null,
    mergeSecondArtefact: null as Artefact | null,
    mergePickingFor: null as 'first' | 'second' | null,
    mergeHoverArtefact: null as Artefact | null,
    menuHoverArtefact: null as Artefact | null,
    ruleHoverArtefacts: null as Set<Artefact> | null,
    layerProvability: new SvelteMap<string, { provable: boolean; reason: string }>(),
    exportSelection: new SvelteSet<string>(),
    toasts: [] as Toast[],
    rocqRecordingActive: false,
    drawingsStoreCollapsed: false,
    filterRedundantMatches: false,
    filterNoProgressMatches: false,
    filterStrictMatches: false,
    filterSolvesGoalMatches: false
});

// ---------------------------------------------------------------------------
// Toasts (non-blocking replacement for alert()/window.alert)
// ---------------------------------------------------------------------------

let nextToastId = 1;

export function dismissToast(id: number): void {
    ui.toasts = ui.toasts.filter(t => t.id !== id);
}

export function pushToast(kind: ToastKind, message: string): void {
    const id = nextToastId++;
    ui.toasts = [...ui.toasts, { id, kind, message }];
    setTimeout(() => dismissToast(id), kind === 'error' ? 8000 : 4000);
}

// ---------------------------------------------------------------------------
// Derived collections (reactively recomputed by callers from the signals they
// read: drawing artefacts/layers, the drawing store, and the recorder).
// ---------------------------------------------------------------------------

export function allArtefacts(): Artefact[] {
    return drawing.getArtefacts();
}
export function allLayers(): Layer[] {
    return drawing.getAllLayers();
}
export interface StoreDrawing extends DrawingStoreEntry {
    isRule: boolean;
    isFirstOrder: boolean;
}

export function allDrawings(): StoreDrawing[] {
    return drawingStore.getAllDrawings().map(entry => ({
        ...entry,
        isRule: entry.drawing.isRule,
        isFirstOrder: drawingStore.checkIsFirstOrder(entry.drawing)
    }));
}

export type RuleTag = { kind: 'invalid'; reason: string } | { kind: 'first' } | { kind: 'second' };

export function ruleTag(): RuleTag | null {
    if (!drawing.isRule) return null;
    const check = drawing.checkRuleConditions();
    if (!check.isRule) {
        return { kind: 'invalid', reason: check.reason ?? 'Unknown reason' } satisfies RuleTag;
    }
    return drawingStore.checkIsFirstOrder(drawing)
        ? ({ kind: 'first' } satisfies RuleTag)
        : ({ kind: 'second' } satisfies RuleTag);
}

// ---------------------------------------------------------------------------
// Position picker helpers
// ---------------------------------------------------------------------------

function setBodyCursor(cursor: string): void {
    if (typeof document === 'undefined') return;
    d3.select('body').style('cursor', cursor);
}

export function stopPositionPicker(): void {
    ui.positionPicker = null;
    setBodyCursor('default');
}

export function startPositionPicker(target: PositionPicker): void {
    ui.positionPicker = target;
    setBodyCursor('crosshair');
}

function resolvePickerTarget(picker: PositionPicker):
    { sortName: string; data: Record<string, DataAttributeValue>; dependencies: Record<string, Artefact>; isDraft: boolean } | null {
    if (picker.kind === 'draft') {
        const draft = ui.draftArtefact;
        if (!draft) return null;
        return { sortName: draft.sortName, data: draft.data, dependencies: draft.dependencies, isDraft: true };
    }
    const artefact = drawing.getArtefactById(picker.id);
    if (!artefact) return null;
    return { sortName: artefact.sortName, data: artefact.data, dependencies: artefact.dependencies, isDraft: false };
}

export function applyPickedPosition(x: number, y: number): void {
    const picker = ui.positionPicker;
    if (!picker) return;
    const target = resolvePickerTarget(picker);
    if (!target) {
        stopPositionPicker();
        return;
    }
    const sortDef = sortStore.getSort(target.sortName);
    const attrType = sortDef?.attributes[picker.attrName];
    const { isDraft } = target;

    if (attrType && getAttributeType(attrType) === 'relativePosition') {
        const rpMeta = getRelativePositionMeta(attrType);
        if (rpMeta) {
            const [depKey, fieldPath] = rpMeta.target.split(".");
            const depArtefact = target.dependencies[depKey];
            if (depArtefact) {
                const depSortDef = sortStore.getSort(depArtefact.sortName);
                const depResolved = depArtefact.getResolvedData(undefined, undefined, depSortDef, (n) => sortStore.getSort(n));
                let depPos: any = depResolved;
                for (const seg of fieldPath.split('.')) depPos = depPos?.[seg];
                if (Array.isArray(depPos) && depPos.length === 2) {
                    const value: [number, number] = [x - depPos[0], y - depPos[1]];
                    if (isDraft) {
                        setDraftDataField(picker.attrName, value);
                    } else {
                        target.data[picker.attrName] = value;

                    }
                    stopPositionPicker();
                    return;
                }
            }
        }
    }
    if (isDraft) {
        setDraftDataField(picker.attrName, [x, y]);
        finalizeDraftIfComplete();
    } else {
        target.data[picker.attrName] = [x, y];

    }
    stopPositionPicker();
}

export function getSinglePositionAttr(sortDef: SortDefinition): string | null {
    const positionAttrs = Object.entries(sortDef.attributes)
        .filter(([_, type]) => getAttributeType(type) === 'position')
        .map(([name]) => name);
    return positionAttrs.length === 1 ? positionAttrs[0] : null;
}

export function isPositionPickerActive(artefact: Artefact, attrName: string): boolean {
    const picker = ui.positionPicker;
    if (!picker) return false;
    if (picker.attrName !== attrName) return false;
    return picker.kind === 'artefact' && picker.id === artefact.id;
}

export function isDraftPickerActive(attrName: string): boolean {
    const picker = ui.positionPicker;
    if (!picker) return false;
    return picker.kind === 'draft' && picker.attrName === attrName;
}

export function togglePositionPicker(artefact: Artefact, attrName: string): void {
    if (isPositionPickerActive(artefact, attrName)) {
        stopPositionPicker();
    } else {
        startPositionPicker({ kind: 'artefact', id: artefact.id, attrName });
    }
}

export function toggleDraftPicker(attrName: string): void {
    if (isDraftPickerActive(attrName)) {
        stopPositionPicker();
    } else {
        startPositionPicker({ kind: 'draft', attrName });
    }
}

// ---------------------------------------------------------------------------
// Draft artefact helpers (mutations go through `update` so subscribers fire)
// ---------------------------------------------------------------------------

export function findNextUnfilledDependency(draft: DraftArtefact): string | null {
    const sortDef = sortStore.getSort(draft.sortName);
    if (!sortDef) return null;
    for (const [depKey] of Object.entries(sortDef.dependencies)) {
        if (!draft.dependencies[depKey]) {
            return depKey;
        }
    }
    return null;
}

export function setDraftDataField(name: string, value: DataAttributeValue): void {
    const d = ui.draftArtefact;
    if (!d) return;
    const nextData = { ...d.data };
    if (name === 'label' && value === '') {
        delete nextData[name];
    } else {
        nextData[name] = value;
    }
    ui.draftArtefact = { ...d, data: nextData };
}

export function setDraftLayer(layerId: string): void {
    const d = ui.draftArtefact;
    if (!d) return;
    ui.draftArtefact = { ...d, layerId };
}

export function startDraftForSort(sortDef: SortDefinition): void {
    ui.inspectedArtefact = null;
    cancelMergeMode();

    const initialData: Record<string, DataAttributeValue> = {};
    for (const [attrName, attrType] of Object.entries(sortDef.attributes)) {
        const typeName = getAttributeType(attrType);
        if (typeName === 'position') {
            initialData[attrName] = [300, 300];
        } else if (typeName === 'relativePosition') {
            initialData[attrName] = [0, 0];
        } else if (typeName === 'slider') {
            const meta = getSliderMeta(attrType);
            initialData[attrName] = meta ? meta.default : 0;
        } else if (typeName === 'number') {
            initialData[attrName] = attrName === 'bend' ? 0 : 2;
        } else if (typeName === 'boolean') {
            initialData[attrName] = false;
        } else if (typeName === 'string') {
            initialData[attrName] = '';
        }
    }

    const focusedId = drawing.getFocusedLayerId();
    const allLayersList = drawing.getAllLayers();
    const defaultLayerId = focusedId || (allLayersList.length > 0 ? allLayersList[0].id : 'root');

    const draft: DraftArtefact = {
        sortName: sortDef.name,
        dependencies: {},
        data: initialData,
        layerId: defaultLayerId
    };
    ui.draftArtefact = draft;
    stopPositionPicker();

    if (sortDef.name === 'Equality') {
        ui.dependencyPickingFor = 'Equality';
    } else {
        const firstDep = findNextUnfilledDependency(draft);
        ui.dependencyPickingFor = firstDep;
        if (firstDep) {
            const expectedSort = sortDef.dependencies[firstDep];
            const pickableCount = drawing.getArtefacts()
                .filter(a => a.sortName === expectedSort)
                .filter(a => !focusedId || a.layerId === focusedId)
                .length;
            if (pickableCount === 0) {
                pushToast('info', `No '${expectedSort}' artefacts to pick yet — create one first.`);
            }
        }
    }

    const singlePositionAttr = getSinglePositionAttr(sortDef);
    if (singlePositionAttr) {
        startPositionPicker({ kind: 'draft', attrName: singlePositionAttr });
    }


}

export function startDuplicateArtefact(art: Artefact): void {
    if (art.sortName === 'Equality') {
        pushToast('error', 'Cannot duplicate an equality artefact.');
        return;
    }
    const sortDef = sortStore.getSort(art.sortName);
    if (!sortDef) {
        pushToast('error', `Sort '${art.sortName}' is not defined.`);
        return;
    }

    ui.inspectedArtefact = null;
    cancelMergeMode();
    stopPositionPicker();

    const copiedData: Record<string, DataAttributeValue> = JSON.parse(JSON.stringify(art.data));

    const draft: DraftArtefact = {
        sortName: art.sortName,
        dependencies: {},
        data: copiedData,
        layerId: art.layerId,
        duplicateOf: art
    };
    ui.draftArtefact = draft;

    const firstDep = findNextUnfilledDependency(draft);
    ui.dependencyPickingFor = firstDep;


}

export function duplicateArtefactNode(art: Artefact): void {
    startDuplicateArtefact(art);
}

export function cancelDraft(): void {
    ui.draftArtefact = null;
    ui.dependencyPickingFor = null;
    stopPositionPicker();

}

export function createDraftArtefact(): Artefact | null {
    const draft = ui.draftArtefact;
    if (!draft) return null;
    try {
        const finalDeps: Record<string, Artefact> = { ...draft.dependencies };
        let created: Artefact;
        if (draft.duplicateOf) {
            const dupResult = drawing.duplicateArtefact(draft.duplicateOf, finalDeps, draft.data, draft.layerId);
            created = dupResult.artefact;
            if (rocqRecorder.isActive()) {
                const activeName = ui.activeDrawingName ?? 'Unsaved Drawing';
                rocqRecorder.recordDuplicate(drawing, draft.duplicateOf, created, activeName, sortStore);
            }
        } else {
            created = drawing.newArtefact(draft.sortName, finalDeps, draft.data, draft.layerId);
        }
        ui.draftArtefact = null;
        ui.dependencyPickingFor = null;
        stopPositionPicker();

        return created;
    } catch (err) {
        pushToast('error', (err as Error).message);
        return null;
    }
}

export function finalizeDraftIfComplete(): Artefact | null {
    const draft = ui.draftArtefact;
    if (!draft) return null;
    if (!isDraftComplete(draft)) return null;
    const created = createDraftArtefact();
    if (created) {
        selectArtefactToInspect(created);
    }
    return created;
}

export function isDraftComplete(draft: DraftArtefact): boolean {
    const sortDef = sortStore.getSort(draft.sortName);
    if (!sortDef) return false;
    if (draft.sortName === 'Equality') {
        return equalityChildren(draft).length >= 2;
    }
    for (const [depKey] of Object.entries(sortDef.dependencies)) {
        if (!draft.dependencies[depKey]) {
            return false;
        }
    }
    for (const [attrName, _] of Object.entries(sortDef.attributes)) {
        if (draft.data[attrName] === undefined) {
            return false;
        }
    }
    return true;
}

// ---------------------------------------------------------------------------
// Merge helpers
// ---------------------------------------------------------------------------

export function startMergeMode(preselectFirst: Artefact | null = null): void {
    ui.draftArtefact = null;
    ui.dependencyPickingFor = null;
    ui.mergeHoverArtefact = null;
    stopPositionPicker();

    ui.mergeMode = true;
    if (preselectFirst && drawing.getArtefacts().includes(preselectFirst)) {
        ui.mergeFirstArtefact = preselectFirst;
        ui.mergeSecondArtefact = null;
        ui.mergePickingFor = 'second';
    } else {
        ui.mergeFirstArtefact = null;
        ui.mergeSecondArtefact = null;
        ui.mergePickingFor = 'first';
    }

}

export function cancelMergeMode(): void {
    ui.mergeMode = false;
    ui.mergeFirstArtefact = null;
    ui.mergeSecondArtefact = null;
    ui.mergePickingFor = null;
    ui.mergeHoverArtefact = null;

}

export function selectMergeArtefact(artefact: Artefact): void {
    ui.mergeHoverArtefact = null;
    const first = ui.mergeFirstArtefact;
    const pickingFor = ui.mergePickingFor;
    if (pickingFor === 'first' || !first) {
        ui.mergeFirstArtefact = artefact;
        if (ui.mergeSecondArtefact === artefact) {
            ui.mergeSecondArtefact = null;
        }
        ui.mergePickingFor = 'second';
    } else if (pickingFor === 'second' || first) {
        if (artefact === first) {
            pushToast('error', 'Cannot merge an artefact with itself.');
        } else if (!drawing.areDependenciesEqual(first, artefact)) {
            pushToast('error', `Cannot merge: Artefact '${artefact.data.label || artefact.sortName}' does not have matching dependencies.`);
        } else {
            ui.mergeSecondArtefact = artefact;
            ui.mergePickingFor = null;
        }
    }

}

export function performMerge(): void {
    const first = ui.mergeFirstArtefact;
    const second = ui.mergeSecondArtefact;
    if (!first || !second || first === second || !drawing.areDependenciesEqual(first, second)) return;
    try {
        const mergedResult = drawing.mergeArtefacts(first, second);
        ui.mergeMode = false;
        ui.mergeFirstArtefact = null;
        ui.mergeSecondArtefact = null;
        ui.mergePickingFor = null;
        ui.mergeHoverArtefact = null;
        ui.inspectedArtefact = mergedResult;

    } catch (err) {
        pushToast('error', (err as Error).message);
    }
}

export function mergeBaseOpacityFor(art: Artefact): number {
    const first = ui.mergeFirstArtefact;
    if (art === first || art === ui.mergeSecondArtefact) {
        return 1.0;
    }
    if (first && drawing.areDependenciesEqual(first, art)) {
        return drawing.areProvablyEqual(first, art) ? 1.0 : 0.85;
    }
    if (!first) {
        return 0.85;
    }
    return 0.35;
}

export function isDuplicateEligible(art: Artefact): boolean {
    const draft = ui.draftArtefact;
    const picking = ui.dependencyPickingFor;
    if (!draft?.duplicateOf || !picking) return false;
    const sortDef = sortStore.getSort(draft.sortName);
    const expectedSort = sortDef?.dependencies[picking];
    if (!expectedSort || art.sortName !== expectedSort) return false;
    const origDep = draft.duplicateOf.dependencies[picking];
    if (!origDep) return false;
    return drawing.areEqual(origDep, art, draft.layerId);
}

export function isProvablyEqualCandidate(art: Artefact): boolean {
    const first = ui.mergeFirstArtefact;
    if (ui.mergeMode && !!first && art !== first
        && drawing.areDependenciesEqual(first, art)
        && drawing.areProvablyEqual(first, art)) {
        return true;
    }
    return isDuplicateEligible(art);
}

// ---------------------------------------------------------------------------
// Misc helpers
// ---------------------------------------------------------------------------

export function getArtefactLabel(art: Artefact): string {
    if (art.data.label) return art.data.label;
    if (art.sortName === 'Equality') {
        return equalityChildren(art).map(c => c.data.label || c.sortName).join(' = ');
    }
    return '(unnamed)';
}

export function equalityChildren(art: { dependencies: Record<string, Artefact> }): Artefact[] {
    return Object.values(art.dependencies);
}

// ---------------------------------------------------------------------------
// Drawing / rule helpers used by the UI
// ---------------------------------------------------------------------------

export function resetInteractionState(): void {
    ui.inspectedArtefact = null;
    ui.focusedLayerId = null;
    drawing.setFocusedLayer(null);
    ui.draftArtefact = null;
    ui.dependencyPickingFor = null;
    ui.layerProvability.clear();
    ui.mergeMode = false;
    ui.mergeFirstArtefact = null;
    ui.mergeSecondArtefact = null;
    ui.mergePickingFor = null;
    ui.mergeHoverArtefact = null;
    stopPositionPicker();
}

export function setActiveDrawing(name: string): boolean {
    try {
        const entry = drawingStore.getDrawing(name);
        if (!entry) {
            pushToast('error', `Drawing '${name}' does not exist.`);
            return false;
        }
        drawing.forgetSvgRefs();
        drawing = entry.drawing;
        ui.activeDrawingName = name;
        resetInteractionState();
        syncProvedStatus();
        return true;
    } catch (err) {
        pushToast('error', `Error opening drawing:\n${(err as Error).message}`);
        return false;
    }
}

export function getSelectedDrawingNames(): string[] {
    const existing = new Set(drawingStore.getAllNames());
    return Array.from(ui.exportSelection).filter(name => existing.has(name));
}

export function downloadDrawingsJson(names: string[]): void {
    try {
        const jsonStr = drawingStore.exportDrawingsJSON(names);
        const blob = new Blob([jsonStr], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'drawings.json';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    } catch (err) {
        pushToast('error', `Error exporting drawings:\n${(err as Error).message}`);
    }
}

export function copyRocqExport(names: string[]): void {
    try {
        const drawings: DrawingStoreEntry[] = names
            .map(name => drawingStore.getDrawing(name))
            .filter((d): d is DrawingStoreEntry => !!d);
        if (drawings.length === 0) {
            pushToast('error', 'Error exporting drawings:\nNo drawings found in the store.');
            return;
        }
        const code = exportDrawingsToRocq(drawings, sortStore);
        const ruleCount = drawings.filter(d => d.drawing.isRule).length;
        navigator.clipboard
            .writeText(code)
            .then(() => {
                pushToast('info', `Exported ${ruleCount} rule${ruleCount === 1 ? '' : 's'} to Rocq.`);
            })
            .catch(() => {
                pushToast('error', 'Error exporting drawings:\nClipboard access failed.');
            });
    } catch (err) {
        pushToast('error', `Error exporting drawings:\n${(err as Error).message}`);
    }
}

// ---------------------------------------------------------------------------
// Artefact inspection / data editing helpers
// ---------------------------------------------------------------------------

export function selectArtefactToInspect(art: Artefact): void {
    const nowInspected = ui.inspectedArtefact !== art;
    ui.inspectedArtefact = nowInspected ? art : null;
    if (nowInspected) {
        ui.draftArtefact = null;
        ui.dependencyPickingFor = null;
        stopPositionPicker();
    }

}

export function setArtefactDataField(art: Artefact, name: string, value: DataAttributeValue): void {
    if (name === 'label' && value === '') {
        delete art.data.label;
    } else {
        art.data[name] = value;
    }

}

export function setInspectedLabel(art: Artefact, rawLabel: string): void {
    const target = rawLabel.trim();
    const activeName = ui.activeDrawingName ?? 'Unsaved Drawing';
    const isRootLayer = art.layerId === 'root' || drawing.getLayer(art.layerId)?.parentId === null;
    let oldFieldName: string | null = null;
    if (rocqRecorder.isActive() && isRootLayer) {
        const oldExport = drawingExportNames(drawing, activeName, sortStore);
        oldFieldName = oldExport.fieldNames.get(art.id) ?? null;
    }
    if (target === '') {
        delete art.data.label;
    } else {
        art.data.label = target;
    }
    if (rocqRecorder.isActive() && isRootLayer && oldFieldName) {
        const newExport = drawingExportNames(drawing, activeName, sortStore);
        const newFieldName = newExport.fieldNames.get(art.id);
        if (newFieldName && newFieldName !== oldFieldName) {
            rocqRecorder.recordRename(oldFieldName, newFieldName, activeName);
        }
    }

}

export function setArtefactLayer(art: Artefact, targetLayerId: string): void {
    drawing.setArtefactLayer(art, targetLayerId);

}

function autoSelectLayerFromDependencies(): void {
    const draft = ui.draftArtefact;
    if (!draft) return;
    const depLayerIds = Object.values(draft.dependencies).map(d => d.layerId);
    if (depLayerIds.length === 0) return;
    const best = drawing.getBestLayerForDependencies(depLayerIds);
    if (best && best !== draft.layerId) {
        setDraftLayer(best);
    }
}

export function pickDraftDependency(artefact: Artefact): void {
    const draft = ui.draftArtefact;
    const picking = ui.dependencyPickingFor;
    if (!draft || !picking) return;

    if (draft.sortName === 'Equality') {
        const existingItems = equalityChildren(draft);
        if (existingItems.length > 0 && existingItems[0].sortName !== artefact.sortName) {
            pushToast('error', `Equality artefact requires all elements to be of sort '${existingItems[0].sortName}', but selected '${artefact.sortName}'.`);
            return;
        }
        const nextIdx = Object.keys(draft.dependencies).length;
        ui.draftArtefact = { ...draft, dependencies: { ...draft.dependencies, [`${nextIdx}`]: artefact } };

        autoSelectLayerFromDependencies();
        finalizeDraftIfComplete();
        return;
    }

    const sortDef = sortStore.getSort(draft.sortName);
    const expectedSort = sortDef?.dependencies[picking];
    if (expectedSort && artefact.sortName === expectedSort) {
        if (draft.duplicateOf) {
            const origDep = draft.duplicateOf.dependencies[picking];
            if (!origDep) {
                pushToast('error', `Original artefact is missing dependency '${picking}'.`);
                return;
            }
            if (!drawing.areEqual(origDep, artefact, draft.layerId)) {
                pushToast('error', `Selected dependency '${artefact.data.label || artefact.sortName}' is not provably equal to the original dependency '${origDep.data.label || origDep.sortName}'.`);
                return;
            }
        }
        if (draft) {
            ui.draftArtefact = { ...draft, dependencies: { ...draft.dependencies, [picking]: artefact } };
        }
        ui.dependencyPickingFor = findNextUnfilledDependency(ui.draftArtefact as DraftArtefact);

        // Auto-activate picker for relativePosition attrs targeting this dep key
        if (sortDef) {
            for (const [attrName, attrType] of Object.entries(sortDef.attributes)) {
                if (getAttributeType(attrType) !== 'relativePosition') continue;
                const rpMeta = getRelativePositionMeta(attrType);
                if (!rpMeta || rpMeta.target.split('.')[0] !== picking) continue;
                startPositionPicker({ kind: 'draft', attrName });
                break;
            }
        }
        autoSelectLayerFromDependencies();
        finalizeDraftIfComplete();
    } else {
        pushToast('error', `Expected sort '${expectedSort}', but selected '${artefact.sortName}'.`);
    }
}

export function removeArtefactNode(artefact: Artefact, parentArtefact: Artefact | null = null): void {
    if (parentArtefact && parentArtefact.sortName === 'Equality') {
        drawing.removeEqualityChild(parentArtefact, artefact);
    } else {
        drawing.removeArtefact(artefact);
    }
    pruneStaleArtefactRefs();

}

// Clear interaction state that references artefacts no longer present in the
// drawing. This is a validity sweep rather than a check against the removed
// artefact on purpose: removeArtefact also removes every transitive dependent,
// so the inspected/picked artefact can disappear as collateral without being
// the node the user deleted.
function pruneStaleArtefactRefs(): void {
    const inspected = ui.inspectedArtefact;
    if (inspected && !drawing.getArtefactById(inspected.id)) {
        ui.inspectedArtefact = null;
    }
    const picker = ui.positionPicker;
    if (picker?.kind === 'artefact' && !drawing.getArtefactById(picker.id)) {
        stopPositionPicker();
    }
}

function hasSameSortLayerNeighbour(artefact: Artefact, delta: -1 | 1): boolean {
    const arts = drawing.getArtefacts();
    const idx = arts.indexOf(artefact);
    if (idx === -1) return false;
    let i = idx + delta;
    while (i >= 0 && i < arts.length) {
        const other = arts[i];
        if (other.sortName === artefact.sortName && other.layerId === artefact.layerId) return true;
        i += delta;
    }
    return false;
}

export function canMoveArtefactUp(artefact: Artefact): boolean {
    return hasSameSortLayerNeighbour(artefact, -1);
}

export function canMoveArtefactDown(artefact: Artefact): boolean {
    return hasSameSortLayerNeighbour(artefact, 1);
}

export function moveArtefactUp(artefact: Artefact): void {
    try {
        drawing.moveArtefact(artefact, -1);

    } catch (err) {
        pushToast('error', (err as Error).message);
    }
}

export function moveArtefactDown(artefact: Artefact): void {
    try {
        drawing.moveArtefact(artefact, 1);

    } catch (err) {
        pushToast('error', (err as Error).message);
    }
}

export function onArtefactNodeClick(art: Artefact): void {
    if (ui.mergeMode) {
        selectMergeArtefact(art);
        return;
    }
    if (ui.dependencyPickingFor && ui.draftArtefact) {
        pickDraftDependency(art);
        return;
    }
    selectArtefactToInspect(art);
}

// ---------------------------------------------------------------------------
// Drawing store / rule / recording app actions
// ---------------------------------------------------------------------------

export function isCurrentDrawingRule(): boolean {
    return drawing.isRule;
}

export interface RecordedStatementInfo {
    drawingName: string;
    lemmaName: string;
    proved: boolean;
    isMain: boolean;
}

export function recordedStatements(): RecordedStatementInfo[] {
    return rocqRecorder.getRecordedStatements();
}

export function recordedStatementByDrawing(): Map<string, RecordedStatementInfo> {
    const map = new Map<string, RecordedStatementInfo>();
    for (const s of rocqRecorder.getRecordedStatements()) {
        map.set(s.drawingName, s);
    }
    return map;
}

export function pendingProofCount(): number {
    return rocqRecorder.getRecordedStatements().filter(s => !s.isMain && !s.proved).length;
}

export function setCurrentDrawingRule(checked: boolean): void {
    try {
        drawing.setIsRule(checked);

    } catch (err) {
        pushToast('error', (err as Error).message);
    }
}

export function duplicateCurrentDrawing(): void {
    const activeName = ui.activeDrawingName;
    const suggested = activeName ? `${activeName} copy` : 'Drawing copy';
    const input = prompt('Enter a name for the duplicate drawing:', suggested);
    if (!input || !input.trim()) return;
    const name = input.trim();
    if (drawingStore.getDrawing(name)) {
        pushToast('error', `A drawing named '${name}' already exists.`);
        return;
    }
    try {
        const copy = DrawingStore.cloneDrawing(drawing, sortStore);
        drawing.forgetSvgRefs();
        drawingStore.addDrawing(name, copy);
        drawing = copy;
        ui.activeDrawingName = name;
        resetInteractionState();
        pushToast('info', `Duplicated drawing as '${name}'.`);
    } catch (err) {
        pushToast('error', (err as Error).message);
    }
}

export function newDrawing(): void {
    const input = prompt('Enter a name for the new drawing:');
    if (!input || !input.trim()) return;
    const name = input.trim();
    if (drawingStore.getDrawing(name)) {
        pushToast('error', `A drawing named '${name}' already exists.`);
        return;
    }
    const fresh = new Drawing(sortStore);
    try {
        drawingStore.addDrawing(name, fresh);
        drawing.forgetSvgRefs();
        drawing = fresh;
        ui.activeDrawingName = name;
        resetInteractionState();
    } catch (err) {
        pushToast('error', (err as Error).message);
    }
}

export async function importDrawingsFile(file: File): Promise<void> {
    const text = await file.text();
    try {
        const { names, renames } = drawingStore.importDrawingsJSON(text, sortStore);
        let summary = `Imported ${names.length} drawing(s): ${names.map(n => `'${n}'`).join(', ')}.`;
        if (renames.length > 0) {
            summary += `\nRenamed on collision: ${renames.map(r => `'${r.requested}' -> '${r.actual}'`).join(', ')}.`;
        }
        pushToast('info', summary);

    } catch (err) {
        pushToast('error', `Error importing drawing:\n${(err as Error).message}`);
    }
}

export function deleteSelectedDrawings(names: string[]): void {
    if (names.length === 0) {
        pushToast('error', 'Select at least one drawing to delete.');
        return;
    }
    if (!confirm(`Are you sure you want to delete ${names.length} drawing(s): ${names.map(n => `'${n}'`).join(', ')}?`)) {
        return;
    }
    const deleted = new Set(names);
    for (const name of names) {
        if (name === ui.activeDrawingName) {
            drawing.forgetSvgRefs();
            drawing = new Drawing(sortStore);
            ui.activeDrawingName = null;
            resetInteractionState();
        }
        drawingStore.deleteDrawing(name);
    }
    for (const name of deleted) {
        ui.exportSelection.delete(name);
    }

}

export function renameDrawingName(oldName: string, newName: string): void {
    try {
        drawingStore.renameDrawing(oldName, newName);
        if (oldName === ui.activeDrawingName) {
            ui.activeDrawingName = newName;
        }
        if (ui.exportSelection.has(oldName)) {
            ui.exportSelection.delete(oldName);
            ui.exportSelection.add(newName);
        }

    } catch (err) {
        pushToast('error', (err as Error).message);
    }
}

export function markDrawingAsRule(name: string, isRule: boolean): void {
    try {
        drawingStore.markAsRule(name, isRule);

    } catch (err) {
        pushToast('error', (err as Error).message);
    }
}

export function toggleRocqRecording(): void {
    try {
        if (rocqRecorder.isActive()) {
            const stmts = rocqRecorder.getRecordedStatements();
            const script = rocqRecorder.stop();
            ui.rocqRecordingActive = false;
            navigator.clipboard
                .writeText(script)
                .then(() => {
                    const proved = stmts.filter(s => s.proved).length;
                    const admittedStmts = stmts.filter(s => !s.proved);
                    const admitted = admittedStmts.length;
                    const admittedNames = admitted > 0 ? ` (admitted: ${admittedStmts.map(s => `'${s.drawingName}'`).join(', ')})` : '';
                    pushToast('info', `Rocq recording script copied to clipboard (${stmts.length} lemma${stmts.length === 1 ? '' : 's'}: ${proved} proved, ${admitted} admitted${admittedNames}).`);
                })
                .catch(() => {
                    pushToast('error', 'Error copying recording:\nClipboard access failed.');
                });
        } else {
            const name = ui.activeDrawingName ?? 'Unsaved Drawing';
            rocqRecorder.start(drawing, name, sortStore);
            ui.rocqRecordingActive = true;
        }

    } catch (err) {
        pushToast('error', `Rocq Recording Error:\n${(err as Error).message}`);
    }
}

export function toggleExportSelection(name: string): void {
    if (ui.exportSelection.has(name)) {
        ui.exportSelection.delete(name);
    } else {
        ui.exportSelection.add(name);
    }
}

export function setExportSelectionAll(checked: boolean): void {
    ui.exportSelection = checked ? new SvelteSet(drawingStore.getAllNames()) : new SvelteSet();
}

export function clearAll(): void {
    if (!confirm('Are you sure you want to clear all artefacts and layers of the current drawing?')) {
        return;
    }
    drawing.clear();
    resetInteractionState();

}

export async function loadSortScript(file: File): Promise<void> {
    const code = await file.text();
    try {
        sortStore.clear();
        drawing.clear();
        resetInteractionState();
        const executor = new Function('sortStore', 'd3', code);
        executor(sortStore, d3);

    } catch (err) {
        pushToast('error', `Error executing sort script:\n${(err as Error).message}`);
        console.error('Script Execution Error:', err);
    }
}

// ---------------------------------------------------------------------------
// Layer helpers
// ---------------------------------------------------------------------------

export function addRootLayer(): void {
    const name = prompt('Enter name for new root layer:', 'New Root Layer');
    if (name && name.trim()) {
        const id = `layer-${Date.now().toString(36)}`;
        drawing.addLayer(id, name.trim(), null, '#9b59b6', true);

    }
}

export function addChildLayer(layer: { id: string; name: string }): void {
    const childName = prompt(`Enter name for child layer above '${layer.name}':`, `Child of ${layer.name}`);
    if (childName && childName.trim()) {
        const childId = `layer-${Date.now().toString(36)}`;
        const randomColor = `#${Math.floor(Math.random() * 16777215).toString(16).padStart(6, '0')}`;
        drawing.addLayer(childId, childName.trim(), layer.id, randomColor, true);

    }
}

export function renameLayer(layer: { id: string; name: string }): void {
    const newName = prompt(`Enter new name for layer '${layer.name}':`, layer.name);
    if (newName && newName.trim() && newName.trim() !== layer.name) {
        layer.name = newName.trim();

    }
}

export function deleteLayer(layer: { id: string; name: string }): void {
    const descendants = drawing.getDescendants(layer.id);
    const msg = descendants.size > 1
        ? `Delete '${layer.name}' and its ${descendants.size - 1} child layer(s)? All associated artefacts will be removed!`
        : `Delete layer '${layer.name}'?`;
    if (confirm(msg)) {
        drawing.removeLayer(layer.id);
        if (ui.focusedLayerId && descendants.has(ui.focusedLayerId!)) {
            ui.focusedLayerId = null;
        }

    }
}

export function toggleLayerVisibility(layer: { id: string; visible: boolean }): void {
    layer.visible = !layer.visible;

}

export function toggleLayerFocus(layerId: string): void {
    const current = ui.focusedLayerId;
    if (current === layerId) {
        ui.focusedLayerId = null;
        drawing.setFocusedLayer(null);
    } else {
        ui.focusedLayerId = layerId;
        drawing.setFocusedLayer(layerId);
    }

}

export function setLayerColor(layer: { id: string; color: string; colorEnabled: boolean }, color: string): void {
    layer.color = color;
    layer.colorEnabled = true;

}

export function toggleLayerColorEnabled(layer: { id: string; colorEnabled: boolean }, checked: boolean): void {
    layer.colorEnabled = checked;

}

export function checkLayerProvable(layerId: string): void {
    try {
        const result = drawing.checkLayerProvable(layerId);
        ui.layerProvability.set(layerId, { provable: result.provable, reason: result.reason ?? '' });
        if (result.provable) {
            rocqRecorder.recordProveSuccess(drawing, layerId, result.match ?? null, ui.activeDrawingName ?? 'Unsaved Drawing');
        }

    } catch (err) {
        pushToast('error', (err as Error).message);
    }
}

export function syncProvedStatus(): void {
    try {
        const child = getFirstOrderStatementChildLayer(drawing);
        let proved = false;
        if (child) {
            const result = drawing.checkLayerProvable(child.id);
            proved = result.provable;
            if (proved) {
                rocqRecorder.recordProveSuccess(drawing, child.id, result.match ?? null, ui.activeDrawingName ?? 'Unsaved Drawing');
            }
        }
        const name = ui.activeDrawingName;
        if (name) {
            drawingStore.setDrawingProved(name, proved);
        }
    } catch (err) {
        pushToast('error', `Proved status check failed:\n${(err as Error).message}`);
    }
}

export function toggleFilterRedundantMatches(): void {
    ui.filterRedundantMatches = !ui.filterRedundantMatches;
}

export function toggleFilterNoProgressMatches(): void {
    ui.filterNoProgressMatches = !ui.filterNoProgressMatches;
}

export function toggleFilterStrictMatches(): void {
    ui.filterStrictMatches = !ui.filterStrictMatches;
}

export function toggleFilterSolvesGoalMatches(): void {
    ui.filterSolvesGoalMatches = !ui.filterSolvesGoalMatches;
}

export function solvesGoalFilterApplicable(): boolean {
    return getFirstOrderStatementChildLayer(drawing) !== null;
}

// ---------------------------------------------------------------------------
// Applyable rules (computed reactively by RuleApplications.svelte)
// ---------------------------------------------------------------------------

export interface RuleAppEntry {
    name: string;
    drawing: Drawing;
    isFirstOrder: boolean;
    applications: RuleApplication[];
    hiddenRedundant: number;
    hiddenNoProgress: number;
    hiddenSolvesGoal: number;
}

export function computeRuleMatches(): RuleAppEntry[] {
    // Tracked structural guard: the matcher below runs under `untrack`, so this
    // derived still invalidates when the host drawing changes. We deliberately
    // read each artefact's reactive fields (membership, sort, layer, dependency
    // record) and the layer set so that any structural edit re-runs the search.
    const hostGuard = drawing.getArtefacts().map(a => {
        void a.sortName;
        void a.layerId;
        void a.dependencies;
        return a;
    });
    void hostGuard;
    void drawing.getAllLayers();

    const entries: RuleAppEntry[] = [];
    for (const entry of drawingStore.getAllDrawings()) {
        const ruleDrawing = entry.drawing;
        if (!ruleDrawing.isRule) continue;
        let applications: RuleApplication[];
        const strict = ui.filterStrictMatches;
        const isFirstOrder = drawingStore.checkIsFirstOrder(ruleDrawing);
        try {
            applications = untrack(() => isFirstOrder
                ? findFirstOrderRuleApplications(ruleDrawing, drawing, strict)
                : findSecondOrderRuleApplications(ruleDrawing, drawing, strict));
        } catch {
            continue;
        }

        entries.push({ name: entry.name, drawing: ruleDrawing, isFirstOrder, applications, hiddenRedundant: 0, hiddenNoProgress: 0, hiddenSolvesGoal: 0 });
    }
    return entries;
}

export function applyRuleFilters(entries: RuleAppEntry[]): RuleAppEntry[] {
    return entries.map(entry => {
        const { name, drawing: ruleDrawing } = entry;
        let applications = entry.applications;

        let hiddenRedundant = 0;
        if (ui.filterRedundantMatches && applications.length > 1) {
            const total = applications.length;
            applications = untrack(() => filterRedundantRuleApplications(ruleDrawing, drawing, applications));
            hiddenRedundant = total - applications.length;
        }

        let hiddenNoProgress = 0;
        if (ui.filterNoProgressMatches && applications.length > 0) {
            const total = applications.length;
            applications = untrack(() => filterNoProgressRuleApplications(ruleDrawing, drawing, applications));
            hiddenNoProgress = total - applications.length;
        }

        let hiddenSolvesGoal = 0;
        if (ui.filterSolvesGoalMatches && applications.length > 0) {
            const total = applications.length;
            applications = untrack(() => filterSolvesGoalRuleApplications(ruleDrawing, drawing, applications));
            hiddenSolvesGoal = total - applications.length;
        }

        return { name, drawing: ruleDrawing, isFirstOrder: entry.isFirstOrder, applications, hiddenRedundant, hiddenNoProgress, hiddenSolvesGoal };
    });
}

export function computeRuleApplications(): RuleAppEntry[] {
    return applyRuleFilters(computeRuleMatches());
}

export function applyRuleAt(savedRuleName: string, appIndex: number): void {
    const entry = computeRuleApplications().find(e => e.name === savedRuleName);
    if (!entry || !entry.applications[appIndex]) return;
    const { name, drawing: ruleDrawing, applications } = entry;
    const app = applications[appIndex];
    const activeName = ui.activeDrawingName ?? 'Unsaved Drawing';
    let applicationResult: { artefacts: Artefact[]; created: Map<Artefact, Artefact>; derivedNames?: string[]; derived?: DerivedRule[] } | null = null;
    try {
        if (entry.isFirstOrder) {
            const result = applyFirstOrderRule(ruleDrawing, drawing, app);
            applicationResult = result;
            console.log(`Applied '${name}': added ${result.artefacts.length} artefact(s).`);
        } else {
            const result = applySecondOrderRule(ruleDrawing, drawing, app, { hostName: activeName, ruleName: name });
            applicationResult = { artefacts: result.hostArtefacts, created: result.hostCreated, derived: result.derivedRules };
            console.log(`Applied '${name}': added ${result.hostArtefacts.length} artefact(s), derived ${result.derivedRules.length} drawing(s).`);
            const createdNames: string[] = [];
            for (const derived of result.derivedRules) {
                let derivedName = derived.name;
                let suffix = 2;
                while (drawingStore.getDrawing(derivedName)) {
                    derivedName = `${derived.name} (${suffix})`;
                    suffix++;
                }
                drawingStore.addDrawing(derivedName, derived.drawing);
                drawingStore.setDrawingParent(derivedName, activeName);
                createdNames.push(derivedName);
                console.log(`Saved derived drawing '${derivedName}': isRule=${derived.drawing.isRule}, artefacts=${derived.drawing.getArtefacts().length}.`);
            }
            applicationResult.derivedNames = createdNames;
            pushToast('info', `Applied rule '${name}': added ${result.hostArtefacts.length} artefact(s) and created ${createdNames.length} derived drawing(s):\n- ${createdNames.join('\n- ')}`);
        }
        if (applicationResult) {
            rocqRecorder.recordRuleApply(ruleDrawing, name, app, drawing, applicationResult, activeName, sortStore);
        }
        syncProvedStatus();

    } catch (err) {
        pushToast('error', `Error applying rule '${name}':\n${(err as Error).message}`);
    }
}

export function generateReverseRulesFor(savedRuleName: string): void {
    const entry = drawingStore.getDrawing(savedRuleName);
    if (!entry) {
        pushToast('error', `Drawing '${savedRuleName}' does not exist.`);
        return;
    }
    if (!entry.drawing.isRule || drawingStore.checkIsFirstOrder(entry.drawing)) {
        pushToast('error', `Drawing '${savedRuleName}' is not a second-order rule.`);
        return;
    }
    try {
        const results = generateFirstOrderReverseRules(entry.drawing);
        if (results.length === 0) {
            pushToast('info', `Second-order rule '${savedRuleName}' has no premise layers; nothing generated.`);
            return;
        }
        const createdNames: string[] = [];
        for (const result of results) {
            let name = `${savedRuleName} > ${result.premiseName} (reverse)`;
            let suffix = 2;
            while (drawingStore.getDrawing(name)) {
                name = `${savedRuleName} > ${result.premiseName} (reverse) (${suffix})`;
                suffix++;
            }
            drawingStore.addDrawing(name, result.drawing);
            drawingStore.setDrawingParent(name, savedRuleName);
            createdNames.push(name);
            console.log(`Generated reverse rule '${name}': isRule=${result.drawing.isRule}, artefacts=${result.drawing.getArtefacts().length}.`);
        }
        pushToast('info', `Generated ${createdNames.length} reverse rule(s) for '${savedRuleName}':\n- ${createdNames.join('\n- ')}`);

    } catch (err) {
        pushToast('error', `Error generating reverse rules for '${savedRuleName}':\n${(err as Error).message}`);
    }
}
