<script lang="ts">
    import type { Artefact } from '../index.svelte.ts';
    import { computeRuleMatches, applyRuleFilters, applyRuleAt, ui, toggleFilterRedundantMatches, toggleFilterNoProgressMatches, toggleFilterInjectiveMatches, toggleFilterFlexibleMatches, toggleFilterSolvesGoalMatches, toggleAutoApplyEqualityRules, solvesGoalFilterApplicable } from './store.svelte.ts';

    const matches = $derived(computeRuleMatches());
    const entries = $derived(applyRuleFilters(matches));

    function matchLabels(entry: (typeof entries)[number], app: (typeof entry.applications)[number]): string[] {
        const ruleDrawing = entry.drawing;
        const ruleRootId = ruleDrawing.getAllLayers().find(l => l.parentId === null)?.id;
        const patternArts = ruleRootId
            ? ruleDrawing.getArtefacts().filter(a => a.sortName !== 'Equality' && a.layerId === ruleRootId)
            : ruleDrawing.getArtefacts().filter(a => a.sortName !== 'Equality');
        const dependedOn = new Set<Artefact>();
        for (const a of patternArts) {
            for (const dep of Object.values(a.dependencies)) {
                if (typeof dep !== 'boolean') {
                    dependedOn.add(dep);
                }
            }
        }
        const topLevel = patternArts.filter(a => !dependedOn.has(a));
        const matchArtefacts = topLevel.length > 0 ? topLevel : patternArts;
        const labels: string[] = [];
        for (const a of matchArtefacts) {
            const img = app.matchedArtefacts.get(a);
            if (img) {
                labels.push(img.data.label || img.sortName);
            }
        }
        return labels;
    }

    function onApply(entry: (typeof entries)[number], index: number): void {
        ui.ruleHoverArtefacts = null;
        applyRuleAt(entry.name, index);
    }

    function onHover(activeSet: Set<Artefact>): void {
        if (ui.mergeMode) return;
        ui.ruleHoverArtefacts = activeSet && activeSet.size > 0 ? activeSet : null;
    }

    function onLeave(): void {
        ui.ruleHoverArtefacts = null;
    }
</script>

<div class="rules-filter">
    <label class="rule-checkbox-label">
        <input type="checkbox" checked={ui.filterRedundantMatches} onchange={toggleFilterRedundantMatches} />
        Filter redundant matches
    </label>
    <label class="rule-checkbox-label">
        <input type="checkbox" checked={ui.filterNoProgressMatches} onchange={toggleFilterNoProgressMatches} />
        Filter no-progress matches
    </label>
    <label class="rule-checkbox-label">
        <input type="checkbox" checked={ui.filterInjectiveMatches} onchange={toggleFilterInjectiveMatches} />
        Injective match
    </label>
    <label class="rule-checkbox-label">
        <input type="checkbox" checked={ui.filterFlexibleMatches} onchange={toggleFilterFlexibleMatches} />
        Flexible match
    </label>
    <label class="rule-checkbox-label" class:disabled={!solvesGoalFilterApplicable()} title={solvesGoalFilterApplicable() ? 'Only show matchings whose conclusion would make the child layer provable' : 'Requires a drawing with exactly one root and one child layer'}>
        <input type="checkbox" checked={ui.filterSolvesGoalMatches} disabled={!solvesGoalFilterApplicable()} onchange={toggleFilterSolvesGoalMatches} />
        Solves the goal
    </label>
    <label class="rule-checkbox-label" title="Apply every matching equality rule (a first-order rule whose child layer contains only equality artefacts) as soon as this is checked, and after each application of any rule. Auto-apply matches without injectivity and up to provable equality, whatever the checkboxes above say; those only shape this list.">
        <input type="checkbox" checked={ui.autoApplyEqualityRules} onchange={toggleAutoApplyEqualityRules} />
        Auto-apply equality rules
    </label>
</div>

{#each entries as entry (entry.name)}
    {#each entry.applications as app, index (entry.name + '-' + index)}
        {@const labels = matchLabels(entry, app)}
        <div
            role="group"
            class:first-order={entry.isFirstOrder}
            class:second-order={!entry.isFirstOrder}
            class="rule-app-row"
            onmouseenter={() => onHover(app.hostArtefacts)}
            onmouseleave={onLeave}
        >
            <div class="rule-app-name">
                {entry.name}
                {#if entry.isFirstOrder}
                    <span class="first-order-badge" title="First-order rule: root layer has only one child">1<sup>st</sup>-Order</span>
                {:else}
                    <span class="second-order-badge" title="Second-order rule: root layer has several child layers">2<sup>nd</sup>-Order</span>
                {/if}
                {#if entry.isEqualityRule}
                    <span class="equality-badge" title="Equality rule: the child layer holds only equality artefacts, so applying it asserts equalities only">Equality</span>
                {/if}
            </div>
            <div class="rule-app-match">{labels.length > 0 ? labels.join(', ') : '(no labelled artefacts)'}</div>
            <button
                class="apply-btn"
                title={entry.isFirstOrder ? 'Apply this first-order rule to the matched artefacts' : 'Apply this second-order rule to the matched artefacts'}
                onclick={(e) => {
                    e.stopPropagation();
                    onApply(entry, index);
                }}
            >Apply</button>
        </div>
    {/each}
    {#if entry.hiddenRedundant > 0}
        <div class="rule-app-hidden-note">
            {entry.hiddenRedundant} redundant match{entry.hiddenRedundant === 1 ? '' : 'es'} hidden
        </div>
    {/if}
    {#if entry.hiddenNoProgress > 0}
        <div class="rule-app-hidden-note">
            {entry.hiddenNoProgress} no-progress match{entry.hiddenNoProgress === 1 ? '' : 'es'} hidden
        </div>
    {/if}
    {#if entry.hiddenSolvesGoal > 0}
        <div class="rule-app-hidden-note">
            {entry.hiddenSolvesGoal} match{entry.hiddenSolvesGoal === 1 ? '' : 'es'} not solving the goal hidden
        </div>
    {/if}
{/each}
