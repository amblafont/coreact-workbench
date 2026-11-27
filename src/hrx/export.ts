import type { DrawingStore, SortStore } from '../index.svelte.ts';
import { serializeHrx } from './codec';
import { collectModuleClosure } from './moduleRuntime';

/**
 * Export the selected drawings together with only the sorts they need.
 *
 * A sort is included if an artefact in one of the selected drawings uses it or
 * if it is a transitive dependency of such a sort. Helper modules are included
 * transitively through `//!Require` directives.
 */
export function exportHrx(names: string[], sortStore: SortStore, drawingStore: DrawingStore): string {
    const drawingsJson = drawingStore.exportDrawingsJSON(names);
    const parsed = JSON.parse(drawingsJson) as { drawings: Array<{ artefacts: Array<{ sortName: string }> }> };

    const neededSorts = new Set<string>();
    const visitSort = (name: string): void => {
        if (name === 'Equality' || neededSorts.has(name)) return;
        const def = sortStore.getSort(name);
        if (!def) {
            throw new Error(`Consistency Check Failed: Cannot export unknown sort '${name}'.`);
        }
        neededSorts.add(name);
        for (const depSort of Object.values(def.dependencies)) {
            visitSort(depSort);
        }
    };
    for (const drawing of parsed.drawings) {
        for (const artefact of drawing.artefacts) {
            visitSort(artefact.sortName);
        }
    }

    const sortNames = sortStore.getSortNames().filter(name => neededSorts.has(name));
    const sortRecords: Array<{ name: string; data: unknown; deps: Record<string, string>; equations: string[] }> = [];
    const sortBodies = new Map<string, string>();

    for (const name of sortNames) {
        const def = sortStore.getSort(name)!;
        const source = sortStore.getSortSource(name);
        sortRecords.push({
            name,
            data: def.attributes,
            deps: def.dependencies,
            equations: def.equations.map(equation => equation.raw)
        });
        // A sort declared without a drawing JS section stays without one.
        if (source) {
            sortBodies.set(name, `${source.drawBody.replace(/\s+$/, '')}\n`);
        }
    }

    const sections = new Map<string, string>();
    sections.set('sorts.json', `${JSON.stringify(sortRecords, null, 2)}\n`);

    for (const [name, body] of sortBodies) {
        sections.set(`sorts/${name}.js`, body);
    }

    const moduleSources = sortStore.getAllModuleSources();
    const moduleRoots = new Set<string>();
    for (const name of sortBodies.keys()) {
        for (const moduleName of sortStore.getSortSource(name)!.requires) {
            moduleRoots.add(moduleName);
        }
    }
    const moduleNames = collectModuleClosure(moduleSources, moduleRoots);
    for (const name of moduleNames) {
        const module = moduleSources.get(name)!;
        sections.set(`js/${name}.js`, `${module.source.replace(/\s+$/, '')}\n`);
    }

    sections.set('drawings.json', `${drawingsJson}\n`);

    return serializeHrx(sections);
}
