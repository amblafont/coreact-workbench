<script lang="ts">
    import type { Artefact, SortDefinition } from '../index.svelte.ts';
    import { sortStore, drawing, allArtefacts, dependencyPickingFor, draftArtefact } from './store';
    import { startDraftForSort } from './store';
    import ArtefactNode from './ArtefactNode.svelte';

    let sortDefs: SortDefinition[] = $derived(sortStore.getAllSorts());
    let grouped: Record<string, Artefact[]> = $derived(allArtefacts().reduce((acc, artefact) => {
        if (!acc[artefact.sortName]) acc[artefact.sortName] = [];
        acc[artefact.sortName].push(artefact);
        return acc;
    }, {} as Record<string, Artefact[]>));
    let focusedId: string | null = $derived(drawing.getFocusedLayerId());
    let expectedSortFilter: string | null = $derived(
        $dependencyPickingFor && $draftArtefact && $draftArtefact.sortName !== 'Equality'
            ? sortStore.getSort($draftArtefact.sortName)?.dependencies[$dependencyPickingFor] ?? null
            : null
    );
</script>

{#each sortDefs as sortDef (sortDef.name)}
    {#if !expectedSortFilter || sortDef.name === expectedSortFilter}
        {@const artefacts = grouped[sortDef.name] || []}
        {@const topLevelArtefacts = focusedId ? artefacts.filter(a => a.layerId === focusedId) : artefacts}
        <h3>
            <span>{sortDef.name} ({topLevelArtefacts.length})</span>
            <button class="add-sort-btn" title={`Add new ${sortDef.name}`} onclick={() => startDraftForSort(sortDef)}>+</button>
        </h3>
        {#each topLevelArtefacts as art}
            <ArtefactNode artefact={art} rootNode />
        {/each}
    {/if}
{/each}
