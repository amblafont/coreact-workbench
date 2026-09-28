<script lang="ts">
    import type { AttributeType } from '../index.svelte.ts';
    import { getAttributeType, getRelativePositionMeta, getSliderMeta } from '../index.svelte.ts';

    let {
        prefix,
        model,
        attributes,
        onValueChange,
        onSetPosition,
        isPickerActive,
        onPickPosition,
        isDepReady = () => true
    }: {
        prefix: string;
        model: { data: Record<string, any> };
        attributes: Record<string, AttributeType>;
        onValueChange: (attrName: string, value: string | number | boolean) => void;
        onSetPosition: (attrName: string, axis: 0 | 1, newVal: number) => void;
        isPickerActive: (attrName: string) => boolean;
        onPickPosition: (attrName: string) => void;
        isDepReady?: (attrName: string) => boolean;
    } = $props();
</script>

{#each Object.entries(attributes) as [attrName, expectedType]}
    {@const typeName = getAttributeType(expectedType)}
    {@const sliderMeta = getSliderMeta(expectedType)}
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
                min={sliderMeta ? sliderMeta.min : 0}
                max={sliderMeta ? sliderMeta.max : 100}
                step="1"
                value={model.data[attrName] !== undefined ? model.data[attrName] : (sliderMeta ? sliderMeta.default : 0)}
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
            <label for="{prefix}-rpos-{attrName}-x">{attrName} (dx, dy) <span style="font-size:0.75em;color:#888;">rel. {getRelativePositionMeta(expectedType)?.target}</span></label>
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
