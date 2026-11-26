import type { AttributeType, DrawingStore, SavedDrawing, SortStore } from '../index.svelte.ts';
import { parseHrx } from './codec';
import {
    buildModuleApi,
    compileDrawFunction,
    parseRequires,
    topologicalOrder
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
        if (!isRecord(item.data) || !isRecord(item.deps)) {
            throw new Error(`Consistency Check Failed: Sort '${item.name}' must have object 'data' and 'deps' fields.`);
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
            data: item.data as Record<string, AttributeType>,
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

/**
 * Load an HRX archive into the existing workspace.
 *
 * Sorts and modules are merged: matching definitions are kept from the
 * workspace, while new ones are registered from the archive. If an archive
 * sort declares fewer equations than the existing sort, the caller is asked
 * whether to keep the stronger existing definition. Drawings are merged with
 * the duplicate policy requested by the caller.
 */
export function loadHrxArchive(
    text: string,
    sortStore: SortStore,
    drawingStore: DrawingStore,
    options: HrxLoadOptions = {}
): HrxLoadResult {
    const archive = parseHrx(text);
    const sections = archive.sections;

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

    const importedSortSources = new Map<string, string>();
    for (const path of relativeSectionPaths(sections, 'sorts/')) {
        const name = path.slice('sorts/'.length, -'.js'.length);
        importedSortSources.set(name, sections.get(path)!);
    }

    const existingModules = sortStore.getAllModuleSources();
    const modules = new Map(existingModules);
    const modulesAdded: string[] = [];
    for (const path of relativeSectionPaths(sections, 'js/')) {
        const name = path.slice('js/'.length, -'.js'.length);
        const source = sections.get(path)!;
        const imported = { source, requires: parseRequires(source) };
        const existing = existingModules.get(name);
        if (existing) {
            if (stable(existing) !== stable(imported)) {
                throw new Error(`Consistency Check Failed: Conflicting HRX module '${name}'.`);
            }
            continue;
        }
        modules.set(name, imported);
        modulesAdded.push(name);
    }

    const moduleRoots = Array.from(modules.keys());
    const api = buildModuleApi(modules, moduleRoots);

    const importedNames = new Set(sortRecords.map(record => record.name));
    const orderedRecords = topologicalOrder(
        importedNames,
        name => sortRecords.find(record => record.name === name)?.deps
            ? Object.values(sortRecords.find(record => record.name === name)!.deps)
            : []
    ).map(name => sortRecords.find(record => record.name === name)!);

    type SortDecision =
        | { record: HrxSortRecord; keepExisting: true }
        | { record: HrxSortRecord; keepExisting: false; drawFunction: (data: any, context: any) => any };

    // Validate everything before mutating the workspace so that declining an
    // equation prompt cannot leave half-imported modules or sorts behind.
    const sortDecisions: SortDecision[] = [];
    const sortsAdded: string[] = [];
    const sortsKept: string[] = [];
    const sortsKeptWithExistingEquations: string[] = [];
    for (const record of orderedRecords) {
        const body = importedSortSources.get(record.name);
        if (body === undefined) {
            throw new Error(`Consistency Check Failed: HRX archive has no sorts/${record.name}.js section.`);
        }

        const existing = sortStore.getSort(record.name);
        if (existing) {
            if (stable(existing.dependencies) !== stable(record.deps) ||
                stable(existing.attributes) !== stable(record.data)) {
                throw new Error(
                    `Consistency Check Failed: Sort '${record.name}' already exists with different dependencies, data fields, or equations.`
                );
            }

            const existingClasses = equationClasses(
                canonicalizePaths(existing.equations.map(equation => equation.paths))
            );
            const importedClasses = equationClasses(parseEquationPaths(record.equations, record.name));
            if (!classesEqual(existingClasses, importedClasses)) {
                if (!classesAreWeaker(importedClasses, existingClasses)) {
                    throw new Error(
                        `Consistency Check Failed: Sort '${record.name}' already exists with different dependencies, data fields, or equations.`
                    );
                }
                const approved = options.resolveSortEquationConflict?.(
                    record.name,
                    existing.equations.map(equation => equation.raw),
                    record.equations
                ) === true;
                if (!approved) {
                    throw new Error(
                        `Import cancelled: sort '${record.name}' declares fewer equations than the existing sort.`
                    );
                }
                sortsKeptWithExistingEquations.push(record.name);
            }
            sortsKept.push(record.name);
            sortDecisions.push({ record, keepExisting: true });
            continue;
        }

        sortDecisions.push({
            record,
            keepExisting: false,
            drawFunction: compileDrawFunction(body, api)
        });
    }

    const committedModules = new Set(modulesAdded);
    for (const name of committedModules) {
        sortStore.registerModuleSource(name, modules.get(name)!);
    }
    for (const decision of sortDecisions) {
        if (decision.keepExisting) continue;
        const { record } = decision;
        const body = importedSortSources.get(record.name)!;
        sortStore.newSort(
            record.name,
            record.deps,
            record.data,
            decision.drawFunction,
            undefined,
            record.equations
        );
        sortStore.setSortSource(record.name, { drawBody: body, requires: parseRequires(body) });
        sortsAdded.push(record.name);
    }

    const resolveConflict = options.resolveDrawingConflict ?? (() => 'keepExisting' as const);
    const importedDrawings = isRecord(drawingPayload) && Array.isArray(drawingPayload.drawings)
        ? drawingPayload.drawings
        : [drawingPayload];

    const drawings: HrxLoadResult['drawings'] = [];
    for (const drawing of importedDrawings) {
        drawings.push(drawingStore.importSavedDrawingWithPolicy(drawing, sortStore, resolveConflict));
    }

    return { sortsAdded, sortsKept, sortsKeptWithExistingEquations, modulesAdded, drawings };
}
