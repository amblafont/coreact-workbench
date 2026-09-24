<script lang="ts">
    import type { ExportTarget } from './store.svelte.ts';

    let { active, onSelect }: { active: ExportTarget; onSelect: (target: ExportTarget) => void } = $props();

    const tabs: Array<{ target: ExportTarget; label: string }> = [
        { target: 'rocq', label: 'Rocq' },
        { target: 'abella', label: 'Abella' }
    ];
</script>

<div class="prover-tabs" role="tablist" aria-label="Proof assistant">
    {#each tabs as tab (tab.target)}
        <button
            type="button"
            role="tab"
            class="prover-tab"
            class:active={active === tab.target}
            aria-selected={active === tab.target}
            onclick={() => onSelect(tab.target)}
        >{tab.label}</button>
    {/each}
</div>