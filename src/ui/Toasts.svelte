<script lang="ts">
    import { ui, dismissToast } from './store.svelte.ts';
</script>

<div class="toast-container">
    {#each ui.toasts as toast (toast.id)}
        <div class="toast {toast.kind}" role="alert">
            <span class="toast-message">{toast.message}</span>
            <button
                class="toast-close"
                aria-label="Dismiss notification"
                onclick={() => dismissToast(toast.id)}
            >×</button>
        </div>
    {/each}
</div>
