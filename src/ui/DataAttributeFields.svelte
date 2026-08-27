<script lang="ts">
    export let prefix: string;
    export let model: { data: Record<string, any> };
    export let attributes: Record<string, string | { type: string; min: number; max: number; default: number } | { type: string; target: string }>;
    export let onValueChange: (attrName: string, value: string | number | boolean) => void;
    export let onSetPosition: (attrName: string, axis: 0 | 1, newVal: number) => void;
    export let isPickerActive: (attrName: string) => boolean;
    export let onPickPosition: (attrName: string) => void;
    export let isDepReady: (attrName: string) => boolean = () => true;

    function getTypeName(at: string | { type: string; min: number; max: number; default: number } | { type: string; target: string }): string {
        return typeof at === 'string' ? at : at.type;
    }

    function getTarget(at: { type: string; target: string } | string | { type: string; min: number; max: number; default: number }): string | null {
        return typeof at === 'object' && 'target' in at ? at.target : null;
    }
</script>

{#each Object.entries(attributes) as [attrName, expectedType]}
    {@const typeName = getTypeName(expectedType)}
    {#if typeName === 'string' || typeName === 'number'}
        <div class="form-group">
            <label for="{prefix}-attr-{attrName}">{attrName} ({typeName})</label>
            <input
                id="{prefix}-attr-{attrName}"
                type={typeName === 'number' ? 'number' : 'text'}
                step={typeName === 'number' ? 'any' : undefined}
                value={model.data[attrName] !== undefined ? model.data[attrName] : ''}
                onchange={(e) => {
                    const target = e.currentTarget as HTMLInputElement;
                    if (typeName === 'number') {
                        const parsed = parseFloat(target.value);
                        if (!Number.isNaN(parsed)) onValueChange(attrName, parsed);
                    } else {
                        onValueChange(attrName, target.value);
                    }
                }}
            />
        </div>
    {:else if typeName === 'slider'}
        <div class="form-group">
            <label for="{prefix}-slider-{attrName}">{attrName} ({model.data[attrName]})</label>
            <input
                id="{prefix}-slider-{attrName}"
                type="range"
                min={typeof expectedType !== 'string' && 'min' in expectedType ? expectedType.min : 0}
                max={typeof expectedType !== 'string' && 'min' in expectedType ? expectedType.max : 100}
                step="1"
                value={model.data[attrName] !== undefined ? model.data[attrName] : 0}
                oninput={(e) => {
                    const parsed = parseFloat((e.currentTarget as HTMLInputElement).value);
                    if (!Number.isNaN(parsed)) onValueChange(attrName, parsed);
                }}
            />
        </div>
    {:else if typeName === 'boolean'}
        <div class="form-group checkbox">
            <input
                id="{prefix}-bool-{attrName}"
                type="checkbox"
                checked={!!model.data[attrName]}
                onchange={(e) => onValueChange(attrName, (e.currentTarget as HTMLInputElement).checked)}
            />
            <label for="{prefix}-bool-{attrName}">{attrName}</label>
        </div>
    {:else if typeName === 'position'}
        <div class="form-group">
            <label for="{prefix}-pos-{attrName}-x">{attrName} (x, y)</label>
            <div class="position">
                <input
                    id="{prefix}-pos-{attrName}-x"
                    type="number"
                    step="any"
                    value={model.data[attrName] ? model.data[attrName][0] : 0}
                    onchange={(e) => onSetPosition(attrName, 0, parseFloat((e.currentTarget as HTMLInputElement).value))}
                />
                <input
                    id="{prefix}-pos-{attrName}-y"
                    type="number"
                    step="any"
                    value={model.data[attrName] ? model.data[attrName][1] : 0}
                    onchange={(e) => onSetPosition(attrName, 1, parseFloat((e.currentTarget as HTMLInputElement).value))}
                />
                <button
                    type="button"
                    class="pick-btn"
                    style={isPickerActive(attrName) ? 'background-color: #aed6f1;' : ''}
                    title="Click canvas to pick position"
                    onclick={() => onPickPosition(attrName)}
                >&#x1F4CD;</button>
            </div>
        </div>
    {:else if typeName === 'relativePosition'}
        <div class="form-group">
            <label for="{prefix}-rpos-{attrName}-x">{attrName} (dx, dy) <span style="font-size:0.75em;color:#888;">rel. {getTarget(expectedType)}</span></label>
            <div class="position">
                <input
                    id="{prefix}-rpos-{attrName}-x"
                    type="number"
                    step="any"
                    value={model.data[attrName] ? model.data[attrName][0] : 0}
                    onchange={(e) => onSetPosition(attrName, 0, parseFloat((e.currentTarget as HTMLInputElement).value))}
                />
                <input
                    id="{prefix}-rpos-{attrName}-y"
                    type="number"
                    step="any"
                    value={model.data[attrName] ? model.data[attrName][1] : 0}
                    onchange={(e) => onSetPosition(attrName, 1, parseFloat((e.currentTarget as HTMLInputElement).value))}
                />
                <button
                    type="button"
                    class="pick-btn"
                    style={isPickerActive(attrName) ? 'background-color: #aed6f1;' : ''}
                    title={isDepReady(attrName) ? 'Click canvas to pick relative position' : 'Set dependency first'}
                    disabled={!isDepReady(attrName)}
                    onclick={() => onPickPosition(attrName)}
                >&#x1F4CD;</button>
            </div>
        </div>
    {/if}
{/each}
