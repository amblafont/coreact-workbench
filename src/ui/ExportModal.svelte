<script lang="ts">
    import { ui, closeCodeExport, copyCodeToClipboard } from './store.svelte.ts';
    import ProverTabs from './ProverTabs.svelte';
    import type { ExportTarget } from './store.svelte.ts';

    let data = $derived(ui.codeExport);
    let activeTab = $state<ExportTarget>(ui.exportTarget);
    let activeCode = $derived(data ? (activeTab === 'abella' ? data.abella : data.rocq) : '');

    function onSelectTab(target: ExportTarget): void {
        activeTab = target;
        ui.exportTarget = target;
    }

    async function onCopy(): Promise<void> {
        if (!data) return;
        await copyCodeToClipboard(activeCode, activeTab, data.ruleCount);
    }

    function onClose(): void {
        closeCodeExport();
    }

    function onKeydown(event: KeyboardEvent): void {
        if (event.key === 'Escape') {
            onClose();
        }
    }

    function onBackdropPointerdown(event: PointerEvent): void {
        if (event.target === event.currentTarget) {
            onClose();
        }
    }
</script>

<div class="modal-backdrop" role="button" tabindex="-1" aria-label="Close" onpointerdown={onBackdropPointerdown}>
    <div class="modal" role="dialog" aria-modal="true" tabindex="-1" aria-label="Exported code" onkeydown={onKeydown}>
        <div class="modal-title">
            {#if data}
                Exported code of {data.names.length} drawing{data.names.length === 1 ? '' : 's'}
                ({data.ruleCount} rule{data.ruleCount === 1 ? '' : 's'})
            {/if}
        </div>
        <ProverTabs active={activeTab} onSelect={onSelectTab} />
        <textarea class="proof-textarea" value={activeCode} rows="18" spellcheck="false" readonly></textarea>
        <div class="modal-actions">
            <button class="layer-btn" title="Close this dialog" onclick={onClose}>Close</button>
            <button class="layer-btn" title="Copy the active tab's code to the clipboard" onclick={onCopy}>Copy to clipboard</button>
        </div>
    </div>
</div>