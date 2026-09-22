<script lang="ts">
    import type { Artefact } from '../index.svelte.ts';
    import { getAttributeType, getRelativePositionMeta } from '../index.svelte.ts';
    import DataAttributeFields from './DataAttributeFields.svelte';
    import { getDrawing, sortStore, allLayers, ui } from './store.svelte.ts';
    import {
        ruleTag
    } from './store.svelte.ts';
    import {
        cancelMergeMode,
        performMerge,
        cancelDraft,
        createDraftArtefact,
        isDraftComplete,
        setDraftLayer,
        setDraftDataField,
        setArtefactLayer,
        setInspectedLabel,
        setArtefactDataField,
        togglePositionPicker,
        isPositionPickerActive,
        toggleDraftPicker,
        isDraftPickerActive,
        equalityChildren,
        pushToast
    } from './store.svelte.ts';

    // --- Merge view helpers ---
    let provablyEqualCandidates = $derived.by(() => {
        const first = ui.mergeFirstArtefact;
        if (!first) return [];
        return getDrawing().getArtefacts().filter(art =>
            art !== first && getDrawing().areDependenciesEqual(first, art) && getDrawing().areProvablyEqual(first, art)
        );
    });
    let otherCandidates = $derived.by(() => {
        const first = ui.mergeFirstArtefact;
        if (!first) return [];
        return getDrawing().getArtefacts().filter(art =>
            art !== first && getDrawing().areDependenciesEqual(first, art) && !getDrawing().areProvablyEqual(first, art)
        );
    });
    let orderedCandidates = $derived([...provablyEqualCandidates, ...otherCandidates]);
    let mergePreviewLabel = $derived.by(() => {
        const label1 = ui.mergeFirstArtefact && typeof ui.mergeFirstArtefact.data.label === 'string'
            ? (ui.mergeFirstArtefact.data.label as string).trim()
            : '';
        const label2 = ui.mergeSecondArtefact && typeof ui.mergeSecondArtefact.data.label === 'string'
            ? (ui.mergeSecondArtefact.data.label as string).trim()
            : '';
        if (label1 && label2) return `${label1}, ${label2}`;
        if (label1) return label1;
        if (label2) return label2;
        return '';
    });

    let inspectModel = $derived.by(() => {
        const a = ui.inspectedArtefact;
        return a ? { data: a.data, dependencies: a.dependencies, sortName: a.sortName } as Artefact : null;
    });
    let inspectLabel = $derived(ui.inspectedArtefact && typeof ui.inspectedArtefact.data.label === 'string' ? ui.inspectedArtefact.data.label : '');
    let inspectLayerId = $derived(ui.inspectedArtefact && typeof ui.inspectedArtefact.layerId === 'string' ? ui.inspectedArtefact.layerId : 'root');

    let secondSelectIndex = $derived(ui.mergeSecondArtefact ? orderedCandidates.indexOf(ui.mergeSecondArtefact) : -1);

    let canMerge = $derived(!!(ui.mergeFirstArtefact && ui.mergeSecondArtefact
        && ui.mergeFirstArtefact !== ui.mergeSecondArtefact
        && getDrawing().areDependenciesEqual(ui.mergeFirstArtefact, ui.mergeSecondArtefact)));

    function toggleMergeFirst(): void {
        ui.mergePickingFor = ui.mergePickingFor === 'first' ? null : 'first';
    }

    function toggleMergeSecond(): void {
        ui.mergePickingFor = ui.mergePickingFor === 'second' ? null : 'second';
    }

    function onMergeSecondSelect(e: Event): void {
        const val = (e.currentTarget as HTMLSelectElement).value;
        if (val !== '') {
            ui.mergeSecondArtefact = orderedCandidates[parseInt(val, 10)];
            ui.mergePickingFor = null;
        } else {
            ui.mergeSecondArtefact = null;
        }
    }

    function candidateOptionText(cand: Artefact): string {
        const layerObj = getDrawing().getLayer(cand.layerId);
        return `${cand.data.label || '(unnamed)'} (${cand.sortName} in '${layerObj ? layerObj.name : cand.layerId}')`;
    }

    function toggleDraftPicking(): void {
        ui.dependencyPickingFor = ui.dependencyPickingFor === 'Equality' ? null : 'Equality';
    }

    function toggleDepPicking(depKey: string): void {
        ui.dependencyPickingFor = ui.dependencyPickingFor === depKey ? null : depKey;
    }

    function updatePosition(
        model: { data: Record<string, any> },
        attrName: string,
        newVal: number,
        axis: 0 | 1,
        apply: (value: [number, number]) => void
    ): void {
        const current = Array.isArray(model.data[attrName]) ? model.data[attrName] as number[] : [0, 0];
        const next: [number, number] = axis === 0 ? [newVal, current[1]] : [current[0], newVal];
        if (!Number.isNaN(next[0]) && !Number.isNaN(next[1])) {
            apply(next);
        }
    }

    function makeIsDepReady(deps: Record<string, Artefact>, sortName: string): (attrName: string) => boolean {
        const sortDef = sortStore.getSort(sortName);
        return (attrName: string) => {
            if (!sortDef) return false;
            const attrType = sortDef.attributes[attrName];
            if (!attrType || getAttributeType(attrType) !== 'relativePosition') return true;
            const rpMeta = getRelativePositionMeta(attrType);
            if (!rpMeta) return false;
            const depKey = rpMeta.target.split('.')[0];
            return depKey in deps;
        };
    }
</script>

<!-- ================= Merge Mode View ================= -->
{#if ui.mergeMode}
    <h3 style="margin-top: 0;">Merge Artefacts</h3>
    <p style="color: #666; font-size: 0.82rem; margin-top: 4px; margin-bottom: 12px;">
        Select two artefacts of the same sort with identical dependencies to merge them.
    </p>

    <div>
        <div class="form-group">
            <label for="merge-first-btn">1st Artefact (to be removed)</label>
            <button
                id="merge-first-btn"
                type="button"
                class="pick-dep-btn {ui.mergePickingFor === 'first' ? 'active' : ''}"
                onclick={toggleMergeFirst}
            >
                {#if ui.mergeFirstArtefact}
                    1st: {ui.mergeFirstArtefact.data.label || '(unnamed)'} ({ui.mergeFirstArtefact.sortName})
                {:else if ui.mergePickingFor === 'first'}
                    Click artefact in tree...
                {:else}
                    Pick 1st Artefact
                {/if}
            </button>
        </div>

        <div class="form-group">
            <label for="merge-second-select">2nd Artefact (datafields kept)</label>
            {#if ui.mergeFirstArtefact}
                {#if orderedCandidates.length === 0}
                    <div style="font-size: 0.8rem; color: #e74c3c; font-style: italic; margin-top: 4px;">
                        No other artefacts with matching dependencies found.
                    </div>
                {:else}
                    <select id="merge-second-select" value={secondSelectIndex >= 0 ? String(secondSelectIndex) : ''} onchange={onMergeSecondSelect}>
                        <option value="">-- Select 2nd Artefact --</option>
                        {#if provablyEqualCandidates.length > 0}
                            <optgroup label="≡ Provably equal (via equality artefacts)">
                                {#each provablyEqualCandidates as cand}
                                    <option
                                        value={orderedCandidates.indexOf(cand)}
                                        style="color: #8e44ad; font-weight: bold;"
                                    >≡ {candidateOptionText(cand)} (proven equal)</option>
                                {/each}
                            </optgroup>
                        {/if}
                        {#if otherCandidates.length > 0}
                            <optgroup label="Other candidates">
                                {#each otherCandidates as cand}
                                    <option value={orderedCandidates.indexOf(cand)}>{candidateOptionText(cand)}</option>
                                {/each}
                            </optgroup>
                        {/if}
                    </select>
                {/if}
                <button
                    type="button"
                    class="pick-dep-btn {ui.mergePickingFor === 'second' ? 'active' : ''}"
                    style="margin-top: 6px;"
                    onclick={toggleMergeSecond}
                >
                    {#if ui.mergeSecondArtefact}
                        2nd: {ui.mergeSecondArtefact.data.label || '(unnamed)'} ({ui.mergeSecondArtefact.sortName})
                    {:else if ui.mergePickingFor === 'second'}
                        Click candidate in tree...
                    {:else}
                        Or Pick in Tree/Canvas
                    {/if}
                </button>
            {:else}
                <div style="font-size: 0.8rem; color: #888; font-style: italic;">
                    Select 1st artefact first.
                </div>
            {/if}
        </div>

        {#if ui.mergeFirstArtefact && ui.mergeSecondArtefact}
            <div class="merge-preview-box">
                <strong style="color: #8e44ad;">Merge Result Preview:</strong><br/>
                • Datafields kept from: <strong>{ui.mergeSecondArtefact.data.label || ui.mergeSecondArtefact.sortName}</strong><br/>
                • New Label: <strong>{mergePreviewLabel || '(none)'}</strong>
            </div>
        {/if}

        <div class="action-btns">
            <button type="button" class="btn btn-cancel" onclick={cancelMergeMode}>Cancel</button>
            <button type="button" class="btn btn-merge" disabled={!canMerge} onclick={performMerge}>Merge</button>
        </div>
    </div>

<!-- ================= Draft (Creation) View ================= -->
{:else if ui.draftArtefact}
    {@const draft = ui.draftArtefact}
    {@const draftSortDef = sortStore.getSort(draft.sortName)}
    {#if draftSortDef}
        {@const allDeps = Object.entries(draftSortDef.dependencies)}
        <h3 style="margin-top: 0;">
            {#if draft.duplicateOf}
                Duplicate {draft.sortName}
            {:else}
                New {draft.sortName}
            {/if}
        </h3>
        {#if draft.duplicateOf}
            <p style="color: #666; font-size: 0.82rem; margin-top: 2px; margin-bottom: 10px; font-style: italic;">
                Duplicating '{draft.duplicateOf.data.label || draft.duplicateOf.sortName}' — dependencies must be provably equal to original.
            </p>
        {/if}

        <div>
            <div class="form-group">
                <label for="draft-layer-select">Layer</label>
                <select
                    id="draft-layer-select"
                    value={draft.layerId}
                    onchange={(e) => setDraftLayer((e.currentTarget as HTMLSelectElement).value)}
                >
                    {#each allLayers() as l}
                        <option value={l.id}>{l.name}</option>
                    {/each}
                </select>
            </div>

            {#if draft.sortName === 'Equality'}
                <h4 style="margin: 10px 0 5px 0; font-size: 0.95rem; color: #444;">Equalized Artefacts (pick >= 2 of same sort)</h4>
                {#each equalityChildren(draft) as item}
                    <div style="font-size: 0.85rem; margin: 3px 0;">• {item.data.label || item.sortName} ({item.sortName})</div>
                {/each}
                <button
                    type="button"
                    class="pick-dep-btn {ui.dependencyPickingFor === 'Equality' ? 'active' : ''}"
                    onclick={toggleDraftPicking}
                >
                    {ui.dependencyPickingFor === 'Equality' ? 'Click artefact in tree...' : '+ Pick Artefact'}
                </button>
            {:else if allDeps.length > 0}
                <h4 style="margin: 10px 0 5px 0; font-size: 0.95rem; color: #444;">Dependencies</h4>
                {#each allDeps as [depKey, expectedSort]}
                    {@const picked = draft.dependencies[depKey]}
                    <div class="form-group">
                        <label for="draft-dep-{depKey}">{depKey} ({expectedSort})</label>
                        <button
                            id="draft-dep-{depKey}"
                            type="button"
                            class="pick-dep-btn {ui.dependencyPickingFor === depKey ? 'active' : ''}"
                            onclick={() => toggleDepPicking(depKey)}
                        >
                            {#if picked}
                                ✓ {picked.data.label || '(unnamed)'}
                            {:else if ui.dependencyPickingFor === depKey}
                                Select in tree...
                            {:else}
                                Pick {depKey}
                            {/if}
                        </button>
                    </div>
                {/each}
            {/if}

            <h4 style="margin: 15px 0 5px 0; font-size: 0.95rem; color: #444;">Data Attributes</h4>
            <div class="form-group">
                <label for="draft-label-input">Label</label>
                <input
                    id="draft-label-input"
                    type="text"
                    value={draft.data.label || ''}
                    onchange={(e) => setDraftDataField('label', (e.currentTarget as HTMLInputElement).value)}
                />
            </div>
            {#if ruleTag()}
                <p style="color: #888; font-style: italic; font-size: 0.78rem; margin: 2px 0 0 0;">
                    Use $name to reference root artefact labels when applying rules (e.g. $x → $y)
                </p>
            {/if}

            <DataAttributeFields
                prefix="draft"
                model={draft}
                attributes={draftSortDef.attributes}
                onValueChange={(attrName, value) => setDraftDataField(attrName, value)}
                onSetPosition={(attrName, axis, newVal) => {
                    const currentDraft = ui.draftArtefact;
                    if (!currentDraft) return;
                    updatePosition(currentDraft, attrName, newVal, axis, (v) => setDraftDataField(attrName, v));
                }}
                isPickerActive={(attrName) => isDraftPickerActive(attrName)}
                onPickPosition={(attrName) => toggleDraftPicker(attrName)}
                isDepReady={makeIsDepReady(draft.dependencies, draft.sortName)}
            />

            <div class="action-btns">
                <button type="button" class="btn btn-cancel" onclick={cancelDraft}>Cancel</button>
                <button
                    type="button"
                    class="btn btn-validate"
                    disabled={!isDraftComplete(draft)}
                    onclick={() => createDraftArtefact()}
                >Validate</button>
            </div>
        </div>
    {/if}

<!-- ================= Normal Inspection View ================= -->
{:else if ui.inspectedArtefact}
    {@const art = ui.inspectedArtefact}
    {@const artSortDef = sortStore.getSort(art.sortName)}
    {#if artSortDef}
        <h3 style="margin-top: 0;">
            {art.sortName}
            {#if art.sortName === 'Equality' && equalityChildren(art).length > 0}
                [{equalityChildren(art)[0].sortName}]
            {/if}
        </h3>

        <div>
            <div class="form-group">
                <label for="inspect-layer-select">Layer</label>
                <select
                    id="inspect-layer-select"
                    value={inspectLayerId}
                    onchange={(e) => {
                        const newLayerId = (e.currentTarget as HTMLSelectElement).value;
                        try {
                            setArtefactLayer(art, newLayerId);
                        } catch (err) {
                            pushToast('error', (err as Error).message);
                        }
                    }}
                >
                    {#each allLayers() as l}
                        <option value={l.id}>{l.name}</option>
                    {/each}
                </select>
            </div>

            <div class="form-group">
                <label for="inspect-label-input">Label</label>
                <input
                    id="inspect-label-input"
                    type="text"
                    value={inspectLabel}
                    placeholder={art.sortName === 'Equality'
                        ? equalityChildren(art).map(c => c.data.label || c.sortName).join(' = ')
                        : undefined}
                    onchange={(e) => setInspectedLabel(art, (e.currentTarget as HTMLInputElement).value)}
                />
            </div>
            {#if ruleTag()}
                <p style="color: #888; font-style: italic; font-size: 0.78rem; margin: 2px 0 0 0;">
                    Use $name to reference root artefact labels when applying rules (e.g. $x → $y)
                </p>
            {/if}

            <DataAttributeFields
                prefix="inspect"
                model={inspectModel!}
                attributes={artSortDef.attributes}
                onValueChange={(attrName, value) => setArtefactDataField(art, attrName, value)}
                onSetPosition={(attrName, axis, newVal) =>
                    updatePosition(art, attrName, newVal, axis, (v) => setArtefactDataField(art, attrName, v))}
                isPickerActive={(attrName) => isPositionPickerActive(art, attrName)}
                onPickPosition={(attrName) => togglePositionPicker(art, attrName)}
                isDepReady={makeIsDepReady(art.dependencies, art.sortName)}
            />
        </div>
    {/if}
{:else}
    <p style="color: #666; font-style: italic;">Select an artefact to inspect.</p>
{/if}
