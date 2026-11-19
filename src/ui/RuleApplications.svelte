<script lang="ts">
    import type { Artefact, RuleApplication } from '../index.svelte.ts';
    import {
        computeRuleApplications,
        applyRuleAt,
        ui,
        toggleFilterRedundantMatches,
        toggleFilterNoProgressMatches,
        toggleFilterInjectiveMatches,
        toggleFilterFlexibleMatches,
        toggleFilterSolvesGoalMatches,
        toggleAutoApplyEqualityRules,
        solvesGoalFilterApplicable,
        setRuleGroupExpanded,
        getArtefactLabel,
        selectedRuleFilterArtefacts,
        toggleRuleFilterPicking,
        removeRuleFilterArtefact,
        clearRuleFilterArtefacts,
        matchingRuleNames,
        ruleNameMatches,
        commitRuleNameFilter,
        RULE_APPLICATION_GROUP_THRESHOLD,
        type RuleAppEntry
    } from './store.svelte.ts';

    // Typing only filters rule names (cheap). Matching runs for the committed
    // names only, after Compute / Enter, and never on a keystroke.
    const names = $derived(matchingRuleNames(ui.ruleNameFilter));
    const pending = $derived(ui.ruleNameFilter !== ui.computedRuleNameFilter);
    const entries = $derived(computeRuleApplications(name => ruleNameMatches(name, ui.computedRuleNameFilter)));
    const selectedArtefacts = $derived(selectedRuleFilterArtefacts());

    function matchLabels(entry: RuleAppEntry, app: RuleApplication): string[] {
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

    function onApply(entry: RuleAppEntry, index: number): void {
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

    function applicationItemCount(entry: RuleAppEntry): number {
        return entry.truncated ? entry.applicationCount : entry.applications.length;
    }

    function groupCountLabel(entry: RuleAppEntry): string {
        if (entry.truncated) {
            return `more than ${RULE_APPLICATION_GROUP_THRESHOLD} matches`;
        }
        const count = entry.applications.length;
        return `${count} match${count === 1 ? '' : 'es'}`;
    }

    function onGroupToggle(entry: RuleAppEntry, event: Event): void {
        setRuleGroupExpanded(entry.name, (event.currentTarget as HTMLDetailsElement).open);
    }
</script>

{#snippet ruleTitle(entry: RuleAppEntry)}
    {entry.name}
    {#if entry.isFirstOrder}
        <span class="first-order-badge" title="First-order rule: root layer has only one child">1<sup>st</sup>-Order</span>
    {:else}
        <span class="second-order-badge" title="Second-order rule: root layer has several child layers">2<sup>nd</sup>-Order</span>
    {/if}
    {#if entry.isEqualityRule}
        <span class="equality-badge" title="Equality rule: the child layer holds only equality artefacts, so applying it asserts equalities only">Equality</span>
    {/if}
{/snippet}

{#snippet applicationRow(entry: RuleAppEntry, app: RuleApplication, index: number, showName: boolean)}
    {@const labels = matchLabels(entry, app)}
    <div
        role="group"
        class:first-order={entry.isFirstOrder}
        class:second-order={!entry.isFirstOrder}
        class="rule-app-row"
        onmouseenter={() => onHover(app.hostArtefacts)}
        onmouseleave={onLeave}
    >
        {#if showName}
            <div class="rule-app-name">{@render ruleTitle(entry)}</div>
        {/if}
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
{/snippet}

<div class="rules-filter">
    <div class="rule-name-filter">
        <label for="rule-name-filter-input">Rule name filter</label>
        <input
            id="rule-name-filter-input"
            type="text"
            bind:value={ui.ruleNameFilter}
            placeholder="* for all"
            onkeydown={(event) => {
                if (event.key === 'Enter') {
                    event.preventDefault();
                    commitRuleNameFilter();
                }
            }}
        />
        {#if pending}
            <div class="rule-filter-hint">
                Showing names only — press Enter to calculate applications.
            </div>
        {/if}
    </div>
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
    <div class="rule-artefact-filter">
        <button
            type="button"
            class="pick-dep-btn {ui.ruleFilterPicking ? 'active' : ''}"
            title="Pick artefacts in the left tree. Only matches involving every picked artefact are shown."
            onclick={toggleRuleFilterPicking}
        >
            {#if ui.ruleFilterPicking}
                Click artefacts in tree...
            {:else if selectedArtefacts.length > 0}
                + Pick Artefact ({selectedArtefacts.length})
            {:else}
                + Pick Artefact
            {/if}
        </button>
        {#if ui.ruleFilterPicking}
            <div class="rule-filter-hint">Click artefacts in the tree to add or remove them.</div>
        {/if}
        {#if selectedArtefacts.length > 0}
            <div class="rule-filter-artefacts">
                {#each selectedArtefacts as art (art.id)}
                    <div class="rule-filter-artefact">
                        <span>• {getArtefactLabel(art)} ({art.sortName})</span>
                        <button
                            type="button"
                            title={`Remove ${getArtefactLabel(art)}`}
                            onclick={() => removeRuleFilterArtefact(art)}
                        >×</button>
                    </div>
                {/each}
                <button type="button" class="rule-filter-clear" onclick={clearRuleFilterArtefacts}>Clear</button>
            </div>
        {/if}
    </div>
</div>

{#snippet hiddenNotes(entry: RuleAppEntry)}
    {#if !entry.truncated}
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
    {/if}
{/snippet}

{#if pending}
    {#if names.length === 0}
        <div class="rule-name-empty">No rules match this filter.</div>
    {:else}
        <ul class="rule-name-list">
            {#each names as name (name)}
                <li>{name}</li>
            {/each}
        </ul>
    {/if}
{:else}
    {#each entries as entry (entry.name)}
        {@const itemCount = applicationItemCount(entry)}
        {#if itemCount === 1}
            {@render applicationRow(entry, entry.applications[0], 0, true)}
            {@render hiddenNotes(entry)}
        {:else if itemCount > 1}
            <details
                class="rule-app-group"
                class:first-order={entry.isFirstOrder}
                class:second-order={!entry.isFirstOrder}
                open={ui.expandedRuleGroups.has(entry.name)}
                ontoggle={(event) => onGroupToggle(entry, event)}
            >
                <summary class="rule-app-group-summary">
                    <span class="rule-app-name">{@render ruleTitle(entry)}</span>
                    <span class="rule-app-group-count">{groupCountLabel(entry)}</span>
                </summary>
                {#if !entry.truncated}
                    {#each entry.applications as app, index (entry.name + '-' + index)}
                        {@render applicationRow(entry, app, index, false)}
                    {/each}
                {/if}
                {@render hiddenNotes(entry)}
            </details>
        {/if}
    {/each}
{/if}
