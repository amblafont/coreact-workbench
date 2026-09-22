<script lang="ts">
    import { onMount } from 'svelte';
    import Canvas from './Canvas.svelte';
    import SplitHandle from './SplitHandle.svelte';
    import LayersTree from './LayersTree.svelte';
    import ArtefactMenu from './ArtefactMenu.svelte';
    import DrawingsStorePanel from './DrawingsStorePanel.svelte';
    import Inspector from './Inspector.svelte';
    import RuleApplications from './RuleApplications.svelte';
    import Toasts from './Toasts.svelte';
    import {
        loadSortScript,
        clearAll,
        ui,
        startMergeMode,
        cancelMergeMode,
        applyPersistedPanelWidths,
        persistPanelWidths
    } from './store.svelte.ts';

    const LEFT_MIN = 180;
    const LEFT_MAX = 480;
    const RIGHT_MIN = 180;
    const RIGHT_MAX = 640;

    let scriptUpload: HTMLInputElement;

    onMount(() => {
        applyPersistedPanelWidths();
    });

    $effect(() => {
        void ui.leftPanelWidth;
        void ui.rightPanelWidth;
        persistPanelWidths();
    });

    function onLoadScript(): void {
        scriptUpload.click();
    }

    function onScriptChange(event: Event): void {
        const target = event.currentTarget as HTMLInputElement;
        const file = target.files?.[0];
        if (file) {
            loadSortScript(file);
        }
        target.value = '';
    }

    function onMergeClick(): void {
        if (ui.mergeMode) {
            cancelMergeMode();
        } else {
            startMergeMode(ui.inspectedArtefact);
        }
    }
</script>

<div id="app">
    <div id="menu" style:width={`${ui.leftPanelWidth}px`}>
        <div class="menu-header">
            <h2>Layers & Artefacts</h2>
            <div class="menu-header-actions">
                <button
                    class="btn"
                    id="load-script-btn"
                    title="Load JS script to define sorts"
                    onclick={onLoadScript}
                >Load Sorts</button>
                <button
                    class="btn btn-cancel"
                    id="clear-btn"
                    title="Clear all artefacts and layers"
                    onclick={() => clearAll()}
                >Clear All</button>
                <input bind:this={scriptUpload} type="file" id="script-upload" accept=".js" style="display: none;" onchange={onScriptChange} />
            </div>
        </div>

        <DrawingsStorePanel />

        <LayersTree />

        <div class="artefacts-header">
            <h3 class="panel-subtitle">Artefacts</h3>
            <button
                class="layer-btn merge-btn"
                id="merge-artefacts-btn"
                title="Merge two artefacts with identical dependencies"
                onclick={onMergeClick}
            >Merge</button>
        </div>
        <ArtefactMenu />
    </div>

    <SplitHandle
        min={LEFT_MIN}
        max={LEFT_MAX}
        getStartWidth={() => ui.leftPanelWidth}
        onWidth={(w) => { ui.leftPanelWidth = w; }}
    />

    <div id="canvas-column">
        <Canvas />
    </div>

    <SplitHandle
        min={RIGHT_MIN}
        max={RIGHT_MAX}
        reverse
        getStartWidth={() => ui.rightPanelWidth}
        onWidth={(w) => { ui.rightPanelWidth = w; }}
    />

    <div id="right-panel" style:width={`${ui.rightPanelWidth}px`}>
        <div id="rules-panel">
            <div class="rules-header">
                <button
                    class="panel-toggle-btn"
                    class:collapsed={ui.rulesPanelCollapsed}
                    title={ui.rulesPanelCollapsed ? 'Expand Applicable Rules panel' : 'Collapse Applicable Rules panel'}
                    aria-label={ui.rulesPanelCollapsed ? 'Expand panel' : 'Collapse panel'}
                    onclick={() => { ui.rulesPanelCollapsed = !ui.rulesPanelCollapsed; }}
                ></button>
                <h2>Applicable Rules</h2>
            </div>
            {#if !ui.rulesPanelCollapsed}
                <div id="rules-content">
                    <RuleApplications />
                </div>
            {/if}
        </div>

        <div id="inspector">
            <h2>Inspector</h2>
            <Inspector />
        </div>
    </div>

    <Toasts />
</div>
