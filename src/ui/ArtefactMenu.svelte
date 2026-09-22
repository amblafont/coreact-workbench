<script lang="ts">
    import type { Artefact, SortDefinition } from '../index.svelte.ts';
    import { sortStore, getDrawing, allArtefacts, ui, equalityChildren } from './store.svelte.ts';
    import { startDraftForSort } from './store.svelte.ts';
    import ArtefactNode from './ArtefactNode.svelte';

    let sortDefs: SortDefinition[] = $derived(sortStore.getAllSorts());
    let grouped: Record<string, Artefact[]> = $derived(allArtefacts().reduce((acc, artefact) => {
        if (!acc[artefact.sortName]) acc[artefact.sortName] = [];
        acc[artefact.sortName].push(artefact);
        return acc;
    }, {} as Record<string, Artefact[]>));
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
</script>

{#each sortDefs as sortDef (sortDef.name)}
    {#if (!expectedSortFilter && !extendSortFilter)
        || (expectedSortFilter && sortDef.name === expectedSortFilter)
        || (extendSortFilter && (sortDef.name === extendSortFilter || sortDef.name === 'Equality'))}
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
