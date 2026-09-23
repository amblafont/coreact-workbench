<script lang="ts">
    import { ui, drawingStore, closeProofEditor, updateDrawingRocqProof } from './store.svelte.ts';

    let name = $derived(ui.proofEditorName);
    let entry = $derived(name ? drawingStore.getDrawing(name) : undefined);
    let draft = $state('');
    let ta = $state<HTMLTextAreaElement | undefined>(undefined);

    $effect(() => {
        const current = name;
        if (current) {
            draft = ui.proofEditorDraft ?? entry?.drawing.rocqProof ?? '';
            requestAnimationFrame(() => {
                ta?.focus();
                ta?.select();
            });
        }
    });

    function onSave(): void {
        if (!name) return;
        updateDrawingRocqProof(name, draft);
        closeProofEditor();
    }

    function onCancel(): void {
        closeProofEditor();
    }

    function onRemove(): void {
        if (!name) return;
        updateDrawingRocqProof(name, '');
        closeProofEditor();
    }

    function onKeydown(event: KeyboardEvent): void {
        if (event.key === 'Escape') {
            onCancel();
        }
    }

    function onBackdropPointerdown(event: PointerEvent): void {
        if (event.target === event.currentTarget) {
            onCancel();
        }
    }
</script>

{#if name}
    <div class="modal-backdrop" role="button" tabindex="-1" aria-label="Close" onpointerdown={onBackdropPointerdown}>
        <div class="modal" role="dialog" aria-modal="true" tabindex="-1" aria-label="Rocq proof of {entry?.name ?? name}" onkeydown={onKeydown}>
            <div class="modal-title">Rocq proof of '{entry?.name ?? name}'</div>
            <textarea class="proof-textarea" bind:this={ta} bind:value={draft} rows="18" spellcheck="false"></textarea>
            <div class="modal-actions">
                <button class="layer-btn" title="Remove the attached Rocq proof from this rule" onclick={onRemove}>Remove</button>
                <button class="layer-btn" onclick={onCancel}>Cancel</button>
                <button class="layer-btn" onclick={onSave}>Save</button>
            </div>
        </div>
    </div>
{/if}