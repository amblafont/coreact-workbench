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
    toggleFilterSolvesGoalMatches
} from './store.svelte.ts';
import { registerDefaultSorts } from '../demo/buildDemo';
import { buildComposableEdgesRule, buildComposableHost } from '../demo/helpers';

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