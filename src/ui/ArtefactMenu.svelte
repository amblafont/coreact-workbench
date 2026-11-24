<script lang="ts">
    import type { Artefact, SortDefinition } from '../index.svelte.ts';
    import { sortStore, getDrawing, allArtefacts, ui, equalityChildren, sortFilterMatches, isSortConstructible } from './store.svelte.ts';
    import { startDraftForSort } from './store.svelte.ts';
    import ArtefactNode from './ArtefactNode.svelte';

    let sortDefs: SortDefinition[] = $derived(sortStore.getAllSorts());
    let grouped: Record<string, Artefact[]> = $derived(allArtefacts().reduce((acc, artefact) => {
        if (!acc[artefact.sortName]) acc[artefact.sortName] = [];
        acc[artefact.sortName].push(artefact);
        return acc;
    }, {} as Record<string, Artefact[]>));
    let presentSorts = $derived(new Set(
        Object.entries(grouped).filter(([, artefacts]) => artefacts.length > 0).map(([name]) => name)
    ));
    let focusedId: string | null = $derived(getDrawing().getFocusedLayerId());
    let expectedSortFilter: string | null = $derived(
        ui.dependencyPickingFor && ui.draftArtefact && ui.draftArtefact.sortName !== 'Equality'
            ? sortStore.getSort(ui.draftArtefact.sortName)?.dependencies[ui.dependencyPickingFor] ?? null
            : null
    );
    let equalityExtend = $derived(ui.equalityExtendTarget);
    let extendSortFilter: string | null = $derived(
        equalityExtend ? (equalityChildren(equalityExtend)[0]?.sortName ?? null) : null
    );

    // Picking a dependency or extending an equality already restricts the
    // visible sorts; the panel filters do not apply in those modes so they can
    // never hide the sort that must be picked.
    function isSortVisible(sortDef: SortDefinition): boolean {
        if (expectedSortFilter && sortDef.name === expectedSortFilter) return true;
        if (extendSortFilter && (sortDef.name === extendSortFilter || sortDef.name === 'Equality')) return true;
        if (expectedSortFilter || extendSortFilter) return false;
        const artefacts = grouped[sortDef.name] ?? [];
        if (!sortFilterMatches(sortDef.name, ui.artefactSortFilter, artefacts.length > 0)) return false;
        if (ui.constructibleSortsOnly && !isSortConstructible(sortDef, presentSorts)) return false;
        return true;
    }
</script>

<div class="sort-filter">
    <label for="artefact-sort-filter-input">Sort filter</label>
    <input
        id="artefact-sort-filter-input"
        type="text"
        bind:value={ui.artefactSortFilter}
        placeholder="* for all"
    />
    <div class="sort-filter-hint">Empty: sorts in this drawing</div>
    <label
        class="sort-filter-checkbox"
        title="Only show sorts whose dependencies already have an artefact in this drawing"
    >
        <input type="checkbox" bind:checked={ui.constructibleSortsOnly} />
        Constructible only
    </label>
</div>

{#each sortDefs as sortDef (sortDef.name)}
    {#if isSortVisible(sortDef)}
        {@const artefacts = grouped[sortDef.name] || []}
        {@const topLevelArtefacts = focusedId
            ? artefacts.filter(a => a.layerId === focusedId)
            : artefacts}
        {@const shownArtefacts = equalityExtend && sortDef.name === 'Equality'
            ? artefacts.filter(a => a === equalityExtend)
            : topLevelArtefacts}
        <h3>
            <span>{sortDef.name} ({shownArtefacts.length})</span>
            <button class="add-sort-btn" title={`Add new ${sortDef.name}`} onclick={() => startDraftForSort(sortDef)}>+</button>
        </h3>
        {#each shownArtefacts as art}
            <ArtefactNode artefact={art} rootNode />
        {/each}
    {/if}
{/each}
