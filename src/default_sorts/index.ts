import type { AttributeType, SortStore } from '../index.svelte.ts';
import type { D3Context } from '../types';
import { buildModuleApi, compileDrawFunction, functionBody, parseRequires } from '../hrx/moduleRuntime';
import metadata from './sorts.json';

import * as Vertex from './Vertex';
import * as Edge from './Edge';
import * as Pullback from './Pullback';
import * as Triangle from './Triangle';
import * as Square from './Square';
import * as isMono from './isMono';
import * as isId from './isId';
import * as EqEdges from './EqEdges';
import { module as geometryModule } from './js/geometry';

type DrawFunction = (data: any, context: D3Context) => D3Context | null;

const drawFunctions: Record<string, DrawFunction> = {
    Vertex: Vertex.draw as DrawFunction,
    Edge: Edge.draw as DrawFunction,
    Pullback: Pullback.draw as DrawFunction,
    Triangle: Triangle.draw as DrawFunction,
    Square: Square.draw as DrawFunction,
    isMono: isMono.draw as DrawFunction,
    isId: isId.draw as DrawFunction,
    EqEdges: EqEdges.draw as DrawFunction
};

/** Register the built-in sorts together with the source used by HRX export. */
export function registerDefaultSorts(sortStore: SortStore): void {
    if (sortStore.getSort('Vertex')) return;

    const geometryBody = functionBody(geometryModule);
    sortStore.registerModuleSource('geometry', {
        source: geometryBody,
        requires: parseRequires(geometryBody)
    });
    const moduleSources = sortStore.getAllModuleSources();
    const api = buildModuleApi(moduleSources, moduleSources.keys());

    const records = metadata as unknown as Array<{
        name: string;
        data: Record<string, unknown>;
        deps: Record<string, string>;
    }>;
    for (const record of records) {
        const draw = drawFunctions[record.name];
        if (!draw) {
            throw new Error(`Consistency Check Failed: No draw function for built-in sort '${record.name}'.`);
        }
        const drawBody = functionBody(draw);
        sortStore.newSort(
            record.name,
            record.deps,
            record.data as Record<string, AttributeType>,
            compileDrawFunction(drawBody, api)
        );
        sortStore.setSortSource(record.name, {
            drawBody,
            requires: parseRequires(drawBody)
        });
    }
}
