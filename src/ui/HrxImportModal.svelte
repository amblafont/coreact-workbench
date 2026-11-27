<script lang="ts">
    import { ui, sortStore, drawingStore, applyHrxImport, cancelHrxImport } from './store.svelte.ts';
    import { validateHrxPlan } from '../hrx/load';
    import type { HrxSortPreview, HrxDrawingPreview } from '../hrx/load';

    interface Indexed<T> {
        row: T;
        index: number;
    }

    const indexed = <T,>(rows: T[]): Array<Indexed<T>> => rows.map((row, index) => ({ row, index }));

    let session = $derived(ui.hrxImport);
    let plan = $derived(session?.plan);
    let validation = $derived(plan ? validateHrxPlan(plan, sortStore, drawingStore) : null);

    let existingSorts = $derived(plan ? indexed(plan.sorts).filter(entry => entry.row.kind === 'existing') : []);
    let newSorts = $derived(plan ? indexed(plan.sorts).filter(entry => entry.row.kind === 'new') : []);
    let existingDrawings = $derived(plan ? indexed(plan.drawings).filter(entry => entry.row.kind === 'existing') : []);
    let identicalDrawings = $derived(existingDrawings.filter(entry => entry.row.collision === 'duplicate' && !entry.row.error));
    let dataOnlyDrawings = $derived(existingDrawings.filter(entry => entry.row.collision === 'dataOnly'));
    let structuralDrawings = $derived(existingDrawings.filter(entry =>
        !identicalDrawings.includes(entry) && !dataOnlyDrawings.includes(entry)
    ));
    let newDrawings = $derived(plan ? indexed(plan.drawings).filter(entry => entry.row.kind === 'new') : []);
    let hasAnyRows = $derived(!!plan && (plan.sorts.length > 0 || plan.drawings.length > 0));

    /** Existing sorts that need no choice from the user. */
    let unchangedExistingSorts = $derived(existingSorts.filter(entry =>
        !sortIssue(entry) && !entry.row.weakerEquations && entry.row.drawFunctionsEqual
    ));
    let decidableExistingSorts = $derived(existingSorts.filter(entry => !unchangedExistingSorts.includes(entry)));

    function sortIssue(entry: Indexed<HrxSortPreview>): string {
        return entry.row.error ?? validation?.sortErrors[entry.index] ?? '';
    }

    function drawingIssue(entry: Indexed<HrxDrawingPreview>): string {
        return entry.row.error ?? validation?.drawingErrors[entry.index] ?? '';
    }

    function equationList(equations: string[] | undefined): string {
        return equations && equations.length > 0 ? equations.join('; ') : '(none)';
    }

    function onKeydown(event: KeyboardEvent): void {
        if (event.key === 'Escape') cancelHrxImport();
    }

    function onBackdropPointerdown(event: PointerEvent): void {
        if (event.target === event.currentTarget) cancelHrxImport();
    }
</script>

{#if session && plan && validation}
    <div
        class="modal-backdrop"
        role="button"
        tabindex="-1"
        aria-label="Close import preview"
        onpointerdown={onBackdropPointerdown}
    >
        <div
            class="modal hrx-modal"
            role="dialog"
            aria-modal="true"
            tabindex="-1"
            aria-label="Preview HRX import"
            onkeydown={onKeydown}
        >
            <div class="modal-title">Review import of '{session.fileName}'</div>
            <div class="hrx-hint">
                Choose what to take from the archive. Any error blocks the whole import until it is resolved.
            </div>

            {#each validation.generalErrors as error}
                <div class="hrx-error hrx-general-error">{error}</div>
            {/each}

            <div class="hrx-preview">
                {#if !hasAnyRows}
                    <div class="hrx-empty hrx-empty-all">Nothing to import.</div>
                {/if}

                {#if newSorts.length > 0}
                    <section class="hrx-group">
                        <h4 class="hrx-group-title">Sorts to add ({newSorts.length})</h4>
                        {#each newSorts as entry (entry.row.name)}
                            {@const issue = sortIssue(entry)}
                            <div class="hrx-row" class:error={!!issue}>
                                <div class="hrx-row-main">
                                    <span class="hrx-name">{entry.row.name}</span>
                                    <div class="hrx-actions">
                                        <button
                                            type="button"
                                            class="hrx-toggle"
                                            class:active={entry.row.decision === 'add'}
                                            aria-pressed={entry.row.decision === 'add'}
                                            title="Add this sort from the archive"
                                            disabled={!!issue}
                                            onclick={() => { entry.row.decision = 'add'; }}
                                        >Add</button>
                                        <button
                                            type="button"
                                            class="hrx-toggle"
                                            class:active={entry.row.decision === 'skip'}
                                            aria-pressed={entry.row.decision === 'skip'}
                                            title="Do not import this sort"
                                            disabled={!!issue}
                                            onclick={() => { entry.row.decision = 'skip'; }}
                                        >Skip</button>
                                    </div>
                                </div>
                                {#if issue}<div class="hrx-error">{issue}</div>{/if}
                            </div>
                        {/each}
                    </section>
                {/if}

                {#if existingSorts.length > 0}
                    <section class="hrx-group">
                        <h4 class="hrx-group-title">Sorts already in the workspace ({existingSorts.length})</h4>
                        {#each decidableExistingSorts as entry (entry.row.name)}
                            {@const issue = sortIssue(entry)}
                            <div class="hrx-row" class:error={!!issue}>
                                <div class="hrx-row-main">
                                    <span class="hrx-name">{entry.row.name}</span>
                                    {#if entry.row.weakerEquations || !entry.row.drawFunctionsEqual}
                                        <div class="hrx-actions">
                                            {#if entry.row.weakerEquations}
                                                <button
                                                    type="button"
                                                    class="hrx-toggle"
                                                    class:active={entry.row.keepEquations}
                                                    aria-pressed={entry.row.keepEquations}
                                                    title="Keep the existing equations; the archive's are weaker"
                                                    disabled={!!issue}
                                                    onclick={() => { entry.row.keepEquations = !entry.row.keepEquations; }}
                                                >Keep equations</button>
                                            {/if}
                                            {#if !entry.row.drawFunctionsEqual}
                                                <button
                                                    type="button"
                                                    class="hrx-toggle"
                                                    class:active={entry.row.replaceDrawFunctions}
                                                    aria-pressed={entry.row.replaceDrawFunctions}
                                                    title="Use the draw function from the archive"
                                                    disabled={!!issue}
                                                    onclick={() => { entry.row.replaceDrawFunctions = !entry.row.replaceDrawFunctions; }}
                                                >Replace draw functions</button>
                                            {/if}
                                        </div>
                                    {/if}
                                </div>
                                {#if entry.row.weakerEquations}
                                    <details class="hrx-details">
                                        <summary>Archive declares weaker equations</summary>
                                        <div>Existing: {equationList(entry.row.existingEquations)}</div>
                                        <div>Archive: {equationList(entry.row.equations)}</div>
                                    </details>
                                {/if}
                                {#if issue}<div class="hrx-error">{issue}</div>{/if}
                            </div>
                        {/each}
                        {#if unchangedExistingSorts.length > 0}
                            <div class="hrx-compact">
                                {unchangedExistingSorts.map(entry => entry.row.name).join(', ')}
                            </div>
                        {/if}
                    </section>
                {/if}

                {#if newDrawings.length > 0}
                    <section class="hrx-group">
                        <h4 class="hrx-group-title">Drawings to add ({newDrawings.length})</h4>
                        {#each newDrawings as entry (entry.index)}
                            {@const issue = drawingIssue(entry)}
                            <div class="hrx-row" class:error={!!issue}>
                                <div class="hrx-row-main">
                                    <span class="hrx-name">{entry.row.requestedName}</span>
                                    <div class="hrx-actions">
                                        <button
                                            type="button"
                                            class="hrx-toggle"
                                            class:active={entry.row.decision === 'add'}
                                            aria-pressed={entry.row.decision === 'add'}
                                            title="Add this drawing from the archive"
                                            disabled={!!issue}
                                            onclick={() => { entry.row.decision = 'add'; }}
                                        >Add</button>
                                        <button
                                            type="button"
                                            class="hrx-toggle"
                                            class:active={entry.row.decision === 'skip'}
                                            aria-pressed={entry.row.decision === 'skip'}
                                            title="Do not import this drawing"
                                            disabled={!!issue}
                                            onclick={() => { entry.row.decision = 'skip'; }}
                                        >Skip</button>
                                    </div>
                                </div>
                                {#if issue}<div class="hrx-error">{issue}</div>{/if}
                            </div>
                        {/each}
                    </section>
                {/if}

                {#if existingDrawings.length > 0}
                    <section class="hrx-group">
                        <h4 class="hrx-group-title">Drawings already in the workspace ({existingDrawings.length})</h4>
                        {#if identicalDrawings.length > 0}
                            <h5 class="hrx-subtitle">Identical (skipped)</h5>
                            <div class="hrx-compact">
                                {identicalDrawings.map(entry => entry.row.requestedName).join(', ')}
                            </div>
                        {/if}

                        {#if dataOnlyDrawings.length > 0}
                            <h5 class="hrx-subtitle">Only data differs</h5>
                            {#each dataOnlyDrawings as entry (entry.index)}
                                {@const issue = drawingIssue(entry)}
                                <div class="hrx-row" class:error={!!issue}>
                                    <div class="hrx-row-main">
                                        <span class="hrx-name">{entry.row.requestedName}</span>
                                        <div class="hrx-actions">
                                            <button
                                                type="button"
                                                class="hrx-toggle"
                                                class:active={entry.row.decision === 'skip'}
                                                aria-pressed={entry.row.decision === 'skip'}
                                                title="Leave the existing drawing untouched"
                                                disabled={!!issue}
                                                onclick={() => { entry.row.decision = 'skip'; }}
                                            >Skip</button>
                                            <button
                                                type="button"
                                                class="hrx-toggle"
                                                class:active={entry.row.decision === 'replace'}
                                                aria-pressed={entry.row.decision === 'replace'}
                                                title="Overwrite the existing drawing with the archive version"
                                                disabled={!!issue}
                                                onclick={() => { entry.row.decision = 'replace'; }}
                                            >Replace</button>
                                            <button
                                                type="button"
                                                class="hrx-toggle"
                                                class:active={entry.row.decision === 'rename'}
                                                aria-pressed={entry.row.decision === 'rename'}
                                                title="Import the archive version under a different name"
                                                disabled={!!issue}
                                                onclick={() => { entry.row.decision = 'rename'; }}
                                            >Rename</button>
                                        </div>
                                    </div>
                                    {#if entry.row.decision === 'rename'}
                                        <label class="hrx-rename">
                                            Import as
                                            <input type="text" bind:value={entry.row.renameTo} spellcheck="false" />
                                        </label>
                                    {/if}
                                    {#if issue}<div class="hrx-error">{issue}</div>{/if}
                                </div>
                            {/each}
                        {/if}

                        {#if structuralDrawings.length > 0}
                            <h5 class="hrx-subtitle">Different structure</h5>
                            {#each structuralDrawings as entry (entry.index)}
                                {@const issue = drawingIssue(entry)}
                                <div class="hrx-row" class:error={!!issue}>
                                    <div class="hrx-row-main">
                                        <span class="hrx-name">{entry.row.requestedName}</span>
                                        <div class="hrx-actions">
                                            <button
                                                type="button"
                                                class="hrx-toggle"
                                                class:active={entry.row.decision === 'skip'}
                                                aria-pressed={entry.row.decision === 'skip'}
                                                title="Leave the existing drawing untouched"
                                                disabled={!!issue}
                                                onclick={() => { entry.row.decision = 'skip'; }}
                                            >Skip</button>
                                            <button
                                                type="button"
                                                class="hrx-toggle"
                                                class:active={entry.row.decision === 'replace'}
                                                aria-pressed={entry.row.decision === 'replace'}
                                                title="Overwrite the existing drawing with the archive version"
                                                disabled={!!issue}
                                                onclick={() => { entry.row.decision = 'replace'; }}
                                            >Replace</button>
                                            <button
                                                type="button"
                                                class="hrx-toggle"
                                                class:active={entry.row.decision === 'rename'}
                                                aria-pressed={entry.row.decision === 'rename'}
                                                title="Import the archive version under a different name"
                                                disabled={!!issue}
                                                onclick={() => { entry.row.decision = 'rename'; }}
                                            >Rename</button>
                                        </div>
                                    </div>
                                    {#if entry.row.decision === 'rename'}
                                        <label class="hrx-rename">
                                            Import as
                                            <input type="text" bind:value={entry.row.renameTo} spellcheck="false" />
                                        </label>
                                    {/if}
                                    {#if issue}<div class="hrx-error">{issue}</div>{/if}
                                </div>
                            {/each}
                        {/if}
                    </section>
                {/if}
            </div>

            <div class="modal-actions">
                <span class="hrx-counts">
                    {plan.sorts.filter(row => row.kind === 'new' && row.decision === 'add').length} sorts to add,
                    {plan.drawings.filter(row => row.decision === 'add' || row.decision === 'replace' || row.decision === 'rename').length} drawings to import
                </span>
                <button type="button" class="layer-btn" title="Close without importing" onclick={cancelHrxImport}>Cancel</button>
                <button
                    type="button"
                    class="layer-btn"
                    title="Import using the choices above"
                    disabled={validation.hasErrors}
                    onclick={applyHrxImport}
                >Import</button>
            </div>
        </div>
    </div>
{/if}
