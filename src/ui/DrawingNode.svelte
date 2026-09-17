<script lang="ts">
    import type { SavedDrawing } from '../index';
    import {
        activeDrawingName,
        allDrawings,
        exportSelection,
        recordedStatementByDrawing
    } from './store';
    import {
        loadDrawingByName,
        renameDrawingName,
        markDrawingAsRule,
        deleteSelectedDrawings,
        generateReverseRulesFor,
        toggleExportSelection
    } from './store';
    import DrawingNode from './DrawingNode.svelte';

    export let drawing: SavedDrawing;
    export let isChild = false;

    $: isActive = drawing.name === $activeDrawingName;
    $: children = $allDrawings.filter(d => d.parentName === drawing.name && d.name !== drawing.name);
    $: recStatus = $recordedStatementByDrawing.get(drawing.name);

    function onRename(saved: SavedDrawing): void {
        const newName = prompt(`Enter new name for drawing '${saved.name}':`, saved.name);
        if (!newName || !newName.trim() || newName.trim() === saved.name) return;
        renameDrawingName(saved.name, newName.trim());
    }

    function onToggleRule(saved: SavedDrawing): void {
        markDrawingAsRule(saved.name, !saved.isRule);
    }

    function onDelete(saved: SavedDrawing): void {
        deleteSelectedDrawings([saved.name]);
    }

    function onGenerateReverseRules(saved: SavedDrawing): void {
        generateReverseRulesFor(saved.name);
    }
</script>

<div
    class:active={isActive}
    class:proved={drawing.proved}
    class:first-order={!isChild && drawing.isFirstOrder}
    class:drawing-child-row={isChild}
    class="drawing-row"
>
    <div class="drawing-row-header">
        <input
            type="checkbox"
            class="export-checkbox"
            title="Include '{drawing.name}' in the next export"
            checked={$exportSelection.has(drawing.name)}
            onchange={() => toggleExportSelection(drawing.name)}
        />
        <span
            class="drawing-title"
            title="Drawing: {drawing.name} ({drawing.layers.length} layers, {drawing.artefacts.length} artefacts){drawing.isRule ? (drawing.isFirstOrder ? ' [First-Order Rule]' : ' [Rule]') : ''}{drawing.proved ? ' [Proved]' : ''}"
        >{drawing.name}</span>
        {#if isActive}
            <span class="active-badge" title="Currently active on canvas">Editing</span>
        {/if}
        {#if drawing.proved}
            <span class="proved-badge" title="First-order statement whose child layer has been proved in the root layer">Proved</span>
        {/if}
        {#if recStatus}
            {#if recStatus.isMain}
                <span class="rec-badge rec-main" title="Main statement being recorded">Recording</span>
            {:else if recStatus.proved}
                <span class="rec-badge rec-proved" title="Subgoal proved in the current recording">Proved in recording</span>
            {:else}
                <span class="rec-badge rec-pending" title="Subgoal that still needs a proof in the current recording">Pending proof</span>
            {/if}
        {/if}
        {#if drawing.isRule}
            {#if drawing.isFirstOrder}
                <span class="first-order-badge" title="First-order rule: root layer has only one child">First-Order</span>
            {:else if !isChild}
                <span class="second-order-badge" title="Second-order rule: root layer has several child layers">Second-Order</span>
            {/if}
        {/if}
    </div>
    <div class="drawing-row-actions">
        <button class="layer-btn" title="Load drawing '{drawing.name}' to edit further" onclick={() => loadDrawingByName(drawing.name)}>Load</button>
        <button class="layer-btn" title="Rename drawing '{drawing.name}'" onclick={() => onRename(drawing)}>Rename</button>
        {#if drawing.isRule && !drawing.isFirstOrder && !isChild}
            <button class="layer-btn gen-reverse-btn" title="Generate a first-order reverse rule for each premise layer of this second-order rule" onclick={() => onGenerateReverseRules(drawing)}>Gen Reverse</button>
        {/if}
        <button class="layer-btn" title={drawing.isRule ? 'Remove the explicit rule marking from this drawing' : 'Explicitly mark this drawing as a rule (must satisfy rule conditions)'} onclick={() => onToggleRule(drawing)}>
            {drawing.isRule ? 'Unmark Rule' : 'Mark Rule'}
        </button>
        <button class="layer-btn row-delete-btn" title="Delete drawing '{drawing.name}'" onclick={() => onDelete(drawing)}>×</button>
    </div>
    {#if children.length > 0}
        <div class="drawing-children">
            {#each children as child (child.name)}
                <DrawingNode drawing={child} isChild />
            {/each}
        </div>
    {/if}
</div>