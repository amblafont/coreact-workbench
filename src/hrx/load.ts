import type { AttributeType, DrawingStore, SavedDrawing, SortStore } from '../index.svelte.ts';
import { parseHrx } from './codec';
import {
    buildModuleApi,
    collectModuleClosure,
    compileDrawFunction,
    parseRequires,
    topologicalOrder,
    type HrxModuleSource
} from './moduleRuntime';

export interface HrxLoadOptions {
    resolveDrawingConflict?: (
        name: string,
        existing: SavedDrawing,
        imported: SavedDrawing
    ) => 'keepExisting' | 'keepImported';
    /**
     * Called when the archive declares fewer equations than an existing sort.
     * Returning `true` keeps the existing sort and its equations; returning
     * `false` cancels the import.
     */
    resolveSortEquationConflict?: (
        name: string,
        existingEquations: string[],
        importedEquations: string[]
    ) => boolean;
}

export interface HrxLoadResult {
    sortsAdded: string[];
    sortsKept: string[];
    /** Sorts whose imported equations were weaker and were discarded on approval. */
    sortsKeptWithExistingEquations: string[];
    modulesAdded: string[];
    drawings: Array<{ name: string; requestedName: string; action: 'added' | 'renamed' | 'kept' | 'replaced' }>;
}

/** A sort previewed in the import dialog. */
export interface HrxSortPreview {
    name: string;
    kind: 'new' | 'existing';
    /** Only meaningful for new sorts; existing sorts use the two toggles below. */
    decision: 'add' | 'skip';
    /** Existing sort: keep the locally declared equations when the archive's are weaker. */
    keepEquations: boolean;
    /** Existing sort: take the draw function/source from the archive. */
    replaceDrawFunctions: boolean;
    /** Existing sort: whether the two equation sets are equivalent. */
    equationsEqual: boolean;
    /** Existing sort: whether the stored and archive source texts are identical. */
    drawFunctionsEqual: boolean;
    deps: string[];
    equations: string[];
    existingEquations?: string[];
    weakerEquations: boolean;
    /** Hard error found while reading the archive (blocks the whole import). */
    error?: string;
}

/** A drawing previewed in the import dialog. */
export interface HrxDrawingPreview {
    requestedName: string;
    /** Name used when the row is added or replaced. */
    name: string;
    kind: 'new' | 'existing';
    decision: 'add' | 'skip' | 'replace' | 'rename';
    renameTo: string;
    sortNames: string[];
    collision: 'new' | 'duplicate' | 'dataOnly' | 'structural';
    error?: string;
}

export interface HrxImportPlan {
    sorts: HrxSortPreview[];
    drawings: HrxDrawingPreview[];
    modulesAdded: string[];
    /** Archive-wide errors (e.g. conflicting modules). */
    errors: string[];
}

export interface HrxAnalyseOptions {
    /** The UI preview defaults to adding new rows and skipping existing drawings. */
    ui?: boolean;
    resolveSortEquationConflict?: HrxLoadOptions['resolveSortEquationConflict'];
    resolveDrawingConflict?: HrxLoadOptions['resolveDrawingConflict'];
}

export interface HrxPlanValidation {
    hasErrors: boolean;
    sortErrors: string[];
    drawingErrors: string[];
    generalErrors: string[];
}

interface HrxSortRecord {
    name: string;
    data: Record<string, AttributeType>;
    deps: Record<string, string>;
    equations: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function parseJsonSection(text: string, path: string): unknown {
    try {
        return JSON.parse(text);
    } catch (err) {
        throw new Error(`Consistency Check Failed: Invalid JSON in HRX section '${path}': ${(err as Error).message}`);
    }
}

function stable(value: unknown): string {
    if (Array.isArray(value)) {
        return `[${value.map(stable).join(',')}]`;
    }
    if (isRecord(value)) {
        return `{${Object.entries(value)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`)
            .join(',')}}`;
    }
    return JSON.stringify(value) ?? 'null';
}

/** Parse equations into canonical path keys without depending on sort sources. */
function parseEquationPaths(equations: string[], sortName: string): string[][] {
    return equations.map(raw => {
        const terms = raw.split('=').map(term => term.trim());
        if (terms.length < 2 || terms.some(term => term.length === 0)) {
            throw new Error(`Consistency Check Failed: Invalid equation '${raw}' in sort '${sortName}'.`);
        }
        return terms.map(term => {
            const segments = term.split('.');
            if (segments.some(segment => segment.length === 0)) {
                throw new Error(`Consistency Check Failed: Invalid dependency path '${term}' in equation '${raw}' of sort '${sortName}'.`);
            }
            return JSON.stringify(segments);
        });
    });
}

/** Convert parsed path segments to the same canonical keys used above. */
function canonicalizePaths(equations: string[][][]): string[][] {
    return equations.map(paths => paths.map(path => JSON.stringify(path)));
}

/**
 * Normalize equations into equality classes. This makes `a = b = c` equivalent
 * to `a = b` plus `b = c`, regardless of declaration order or duplicates.
 */
function equationClasses(equations: string[][]): string[][] {
    const parent = new Map<string, string>();
    const find = (key: string): string => {
        const current = parent.get(key);
        if (current === undefined) {
            parent.set(key, key);
            return key;
        }
        if (current === key) return key;
        const root = find(current);
        parent.set(key, root);
        return root;
    };

    for (const paths of equations) {
        if (paths.length === 0) continue;
        const first = find(paths[0]);
        for (let i = 1; i < paths.length; i++) {
            const root = find(paths[i]);
            if (root !== first) parent.set(root, first);
        }
    }

    const groups = new Map<string, string[]>();
    for (const key of parent.keys()) {
        const root = find(key);
        const group = groups.get(root) ?? [];
        group.push(key);
        groups.set(root, group);
    }
    return Array.from(groups.values())
        .map(group => group.sort())
        .sort((a, b) => stable(a).localeCompare(stable(b)));
}

function classesEqual(left: string[][], right: string[][]): boolean {
    return left.length === right.length && left.every((entry, index) => stable(entry) === stable(right[index]));
}

/** True when every imported equality class is contained in an existing class. */
function classesAreWeaker(imported: string[][], existing: string[][]): boolean {
    const existingSets = existing.map(entry => new Set(entry));
    return imported.every(entry => existingSets.some(set => entry.every(path => set.has(path))));
}

function parseSortRecords(text: string): HrxSortRecord[] {
    const parsed = parseJsonSection(text, 'sorts.json');
    if (!Array.isArray(parsed)) {
        throw new Error('Consistency Check Failed: HRX section sorts.json must contain an array.');
    }
    return parsed.map((item, index) => {
        if (!isRecord(item) || typeof item.name !== 'string' || !item.name.trim()) {
            throw new Error(`Consistency Check Failed: Invalid sort record at index ${index} in sorts.json.`);
        }
        // An omitted `data` field means a sort with no data attributes.
        const data = item.data === undefined ? {} : item.data;
        if (!isRecord(data) || !isRecord(item.deps)) {
            throw new Error(`Consistency Check Failed: Sort '${item.name}' must have an object 'deps' field and, if present, an object 'data' field.`);
        }
        for (const [depKey, depSort] of Object.entries(item.deps)) {
            if (typeof depSort !== 'string') {
                throw new Error(`Consistency Check Failed: Dependency '${depKey}' of sort '${item.name}' must name a sort.`);
            }
        }
        const equations = item.equations ?? [];
        if (!Array.isArray(equations) || equations.some(equation => typeof equation !== 'string')) {
            throw new Error(`Consistency Check Failed: Field 'equations' of sort '${item.name}' must be an array of strings.`);
        }
        return {
            name: item.name.trim(),
            data: data as Record<string, AttributeType>,
            deps: item.deps as Record<string, string>,
            equations: equations as string[]
        };
    });
}

function relativeSectionPaths(sections: Map<string, string>, prefix: string): string[] {
    return Array.from(sections.keys())
        .filter(path => path.startsWith(prefix) && path.endsWith('.js') && path.length > prefix.length + 3)
        .sort();
}

function sortSourcesFrom(sections: Map<string, string>): Map<string, string> {
    const sources = new Map<string, string>();
    for (const path of relativeSectionPaths(sections, 'sorts/')) {
        sources.set(path.slice('sorts/'.length, -'.js'.length), sections.get(path)!);
    }
    return sources;
}

function moduleProblem(body: string, modules: Map<string, HrxModuleSource>): string | undefined {
    try {
        collectModuleClosure(modules, parseRequires(body));
        return undefined;
    } catch (err) {
        return (err as Error).message;
    }
}

function importedDrawingList(payload: unknown): unknown[] {
    return isRecord(payload) && Array.isArray(payload.drawings) ? payload.drawings : [payload];
}

function firstPlanError(plan: HrxImportPlan, validation: HrxPlanValidation): string {
    return plan.errors[0] ||
        plan.sorts.find(row => !!row.error)?.error ||
        plan.drawings.find(row => !!row.error)?.error ||
        validation.sortErrors.find(Boolean) ||
        validation.drawingErrors.find(Boolean) ||
        'Consistency Check Failed: Invalid HRX archive.';
}

/**
 * Read an HRX archive and decide what would happen, without touching either
 * store or executing any module code. The returned plan is what the preview
 * dialog displays and edits before `applyHrxImportPlan` commits it.
 */
export function analyseHrxArchive(
    text: string,
    sortStore: SortStore,
    drawingStore: DrawingStore,
    options: HrxAnalyseOptions = {}
): HrxImportPlan {
    const uiMode = options.ui === true;
    const sections = parseHrx(text).sections;

    const sortsJson = sections.get('sorts.json');
    const drawingsJson = sections.get('drawings.json');
    if (sortsJson === undefined) {
        throw new Error('Consistency Check Failed: HRX archive has no sorts.json section.');
    }
    if (drawingsJson === undefined) {
        throw new Error('Consistency Check Failed: HRX archive has no drawings.json section.');
    }

    const sortRecords = parseSortRecords(sortsJson);
    const drawingPayload = parseJsonSection(drawingsJson, 'drawings.json');
    const importedSortSources = sortSourcesFrom(sections);

    const existingModules = sortStore.getAllModuleSources();
    const modules = new Map(existingModules);
    const modulesAdded: string[] = [];
    const generalErrors: string[] = [];
    for (const path of relativeSectionPaths(sections, 'js/')) {
        const name = path.slice('js/'.length, -'.js'.length);
        const source = sections.get(path)!;
        const imported = { source, requires: parseRequires(source) };
        const existing = existingModules.get(name);
        if (existing) {
            if (stable(existing) !== stable(imported)) {
                generalErrors.push(`Consistency Check Failed: Conflicting HRX module '${name}'.`);
            }
            continue;
        }
        modules.set(name, imported);
        modulesAdded.push(name);
    }

    const importedNames = new Set(sortRecords.map(record => record.name));
    const orderedRecords = topologicalOrder(
        importedNames,
        name => sortRecords.find(record => record.name === name)?.deps
            ? Object.values(sortRecords.find(record => record.name === name)!.deps)
            : []
    ).map(name => sortRecords.find(record => record.name === name)!);

    const sortConflictMessage = (name: string): string =>
        `Consistency Check Failed: Sort '${name}' already exists with different dependencies, data fields, or equations.`;
    const cancelledMessage = (name: string): string =>
        `Import cancelled: sort '${name}' declares fewer equations than the existing sort.`;

    const sorts: HrxSortPreview[] = [];
    for (const record of orderedRecords) {
        const body = importedSortSources.get(record.name);
        const existing = sortStore.getSort(record.name);
        const row: HrxSortPreview = {
            name: record.name,
            kind: existing ? 'existing' : 'new',
            decision: existing ? 'skip' : 'add',
            keepEquations: true,
            replaceDrawFunctions: false,
            equationsEqual: false,
            drawFunctionsEqual: false,
            deps: Object.values(record.deps),
            equations: record.equations,
            weakerEquations: false
        };

        // A sort may be declared without a drawing JS section; it simply has
        // no draw source to import or replace.
        if (body !== undefined) {
            row.error = moduleProblem(body, modules);
        }

        if (existing) {
            row.existingEquations = existing.equations.map(equation => equation.raw);
            row.drawFunctionsEqual = body === undefined || sortStore.getSortSource(record.name)?.drawBody === body;
            if (stable(existing.dependencies) !== stable(record.deps) ||
                stable(existing.attributes) !== stable(record.data)) {
                row.error = row.error ?? sortConflictMessage(record.name);
            } else {
                try {
                    const existingClasses = equationClasses(
                        canonicalizePaths(existing.equations.map(equation => equation.paths))
                    );
                    const importedClasses = equationClasses(parseEquationPaths(record.equations, record.name));
                    row.equationsEqual = classesEqual(existingClasses, importedClasses);
                    if (!row.equationsEqual) {
                        if (!classesAreWeaker(importedClasses, existingClasses)) {
                            row.error = row.error ?? sortConflictMessage(record.name);
                        } else {
                            row.weakerEquations = true;
                            if (options.resolveSortEquationConflict) {
                                if (!options.resolveSortEquationConflict(record.name, row.existingEquations, record.equations)) {
                                    row.error = row.error ?? cancelledMessage(record.name);
                                }
                            } else if (!uiMode) {
                                row.error = row.error ?? cancelledMessage(record.name);
                            }
                        }
                    }
                } catch (err) {
                    row.error = row.error ?? (err as Error).message;
                }
            }
        } else {
            try {
                parseEquationPaths(record.equations, record.name);
            } catch (err) {
                row.error = row.error ?? (err as Error).message;
            }
        }
        sorts.push(row);
    }

    const drawings: HrxDrawingPreview[] = [];
    const reservedNames = new Set<string>();
    importedDrawingList(drawingPayload).forEach((parsed, index) => {
        const fallbackName = `Drawing ${index + 1}`;
        const rawName = isRecord(parsed) && typeof parsed.name === 'string' && parsed.name.trim()
            ? parsed.name.trim()
            : fallbackName;
        try {
            const inspected = drawingStore.inspectDrawingImport(parsed, sortStore, reservedNames);
            const inWorkspace = drawingStore.getDrawing(inspected.requestedName) !== undefined;
            let decision: HrxDrawingPreview['decision'] = inWorkspace ? 'skip' : 'add';
            if (inWorkspace) {
                if (inspected.collision === 'duplicate') {
                    decision = 'skip';
                } else if (inspected.collision === 'structural') {
                    decision = uiMode ? 'skip' : 'rename';
                } else if (inspected.collision === 'dataOnly' && options.resolveDrawingConflict && inspected.existing) {
                    decision = options.resolveDrawingConflict(
                        inspected.requestedName,
                        inspected.existing,
                        inspected.built
                    ) === 'keepImported' ? 'replace' : 'skip';
                }
            }
            drawings.push({
                requestedName: inspected.requestedName,
                name: inspected.suggestedName,
                kind: inWorkspace ? 'existing' : 'new',
                decision,
                renameTo: inspected.suggestedName,
                sortNames: inspected.built.artefacts.map(artefact => artefact.sortName),
                collision: inspected.collision
            });
            reservedNames.add(inspected.requestedName);
            reservedNames.add(inspected.suggestedName);
        } catch (err) {
            drawings.push({
                requestedName: rawName,
                name: rawName,
                kind: drawingStore.getDrawing(rawName) ? 'existing' : 'new',
                decision: drawingStore.getDrawing(rawName) ? 'skip' : 'add',
                renameTo: rawName,
                sortNames: [],
                collision: 'new',
                error: (err as Error).message
            });
            reservedNames.add(rawName);
        }
    });

    return { sorts, drawings, modulesAdded, errors: generalErrors };
}

/**
 * Re-derive errors from the current decisions (and from the stores, which may
 * have changed since the preview opened). Pure: the plan is left untouched.
 */
export function validateHrxPlan(
    plan: HrxImportPlan,
    sortStore: SortStore,
    drawingStore: DrawingStore
): HrxPlanValidation {
    const sortErrors = plan.sorts.map(() => '');
    const drawingErrors = plan.drawings.map(() => '');

    const availableSorts = new Set(sortStore.getSortNames());
    availableSorts.add('Equality');
    const skippedNewSorts = new Set<string>();
    for (const row of plan.sorts) {
        if (row.kind !== 'new') continue;
        if (row.decision === 'add') availableSorts.add(row.name);
        else skippedNewSorts.add(row.name);
    }

    for (const [index, row] of plan.sorts.entries()) {
        if (row.error || row.decision === 'skip') continue;
        for (const dep of row.deps) {
            if (skippedNewSorts.has(dep)) {
                sortErrors[index] = `Dependency sort '${dep}' is skipped.`;
            } else if (!availableSorts.has(dep) && !sortErrors[index]) {
                sortErrors[index] = `Dependency sort '${dep}' is not available.`;
            }
        }
    }

    const targets = new Map<string, number>();
    for (const [index, row] of plan.drawings.entries()) {
        if (row.error || row.decision === 'skip') continue;
        const target = row.decision === 'rename'
            ? row.renameTo.trim()
            : row.decision === 'replace'
                ? row.requestedName
                : row.name;
        if (!target) {
            drawingErrors[index] = 'Enter a name for the renamed drawing.';
            continue;
        }
        if (targets.has(target)) {
            drawingErrors[index] = `Another drawing already targets '${target}'.`;
            continue;
        }
        if ((row.decision === 'rename' || row.decision === 'add') && drawingStore.getDrawing(target)) {
            drawingErrors[index] = `A drawing named '${target}' already exists.`;
            continue;
        }
        targets.set(target, index);
        for (const sortName of row.sortNames) {
            if (!availableSorts.has(sortName)) {
                drawingErrors[index] = `Sort '${sortName}' is not available; choose Add for it.`;
                break;
            }
        }
    }

    const hasErrors = plan.errors.length > 0 ||
        plan.sorts.some(row => !!row.error) ||
        plan.drawings.some(row => !!row.error) ||
        sortErrors.some(Boolean) ||
        drawingErrors.some(Boolean);
    return { hasErrors, sortErrors, drawingErrors, generalErrors: plan.errors };
}

/**
 * Commit an edited preview plan. This is the only function that mutates the
 * stores; it refuses to run while any error is present.
 */
export function applyHrxImportPlan(
    text: string,
    plan: HrxImportPlan,
    sortStore: SortStore,
    drawingStore: DrawingStore
): HrxLoadResult {
    const validation = validateHrxPlan(plan, sortStore, drawingStore);
    if (validation.hasErrors) {
        throw new Error(firstPlanError(plan, validation));
    }

    const sections = parseHrx(text).sections;
    const records = parseSortRecords(sections.get('sorts.json')!);
    const recordByName = new Map(records.map(record => [record.name, record]));
    const sortSources = sortSourcesFrom(sections);

    for (const name of plan.modulesAdded) {
        const source = sections.get(`js/${name}.js`);
        if (source !== undefined) {
            sortStore.registerModuleSource(name, { source, requires: parseRequires(source) });
        }
    }
    const moduleSources = sortStore.getAllModuleSources();
    const api = buildModuleApi(moduleSources, Array.from(moduleSources.keys()));

    const sortsAdded: string[] = [];
    const sortsKept: string[] = [];
    const sortsKeptWithExistingEquations: string[] = [];
    const order = topologicalOrder(
        new Set(plan.sorts.map(row => row.name)),
        name => plan.sorts.find(row => row.name === name)?.deps ?? []
    );
    for (const name of order) {
        const row = plan.sorts.find(entry => entry.name === name)!;
        const record = recordByName.get(name)!;
        const body = sortSources.get(name);
        if (row.kind === 'new') {
            if (row.decision !== 'add') continue;
            sortStore.newSort(
                name,
                record.deps,
                record.data,
                body === undefined ? () => null : compileDrawFunction(body, api),
                undefined,
                row.equations
            );
            if (body !== undefined) {
                sortStore.setSortSource(name, { drawBody: body, requires: parseRequires(body) });
            }
            sortsAdded.push(name);
            continue;
        }

        if (!row.keepEquations && row.weakerEquations) {
            sortStore.setSortEquations(name, row.equations);
        }
        if (row.replaceDrawFunctions && body !== undefined) {
            sortStore.setSortSource(name, { drawBody: body, requires: parseRequires(body) });
        }
        sortsKept.push(name);
        if (row.weakerEquations && row.keepEquations) {
            sortsKeptWithExistingEquations.push(name);
        }
    }

    const drawingsPayload = parseJsonSection(sections.get('drawings.json')!, 'drawings.json');
    const importedDrawings = importedDrawingList(drawingsPayload);
    const drawings: HrxLoadResult['drawings'] = [];
    importedDrawings.forEach((parsed, index) => {
        const row = plan.drawings[index];
        const identical = row.kind === 'existing' && row.collision === 'duplicate';
        if (identical || row.decision === 'skip' || row.error) {
            drawings.push({ name: row.name, requestedName: row.requestedName, action: 'kept' });
            return;
        }
        const result = drawingStore.importSavedDrawingWithDecision(parsed, sortStore, {
            kind: row.decision,
            name: row.decision === 'add' ? row.name : row.renameTo.trim()
        });
        drawings.push({ name: result.name, requestedName: row.requestedName, action: result.action });
    });

    return { sortsAdded, sortsKept, sortsKeptWithExistingEquations, modulesAdded: plan.modulesAdded, drawings };
}

/**
 * Programmatic import (used by callers that do not show the preview dialog).
 * It applies the same analysis/commit pipeline with the historical defaults:
 * errors abort, new sorts and drawings are added, existing structural
 * collisions are renamed, and conflicts go through the supplied callbacks.
 */
export function loadHrxArchive(
    text: string,
    sortStore: SortStore,
    drawingStore: DrawingStore,
    options: HrxLoadOptions = {}
): HrxLoadResult {
    const plan = analyseHrxArchive(text, sortStore, drawingStore, {
        ui: false,
        resolveSortEquationConflict: options.resolveSortEquationConflict ?? (() => false),
        resolveDrawingConflict: options.resolveDrawingConflict
    });
    const validation = validateHrxPlan(plan, sortStore, drawingStore);
    if (validation.hasErrors) {
        throw new Error(firstPlanError(plan, validation));
    }
    return applyHrxImportPlan(text, plan, sortStore, drawingStore);
}
