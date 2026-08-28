<script lang="ts">
    import type { Artefact, SortDefinition } from '../index';
    import { sortStore, drawing, allArtefacts, dependencyPickingFor, draftArtefact } from './store';
    import { startDraftForSort } from './store';
    import ArtefactNode from './ArtefactNode.svelte';

    let sortDefs: SortDefinition[] = [];
    let grouped: Record<string, Artefact[]> = {};
    let focusedId: string | null = null;
    let expectedSortFilter: string | null = null;

    $: {
        $allArtefacts;
        $dependencyPickingFor;
        $draftArtefact;
        sortDefs = sortStore.getAllSorts();
        focusedId = drawing.getFocusedLayerId();
        grouped = $allArtefacts.reduce((acc, artefact) => {
            if (!acc[artefact.sortName]) acc[artefact.sortName] = [];
            acc[artefact.sortName].push(artefact);
            return acc;
        }, {} as Record<string, Artefact[]>);
        if ($dependencyPickingFor && $draftArtefact && $draftArtefact.sortName !== 'Equality') {
            const sortDef = sortStore.getSort($draftArtefact.sortName);
            expectedSortFilter = sortDef?.dependencies[$dependencyPickingFor] ?? null;
        } else {
            expectedSortFilter = null;
        }
    }
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
