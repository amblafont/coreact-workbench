import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as d3 from 'd3';
import {
    DrawingStore,
    SortStore,
    findFirstOrderRuleApplications,
    findSecondOrderRuleApplications
} from '../index.svelte.ts';

function loadProdExample(): { store: DrawingStore; host: NonNullable<ReturnType<DrawingStore['getDrawing']>> } {
    const sortStore = new SortStore();
    const sortsCode = fs.readFileSync(new URL('../../examples/prod_sorts.js', import.meta.url), 'utf8');
    new Function('sortStore', 'd3', sortsCode)(sortStore, d3);

    const store = new DrawingStore();
    const drawingsJson = fs.readFileSync(new URL('../../examples/prod.json', import.meta.url), 'utf8');
    store.importDrawingsJSON(drawingsJson, sortStore);
    return { store, host: store.getDrawing('ExchProdComp')! };
}

describe('prod example matching', () => {
    it('matches ExchProdComp with the g artefact filter', () => {
        const { store, host } = loadProdExample();
        const drawing = host.drawing;
        const g = drawing.getArtefacts().find(a => a.data.label === 'g')!;
        const options = { injective: true, flexible: false, mustInvolve: [g] };

        const t0 = performance.now();
        const counts: Array<[string, number]> = [];
        for (const entry of store.getAllDrawings()) {
            if (!entry.drawing.isRule) continue;
            const applications = store.checkIsFirstOrder(entry.drawing)
                ? findFirstOrderRuleApplications(entry.drawing, drawing, options, 11)
                : findSecondOrderRuleApplications(entry.drawing, drawing, options, 11);
            counts.push([entry.name, applications.length]);
        }
        const elapsed = performance.now() - t0;

        // The same counts as the unoptimised matcher, but well below its
        // multi-second exhaustive search on this host.
        expect(elapsed).toBeLessThan(2000);
        expect(counts).toEqual([
            ['Assoc', 0],
            ['Comp', 4],
            ['UseProdFact', 0],
            ['UseProdFactUnique', 0],
            ['Id', 0],
            ['UnitL', 0],
            ['UnitR', 0],
            ['IdUniq', 0],
            ['AddIso', 1],
            ['AddIso > inverse (reverse)', 0],
            ['AddTerminal > Existence (reverse)', 0],
            ['AddTerminal > Uniqueness (reverse)', 0],
            ['IdIsIso', 0],
            ['AddTerminal', 0],
            ['1EssUniq', 0],
            ['GenTerm', 0],
            ['AddProd', 0],
            ['ProdEssUniq', 0],
            ['GenProd', 0],
            ['1IsProdUnitR', 0],
            ['1IsProdUnitL', 0],
            ['ProdAssoc', 0],
            ['ProdMorph', 11],
            ['ProdMorphId', 8],
            ['RProdFactId', 0]
        ]);
    });
});
