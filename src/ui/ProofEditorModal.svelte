<script lang="ts">
    import { ui, drawingStore, closeProofEditor, updateDrawingProof, removeDrawingProofs } from './store.svelte.ts';
    import ProverTabs from './ProverTabs.svelte';
    import type { ExportTarget } from './store.svelte.ts';

    let name = $derived(ui.proofEditorName);
    let entry = $derived(name ? drawingStore.getDrawing(name) : undefined);
    let activeTab = $state<ExportTarget>(ui.exportTarget);
    let rocqDraft = $state('');
    let abellaDraft = $state('');
    let ta = $state<HTMLTextAreaElement | undefined>(undefined);
    let openedFor = $state<string | null>(null);

    let activeDraft = $derived(activeTab === 'abella' ? abellaDraft : rocqDraft);

    $effect(() => {
        const current = name;
        if (!current) {
            openedFor = null;
            return;
        }
        if (openedFor === current) return;
        openedFor = current;
        activeTab = ui.exportTarget;
        rocqDraft = ui.proofEditorRocqDraft ?? entry?.drawing.rocqProof ?? '';
        abellaDraft = ui.proofEditorAbellaDraft ?? entry?.drawing.abellaProof ?? '';
        requestAnimationFrame(() => {
            ta?.focus();
            ta?.select();
        });
    });

    function onSelectTab(target: ExportTarget): void {
        activeTab = target;
        ui.exportTarget = target;
    }

    function onInput(event: Event): void {
        const value = (event.currentTarget as HTMLTextAreaElement).value;
        if (activeTab === 'abella') {
            abellaDraft = value;
        } else {
            rocqDraft = value;
        }
    }

    function onSave(): void {
        if (!name) return;
        updateDrawingProof(name, 'rocq', rocqDraft);
        updateDrawingProof(name, 'abella', abellaDraft);
        closeProofEditor();
    }

    function onCancel(): void {
        closeProofEditor();
    }

    function onRemove(): void {
        if (!name) return;
        removeDrawingProofs(name);
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
        <div class="modal" role="dialog" aria-modal="true" tabindex="-1" aria-label="Proofs of {entry?.name ?? name}" onkeydown={onKeydown}>
            <div class="modal-title">Proofs of '{entry?.name ?? name}'</div>
            <ProverTabs active={activeTab} onSelect={onSelectTab} />
            <textarea
                class="proof-textarea"
                bind:this={ta}
                value={activeDraft}
                oninput={onInput}
                rows="18"
                spellcheck="false"
            ></textarea>
            <div class="modal-actions">
                <button class="layer-btn" title="Remove the attached proof of this rule (both Rocq and Abella)" onclick={onRemove}>Remove</button>
                <button class="layer-btn" onclick={onCancel}>Cancel</button>
                <button class="layer-btn" onclick={onSave}>Save</button>
            </div>
        </div>
    </div>
{/if}