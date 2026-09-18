<script lang="ts">
    import DrawingNode from './DrawingNode.svelte';
    import {
        activeDrawingName,
        allDrawings,
        exportSelection,
        isCurrentDrawingRule,
        rocqRecordingActive,
        pendingProofCount,
        ruleTag
    } from './store.svelte.ts';
    import type { RuleTag } from './store.svelte.ts';
    import {
        saveActiveDrawing,
        duplicateCurrentDrawing,
        newDrawing,
        importDrawingsFile,
        downloadDrawingsJson,
        copyRocqExport,
        deleteSelectedDrawings,
        setCurrentDrawingRule,
        toggleRocqRecording,
        setExportSelectionAll,
        getSelectedDrawingNames,
        pushToast
    } from './store.svelte.ts';

    let importInput: HTMLInputElement;

    let names = $derived(new Set(allDrawings().map(d => d.name)));
    let roots = $derived(allDrawings().filter(d => !d.parentName || !names.has(d.parentName)));
    let tag: RuleTag | null = $derived(ruleTag());

    function onImportFile(event: Event): void {
        const target = event.currentTarget as HTMLInputElement;
        const file = target.files?.[0];
        if (file) {
            importDrawingsFile(file);
        }
        target.value = '';
    }

    function onExportJson(): void {
        const names = getSelectedDrawingNames();
        if (names.length === 0) {
            pushToast('info', 'Select at least one drawing to export.');
            return;
        }
        downloadDrawingsJson(names);
    }

    function onRocqExport(): void {
        const names = getSelectedDrawingNames();
        if (names.length === 0) {
            pushToast('info', 'Select at least one drawing to export.');
            return;
        }
        copyRocqExport(names);
    }
</script>

<div class="drawings-container">
    <div class="drawings-header">
        <h3 class="panel-subtitle">Drawing Store</h3>
        <div class="drawings-actions">
            <input
                type="checkbox"
                title="Select all drawings for export"
                checked={$exportSelection.size === allDrawings().length && allDrawings().length > 0}
                onchange={(e) => setExportSelectionAll((e.currentTarget as HTMLInputElement).checked)}
            />
            <button class="layer-btn new-btn" title="Start a new blank drawing" onclick={newDrawing}>New</button>
            <button class="layer-btn import-btn" title="Import one or more drawings from a JSON file" onclick={() => importInput.click()}>Import</button>
            <button class="layer-btn export-btn" title="Export the checked drawings to a JSON file" onclick={onExportJson}>Export</button>
            <button class="layer-btn rocq-btn" title="Copy the checked drawings to the clipboard as Rocq code" onclick={onRocqExport}>Rocq</button>
            <button
                class="layer-btn rocq-rec-btn"
                title="Start or stop Rocq recording for the active drawing"
                onclick={toggleRocqRecording}
            >
                {$rocqRecordingActive ? (pendingProofCount() > 0 ? `Stop recording (${pendingProofCount()} pending)` : 'Stop recording') : 'Rocq recording'}
            </button>
            <button class="layer-btn save-btn" title="Save current drawing" onclick={saveActiveDrawing}>Save</button>
            <button class="layer-btn dup-btn" title="Duplicate the current drawing under a new name" onclick={duplicateCurrentDrawing}>Dup.</button>
            <button
                class="layer-btn delete-btn"
                title="Delete the checked drawings"
                onclick={() => deleteSelectedDrawings(getSelectedDrawingNames())}
            >Delete</button>
            <input
                bind:this={importInput}
                type="file"
                accept=".json"
                style="display: none;"
                onchange={onImportFile}
            />
        </div>
    </div>

    <div class="current-drawing-banner">
        <span style="color: #555;">
            Editing: <strong style="color: #2c3e50;">{$activeDrawingName ?? 'Unsaved Drawing'}</strong>
        </span>
        <label
            class="rule-checkbox-label"
            title="Explicitly mark the current drawing as a rule (must satisfy rule conditions)"
        >
            <input type="checkbox" checked={isCurrentDrawingRule()} onchange={(e) => setCurrentDrawingRule((e.currentTarget as HTMLInputElement).checked)} />
            Rule
        </label>
        {#if tag}
            {#if tag.kind === 'invalid'}
                <span class="rule-badge rule-badge-invalid" title={tag.reason}>Invalid Rule</span>
            {:else if tag.kind === 'first'}
                <span class="first-order-badge" title="First-order rule: root layer has only one child">First-Order</span>
            {:else}
                <span class="second-order-badge" title="Second-order rule: root layer has several child layers">Second-Order</span>
            {/if}
        {/if}
    </div>

    {#if allDrawings().length === 0}
        <div class="empty-msg">No drawings saved yet.</div>
    {:else}
        {#each roots as savedDrawing (savedDrawing.name)}
            <DrawingNode drawing={savedDrawing} />
        {/each}
    {/if}
</div>
