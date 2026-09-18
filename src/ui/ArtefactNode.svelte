<script lang="ts">
    import type { Artefact } from '../index.svelte.ts';
    import { drawing } from './store';
    import {
        mergeMode,
        mergeFirstArtefact,
        mergeSecondArtefact,
        mergeHoverArtefact,
        inspectedArtefact,
        menuHoverArtefact,
        dependencyPickingFor
    } from './store';
    import {
        getArtefactLabel,
        equalityChildren,
        mergeBaseOpacityFor,
        isProvablyEqualCandidate,
        onArtefactNodeClick,
        removeArtefactNode,
        duplicateArtefactNode,
        moveArtefactUp,
        moveArtefactDown,
        canMoveArtefactUp,
        canMoveArtefactDown
    } from './store';
    import ArtefactNode from './ArtefactNode.svelte';

    let {
        artefact,
        dependencyKey = null,
        parentArtefact = null,
        rootNode = false
    }: {
        artefact: Artefact;
        dependencyKey?: string | null;
        parentArtefact?: Artefact | null;
        rootNode?: boolean;
    } = $props();

    let expanded = $state(false);

    let children = $derived(equalityChildren(artefact));
    let baseLabel = $derived(getArtefactLabel(artefact));
    let equalitySuffix = $derived(artefact.sortName === 'Equality' && children.length > 0 ? ` [${children[0].sortName}]` : '');
    let prefix = $derived(dependencyKey ? `${dependencyKey}: ` : '');
    let layerObj = $derived(drawing.getLayer(artefact.layerId));
    let isLayerVis = $derived(layerObj ? drawing.isLayerVisible(layerObj.id) : true);
    let layerBadgeText = $derived(layerObj ? layerObj.name + (isLayerVis ? '' : ' (hidden)') : artefact.layerId);
    let provablyEqualCandidate = $derived(isProvablyEqualCandidate(artefact));
    let inspectedNode = $derived(
        $inspectedArtefact === artefact
        || ($mergeMode && ($mergeFirstArtefact === artefact || $mergeSecondArtefact === artefact))
    );

    let depEntries = $derived(Object.entries(artefact.dependencies) as [string, Artefact][]);
    let canUp = $derived(rootNode && !$dependencyPickingFor && canMoveArtefactUp(artefact));
    let canDown = $derived(rootNode && !$dependencyPickingFor && canMoveArtefactDown(artefact));

    let nodeOpacity = $derived.by(() => {
        if ($mergeMode) {
            const hoveredSet = $mergeHoverArtefact ? $mergeHoverArtefact.getSelfAndDependencies() : null;
            if (hoveredSet && hoveredSet.has(artefact)) {
                return 1;
            } else if (hoveredSet) {
                return 0.5;
            } else {
                return mergeBaseOpacityFor(artefact);
            }
        } else {
            const target = $menuHoverArtefact ?? $inspectedArtefact;
            if (target) {
                return target.getSelfAndDependencies().has(artefact) ? 1 : 0.5;
            } else {
                return 1;
            }
        }
    });

    function onHeaderMouseEnter(): void {
        if ($mergeMode) {
            mergeHoverArtefact.set(artefact);
        } else {
            menuHoverArtefact.set(artefact);
        }
    }

    function onHeaderMouseLeave(): void {
        if ($mergeMode) {
            mergeHoverArtefact.set(null);
        } else {
            menuHoverArtefact.set(null);
        }
    }

    function onHeaderClick(): void {
        onArtefactNodeClick(artefact);
    }

    function onRemove(): void {
        removeArtefactNode(artefact, parentArtefact);
    }

    function onDuplicate(): void {
        duplicateArtefactNode(artefact);
    }
</script>

<div
    class="tree-node {provablyEqualCandidate ? 'provably-equal' : ''} {inspectedNode ? 'inspected' : ''}"
    class:expanded={expanded}
    class:root-node={rootNode}
    style="opacity: {nodeOpacity};"
>
    <div
        class="node-header"
        role="button"
        tabindex="0"
        onmouseenter={onHeaderMouseEnter}
        onmouseleave={onHeaderMouseLeave}
    >
        <span
            class="toggle-icon"
            role="button"
            tabindex="0"
            aria-label={expanded ? 'Collapse children' : 'Expand children'}
            onclick={(e) => {
                e.stopPropagation();
                expanded = !expanded;
            }}
            onkeydown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    e.stopPropagation();
                    expanded = !expanded;
                }
            }}
        ></span>
        <span
            class="node-label"
            role="button"
            tabindex="0"
            onclick={(e) => {
                e.stopPropagation();
                onHeaderClick();
            }}
            onkeydown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    e.stopPropagation();
                    onHeaderClick();
                }
            }}
        >{prefix}{baseLabel}{equalitySuffix}</span>
        {#if artefact.sortName === 'Equality' || layerBadgeText}
            <span class="layer-badge" style={!isLayerVis ? 'background-color: #f5b7b1; color: #78281f;' : ''}>
                {layerBadgeText}
            </span>
        {/if}
        {#if provablyEqualCandidate}
            <span class="eq-badge" title="Provably equal (via equality artefacts)">≡</span>
        {/if}
        {#if rootNode && !$dependencyPickingFor}
            <span
                class="move-btn"
                class:disabled={!canUp}
                role="button"
                tabindex="0"
                title="Move up"
                aria-label="Move artefact up"
                onclick={(e) => {
                    e.stopPropagation();
                    if (canUp) moveArtefactUp(artefact);
                }}
                onkeydown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        e.stopPropagation();
                        if (canUp) moveArtefactUp(artefact);
                    }
                }}
            >↑</span>
            <span
                class="move-btn"
                class:disabled={!canDown}
                role="button"
                tabindex="0"
                title="Move down"
                aria-label="Move artefact down"
                onclick={(e) => {
                    e.stopPropagation();
                    if (canDown) moveArtefactDown(artefact);
                }}
                onkeydown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        e.stopPropagation();
                        if (canDown) moveArtefactDown(artefact);
                    }
                }}
            >↓</span>
        {/if}
        {#if rootNode && !$dependencyPickingFor && artefact.sortName !== 'Equality'}
            <span
                class="move-btn"
                role="button"
                tabindex="0"
                title="Duplicate artefact"
                aria-label="Duplicate artefact"
                onclick={(e) => {
                    e.stopPropagation();
                    onDuplicate();
                }}
                onkeydown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        e.stopPropagation();
                        onDuplicate();
                    }
                }}
            >⧉</span>
        {/if}
        <span
            class="remove-btn"
            role="button"
            tabindex="0"
            title="Remove artefact"
            aria-label="Remove artefact"
            onclick={(e) => {
                e.stopPropagation();
                onRemove();
            }}
            onkeydown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    e.stopPropagation();
                    onRemove();
                }
            }}
        >×</span>
    </div>

    {#if artefact && artefact.data}
        {#if Object.keys(artefact.dependencies).length > 0}
            <div class="node-children">
                {#each depEntries as [depKey, depArt]}
                    <ArtefactNode artefact={depArt} dependencyKey={depKey} parentArtefact={artefact} />
                {/each}
            </div>
        {/if}
    {/if}
</div>
