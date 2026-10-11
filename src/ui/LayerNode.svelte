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
                aria-label={layer.visible ? 'Hide layer' : 'Show layer'}
                onclick={() => toggleLayerVisibility(layer)}
            >
                <svg class="eye-icon" viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
                    <path
                        d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                        stroke-linejoin="round"
                    />
                    <circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="2" />
                    {#if !layer.visible}
                        <line
                            x1="2"
                            y1="2"
                            x2="22"
                            y2="22"
                            stroke="currentColor"
                            stroke-width="2"
                            stroke-linecap="round"
                        />
                    {/if}
                </svg>
            </button>
            <button
                class="layer-btn focus-btn {ui.focusedLayerId === layer.id ? 'active' : ''}"
                title="Focus on this layer (dims other layers to 50% opacity)"
                onclick={() => toggleLayerFocus(layer.id)}
            >{ui.focusedLayerId === layer.id ? 'Focusing' : 'Focus'}</button>
            <button class="layer-btn" title={`Rename layer '${layer.name}'`} aria-label={`Rename layer '${layer.name}'`} onclick={() => renameLayer(layer)}>
                ✎
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
                aria-label="Duplicate layer"
                onclick={() => duplicateLayer(layer)}
            >⧉</button>
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
