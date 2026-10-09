<script lang="ts">
    import type { Layer } from '../index.svelte.ts';
    import { getDrawing, allLayers, ui } from './store.svelte.ts';
    import {
        toggleLayerVisibility,
        toggleLayerFocus,
        setLayerColor,
        toggleLayerColorEnabled,
        addChildLayer,
        duplicateLayer,
        renameLayer,
        deleteLayer
    } from './store.svelte.ts';
    import LayerNode from './LayerNode.svelte';

    let { layer }: { layer: Layer } = $props();

    let childLayers = $derived(allLayers().filter(l => l.parentId === layer.id));
    let isEffectivelyVisible = $derived(getDrawing().isLayerVisible(layer.id));
</script>

<div class="layer-item {layer.parentId === null ? 'root-layer' : ''}">
    <div
        class="layer-row {ui.focusedLayerId === layer.id ? 'focused' : ''} {!isEffectivelyVisible ? 'layer-hidden' : ''}"
    >
        <div class="layer-row-header">
            <span class="layer-title" title="ID: {layer.id}{!isEffectivelyVisible ? ' (hidden)' : ''}">
                {layer.name}
            </span>
        </div>
        <div class="layer-row-actions">
            <button
                class="layer-btn hide-btn {!layer.visible ? 'active' : ''}"
                title={layer.visible
                    ? (isEffectivelyVisible ? 'Hide this layer on canvas' : 'Hide layer (hidden by parent)')
                    : 'Show this layer on canvas'}
                onclick={() => toggleLayerVisibility(layer)}
            >{layer.visible ? 'Hide' : 'Show'}</button>
            <button
                class="layer-btn focus-btn {ui.focusedLayerId === layer.id ? 'active' : ''}"
                title="Focus on this layer (dims other layers to 50% opacity)"
                onclick={() => toggleLayerFocus(layer.id)}
            >{ui.focusedLayerId === layer.id ? 'Focusing' : 'Focus'}</button>
            <button class="layer-btn" title={`Rename layer '${layer.name}'`} onclick={() => renameLayer(layer)}>
                Rename
            </button>
            <input
                type="checkbox"
                checked={layer.colorEnabled}
                title="Toggle partial layer color"
                onchange={(e) => toggleLayerColorEnabled(layer, e.currentTarget.checked)}
            />
            <input
                type="color"
                class="layer-color-input"
                value={layer.color}
                title="Choose layer color"
                onchange={(e) => setLayerColor(layer, e.currentTarget.value)}
            />
            <button class="layer-btn" title={`Add a child layer above '${layer.name}'`} onclick={() => addChildLayer(layer)}>
                + Child
            </button>
            <button
                class="layer-btn"
                title={`Duplicate '${layer.name}' as a new sibling layer, together with all its child layers and artefacts`}
                onclick={() => duplicateLayer(layer)}
            >Dup</button>
            <button
                class="layer-btn"
                style="color: #e74c3c;"
                title="Delete layer and all its child layers & artefacts"
                onclick={() => deleteLayer(layer)}
            >×</button>
        </div>
    </div>

    {#if childLayers.length > 0}
        <div class="layer-children">
            {#each childLayers as child}
                <LayerNode layer={child} />
            {/each}
        </div>
    {/if}
</div>
