import { describe, it, expect } from 'vitest';
import { flushSync } from 'svelte';
import {
    ui,
    getDrawing,
    drawingStore,
    sortStore,
    computeRuleApplications,
    setActiveDrawing,
    toggleFilterInjectiveMatches,
    toggleFilterFlexibleMatches,
    toggleFilterRedundantMatches,
    toggleFilterNoProgressMatches,
    toggleFilterSolvesGoalMatches,
    toggleRuleFilterArtefact,
    clearRuleFilterArtefacts
} from './store.svelte.ts';
import { registerDefaultSorts } from '../demo/buildDemo';
import { buildComposableEdgesRule, buildComposableHost, makeVertex } from '../demo/helpers';

describe('rule filter reactivity (ui.* state)', () => {
    it('recompute the entries $derived when a filter toggles', () => {
        registerDefaultSorts(sortStore);
        drawingStore.clear();
        getDrawing().clear(true);
        const { rule } = buildComposableEdgesRule();
        drawingStore.addDrawing('Rule', rule);
        const { host } = buildComposableHost();
        drawingStore.addDrawing('Host', host);
        setActiveDrawing('Host');

        let entries = $derived(computeRuleApplications());
        const read = () => entries;

        const baseline = read();
        expect(baseline.length).toBeGreaterThan(0);

        toggleFilterInjectiveMatches();
        expect(read()).not.toBe(baseline);

        const afterInjective = read();
        toggleFilterFlexibleMatches();
        expect(read()).not.toBe(afterInjective);

        const afterFlexible = read();
        toggleFilterRedundantMatches();
        expect(read()).not.toBe(afterFlexible);

        const afterRedundant = read();
        toggleFilterNoProgressMatches();
        expect(read()).not.toBe(afterRedundant);

        const afterNoProgress = read();
        toggleFilterSolvesGoalMatches();
        expect(read()).not.toBe(afterNoProgress);
    });

    it('recompute the entries when a required artefact is picked', () => {
        registerDefaultSorts(sortStore);
        drawingStore.clear();
        getDrawing().clear(true);
        ui.filterRedundantMatches = false;
        ui.filterNoProgressMatches = false;
        ui.filterSolvesGoalMatches = false;
        ui.filterInjectiveMatches = true;
        ui.filterFlexibleMatches = false;
        ui.ruleFilterArtefacts.clear();
        const { rule } = buildComposableEdgesRule();
        drawingStore.addDrawing('Rule', rule);
        const { host } = buildComposableHost();
        const unrelated = makeVertex(host, 'unrelated');
        drawingStore.addDrawing('Host', host);
        setActiveDrawing('Host');

        let entries = $derived(computeRuleApplications());
        const read = () => entries;
        expect(read()[0].applications).toHaveLength(1);

        const baseline = read();
        toggleRuleFilterArtefact(unrelated);
        const restricted = read();
        expect(restricted).not.toBe(baseline);
        expect(restricted[0].applications).toHaveLength(0);

        clearRuleFilterArtefacts();
        expect(read()[0].applications).toHaveLength(1);
    });
});

describe('draft preview reactivity (ui.draftArtefact)', () => {
    it('is tracked by an effect the way the canvas redraw reads it', () => {
        ui.draftArtefact = null;
        let seen: string | null = null;
        const readSeen = () => seen;
        const cleanup = $effect.root(() => {
            $effect(() => {
                seen = ui.draftArtefact?.sortName ?? null;
            });
        });
        flushSync();
        expect(readSeen()).toBeNull();

        ui.draftArtefact = { sortName: 'Vertex', dependencies: {}, data: {}, layerId: 'root' };
        flushSync();
        expect(readSeen()).toBe('Vertex');

        ui.draftArtefact = null;
        flushSync();
        expect(readSeen()).toBeNull();
        cleanup();
    });
});