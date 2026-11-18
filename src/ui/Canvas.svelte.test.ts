import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import type { Artefact } from '../index.svelte.ts';
import Canvas from './Canvas.svelte';
import { drawingStore, getDrawing, sortStore, ui, toggleRuleFilterArtefact } from './store.svelte.ts';
import { registerDefaultSorts } from '../demo/buildDemo';
import { makeVertex } from '../demo/helpers';

describe('Canvas artefact filter overlay', () => {
    let component: ReturnType<typeof mount> | undefined;
    let v0: Artefact;
    let v1: Artefact;

    function opacity(art: Artefact): string | null {
        return art.svgElement?.node()?.getAttribute('opacity') ?? null;
    }

    function render(): void {
        component = mount(Canvas, { target: document.body });
        flushSync();
    }

    beforeEach(() => {
        registerDefaultSorts(sortStore);
        getDrawing().clear(true);
        drawingStore.clear();
        ui.activeDrawingName = null;
        ui.ruleFilterArtefacts.clear();
        ui.ruleFilterPicking = false;
        ui.inspectedArtefact = null;
        ui.focusedLayerId = null;
        ui.menuHoverArtefact = null;
        ui.ruleHoverArtefacts = null;
        ui.mergeMode = false;
        v0 = makeVertex(getDrawing(), 'v0');
        v1 = makeVertex(getDrawing(), 'v1');
    });

    afterEach(() => {
        if (component) {
            unmount(component);
            component = undefined;
        }
        document.body.innerHTML = '';
        getDrawing().clear(true);
        drawingStore.clear();
        ui.activeDrawingName = null;
        ui.ruleFilterArtefacts.clear();
        ui.ruleFilterPicking = false;
        ui.inspectedArtefact = null;
        ui.focusedLayerId = null;
        ui.menuHoverArtefact = null;
        ui.ruleHoverArtefacts = null;
        ui.mergeMode = false;
    });

    it('highlights picked artefacts only while picking and hovering the canvas', () => {
        render();
        const svg = document.querySelector<SVGSVGElement>('#canvas')!;

        ui.ruleFilterPicking = true;
        flushSync();
        svg.dispatchEvent(new Event('pointerenter'));
        flushSync();
        expect(opacity(v0)).toBeNull();

        toggleRuleFilterArtefact(v0);
        flushSync();
        expect(opacity(v0)).toBe('1');
        expect(opacity(v1)).toBe('0.5');

        // Swapping the single selection must update the overlay immediately.
        toggleRuleFilterArtefact(v1);
        toggleRuleFilterArtefact(v0);
        flushSync();
        expect(opacity(v0)).toBe('0.5');
        expect(opacity(v1)).toBe('1');

        ui.ruleFilterPicking = false;
        flushSync();
        expect(opacity(v0)).toBeNull();
        expect(opacity(v1)).toBeNull();

        svg.dispatchEvent(new Event('pointerleave'));
        flushSync();
    });
});
