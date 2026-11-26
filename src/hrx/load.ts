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
}

export interface HrxLoadResult {
    sortsAdded: string[];
    sortsKept: string[];
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

function canonicalEquations(equations: string[]): string[] {
    return equations.map(raw => raw.split('=').map(term => term.trim()).join(' = '));
}

function schemaOf(
    deps: Record<string, string>,
    data: Record<string, AttributeType>,
    equations: string[]
): string {
    return stable({ deps, data, equations: canonicalEquations(equations) });
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
 * workspace, while new ones are registered from the archive. Drawings are
 * merged with the duplicate policy requested by the caller.
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
        sortStore.registerModuleSource(name, imported);
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

    const sortsAdded: string[] = [];
    const sortsKept: string[] = [];
    for (const record of orderedRecords) {
        const body = importedSortSources.get(record.name);
        if (body === undefined) {
            throw new Error(`Consistency Check Failed: HRX archive has no sorts/${record.name}.js section.`);
        }

        const existing = sortStore.getSort(record.name);
        if (existing) {
            if (schemaOf(existing.dependencies, existing.attributes, existing.equations.map(eq => eq.raw)) !==
                schemaOf(record.deps, record.data, record.equations)) {
                throw new Error(
                    `Consistency Check Failed: Sort '${record.name}' already exists with different dependencies, data fields, or equations.`
                );
            }
            sortsKept.push(record.name);
            continue;
        }

        const drawFunction = compileDrawFunction(body, api);
        sortStore.newSort(record.name, record.deps, record.data, drawFunction, undefined, record.equations);
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

    return { sortsAdded, sortsKept, modulesAdded, drawings };
}
