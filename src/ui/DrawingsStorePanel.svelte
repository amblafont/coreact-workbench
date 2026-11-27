<script lang="ts">
    import DrawingNode from './DrawingNode.svelte';
    import ProofEditorModal from './ProofEditorModal.svelte';
    import ExportModal from './ExportModal.svelte';
    import HrxImportModal from './HrxImportModal.svelte';
    import {
        allDrawings,
        ui
    } from './store.svelte.ts';
    import {
        newDrawing,
        importDrawingsFile,
        downloadHrxFile,
        openCodeExport,
        deleteSelectedDrawings,
        setExportSelectionAll,
        getSelectedDrawingNames,
        pushToast
    } from './store.svelte.ts';

    let importInput = $state<HTMLInputElement>();

    let names = $derived(new Set(allDrawings().map(d => d.name)));
    let roots = $derived(allDrawings().filter(d => !d.parentName || !names.has(d.parentName)));
    let collapsed = $derived(ui.drawingsStoreCollapsed);

    function toggleCollapsed(): void {
        ui.drawingsStoreCollapsed = !ui.drawingsStoreCollapsed;
    }

    function onImportFile(event: Event): void {
        const target = event.currentTarget as HTMLInputElement;
        const file = target.files?.[0];
        if (file) {
            importDrawingsFile(file);
        }
        target.value = '';
    }

    function onExportHrx(): void {
        const names = getSelectedDrawingNames();
        if (names.length === 0) {
            pushToast('info', 'Select at least one drawing to export.');
            return;
        }
        downloadHrxFile(names);
    }

    function onCodeExport(): void {
        const names = getSelectedDrawingNames();
        if (names.length === 0) {
            pushToast('info', 'Select at least one drawing to export.');
            return;
        }
        openCodeExport(names);
    }
</script>

<div class="drawings-container">
    <div class="drawings-header">
        <div class="drawings-title-row">
            <button
                class="panel-toggle-btn"
                class:collapsed={collapsed}
                title={collapsed ? 'Expand Drawing Store panel' : 'Collapse Drawing Store panel'}
                aria-label={collapsed ? 'Expand panel' : 'Collapse panel'}
                onclick={toggleCollapsed}
            ></button>
            <h3 class="panel-subtitle">Drawing Store</h3>
        </div>
        {#if !collapsed}
            <div class="drawings-actions">
            <input
                type="checkbox"
                title="Select all drawings for export"
                checked={ui.exportSelection.size === allDrawings().length && allDrawings().length > 0}
                onchange={(e) => setExportSelectionAll((e.currentTarget as HTMLInputElement).checked)}
            />
            <button class="layer-btn new-btn" title="Start a new blank drawing" onclick={newDrawing}>New</button>
            <button class="layer-btn import-btn" title="Import drawings and sorts from a JSON or HRX file" onclick={() => importInput!.click()}>Load</button>
            <button class="layer-btn export-btn" title="Export the checked drawings to an HRX archive" onclick={onExportHrx}>Save</button>
            <button class="layer-btn rocq-btn" title="Show the checked drawings exported as Rocq code" onclick={onCodeExport}>Export Proofs</button>
            <button
                class="layer-btn delete-btn"
                title="Delete the checked drawings"
                onclick={() => deleteSelectedDrawings(getSelectedDrawingNames())}
            >Delete</button>
            <input
                bind:this={importInput}
                type="file"
                accept=".json,.hrx"
                style="display: none;"
                onchange={onImportFile}
            />
            </div>
        {/if}
    </div>

    {#if !collapsed}
    {#if allDrawings().length === 0}
        <div class="empty-msg">No drawings saved yet.</div>
    {:else}
        {#each roots as savedDrawing (savedDrawing.name)}
            <DrawingNode drawing={savedDrawing} />
        {/each}
    {/if}
    {/if}

    <ProofEditorModal />
    <HrxImportModal />

    {#if ui.codeExport}
        <ExportModal />
    {/if}
</div>
