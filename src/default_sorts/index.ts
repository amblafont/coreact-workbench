import type { AttributeType, SortStore } from '../index.svelte.ts';
import { buildModuleApi, compileDrawFunction, parseRequires } from '../hrx/moduleRuntime';
import metadata from './sorts.json';

// The JS bodies are generated from the TypeScript drawing functions by the
// drawBodies Vite plugin. Deriving them with fn.toString() at runtime breaks in
// production builds, where the bundler renames `data`/`context`.
import geometryBody from 'virtual:draw-body/geometry';
import vertexBody from 'virtual:draw-body/Vertex';
import edgeBody from 'virtual:draw-body/Edge';
import pullbackBody from 'virtual:draw-body/Pullback';
import triangleBody from 'virtual:draw-body/Triangle';
import squareBody from 'virtual:draw-body/Square';
import isMonoBody from 'virtual:draw-body/isMono';
import isIdBody from 'virtual:draw-body/isId';
import eqEdgesBody from 'virtual:draw-body/EqEdges';

// HRX section bodies are trimmed when parsed, so the generated bodies receive
// the same treatment as the old functionBody() sources to avoid false conflicts.
const body = (raw: string): string => raw.trim();

const geometrySource = body(geometryBody);
const drawBodies: Record<string, string> = {
    Vertex: body(vertexBody),
    Edge: body(edgeBody),
    Pullback: body(pullbackBody),
    Triangle: body(triangleBody),
    Square: body(squareBody),
    isMono: body(isMonoBody),
    isId: body(isIdBody),
    EqEdges: body(eqEdgesBody)
};

/** Register the built-in sorts together with the source used by HRX export. */
export function registerDefaultSorts(sortStore: SortStore): void {
    if (sortStore.getSort('Vertex')) return;

    sortStore.registerModuleSource('geometry', {
        source: geometrySource,
        requires: parseRequires(geometrySource)
    });
    const moduleSources = sortStore.getAllModuleSources();
    const api = buildModuleApi(moduleSources, moduleSources.keys());

    const records = metadata as unknown as Array<{
        name: string;
        data: Record<string, unknown>;
        deps: Record<string, string>;
        equations?: string[];
    }>;
    for (const record of records) {
        const drawBody = drawBodies[record.name];
        if (!drawBody) {
            throw new Error(`Consistency Check Failed: No draw body for built-in sort '${record.name}'.`);
        }
        sortStore.newSort(
            record.name,
            record.deps,
            record.data as Record<string, AttributeType>,
            compileDrawFunction(drawBody, api),
            undefined,
            record.equations
        );
        sortStore.setSortSource(record.name, {
            drawBody,
            requires: parseRequires(drawBody)
        });
    }
}
