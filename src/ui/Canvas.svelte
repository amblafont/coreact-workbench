<script lang="ts">
    import { onMount, untrack } from 'svelte';
    import * as d3 from 'd3';
    import { Artefact } from '../index.svelte.ts';
    import type { D3Context } from '../types';
    import {
        drawing,
        sortStore,
        ui,
        applyPickedPosition,
        mergeBaseOpacityFor
    } from './store.svelte.ts';

    let svgElement!: SVGSVGElement;
    let svgContext: d3.Selection<SVGSVGElement, unknown, null, undefined> | null = null;
    let svgReady = $state(false);

    const mergeOn = $derived(ui.mergeMode);
    const focusedId = $derived(ui.focusedLayerId);
    const mergeHover = $derived(ui.mergeHoverArtefact);
    const inspected = $derived(ui.inspectedArtefact);
    const menuHover = $derived(ui.menuHoverArtefact);
    const ruleHover = $derived(ui.ruleHoverArtefacts);

    $effect(() => {
        if (!svgReady) return;
        if (mergeOn || ruleHover || menuHover || inspected || focusedId) {
            applyOverlays();
        } else {
            redraw();
        }
    });

    $effect(() => {
        if (!svgReady) return;
        void ui.activeDrawingName;
        redraw();
        untrack(applyOverlays);
    });


    function canvasOpacity(art: Artefact): number | null {
        if (mergeOn) {
            const hoveredSet = mergeHover ? mergeHover.getSelfAndDependencies() : null;
            if (hoveredSet && hoveredSet.has(art)) {
                return 1.0;
            }
            if (hoveredSet) {
                return 0.5;
            }
            return mergeBaseOpacityFor(art);
        }
        if (ruleHover) {
            return ruleHover.has(art) ? 1 : 0.5;
        }
        const target = menuHover ?? inspected;
        if (target) {
            return target.getSelfAndDependencies().has(art) ? 1 : 0.5;
        }
        if (focusedId) {
            return art.layerId === focusedId ? 1.0 : 0.5;
        }
        return null;
    }

    function applyOverlays(): void {
        if (!svgContext) return;
        for (const art of drawing.getArtefacts()) {
            if (!art.svgElement) continue;
            const opacity = canvasOpacity(art);
            if (opacity !== null) {
                art.svgElement.attr('opacity', opacity);
            }
        }
    }

    function drawDraftPreview(): void {
        const draft = ui.draftArtefact;
        if (!draft) return;
        const sortDef = sortStore.getSort(draft.sortName);
        if (!sortDef) return;

        let canPreview = true;
        for (const [depKey] of Object.entries(sortDef.dependencies)) {
            if (!draft.dependencies[depKey]) {
                canPreview = false;
                break;
            }
        }
        for (const [attrName] of Object.entries(sortDef.attributes)) {
            if (draft.data[attrName] === undefined) {
                canPreview = false;
                break;
            }
        }
        if (!canPreview) return;

        try {
            const tempArt = new Artefact(
                '__preview__',
                draft.sortName,
                draft.dependencies,
                draft.data,
                sortDef.drawFunction,
                draft.layerId
            );
            tempArt.draw(svgContext! as unknown as D3Context, undefined, undefined, sortDef, (n) => sortStore.getSort(n));
            if (tempArt.svgElement) {
                tempArt.svgElement.attr('opacity', 0.7);
            }
        } catch (e) {
            // Ignore preview errors if draft incomplete
        }
    }

    function redraw(): void {
        if (!svgContext) return;
        svgContext.selectAll('*').remove();
        drawing.draw(svgContext as unknown as D3Context);
        drawDraftPreview();
    }

    function onSvgClick(event: MouseEvent): void {
        if (ui.positionPicker) {
            event.stopPropagation();
            const coords = d3.pointer(event, svgContext!.node());
            applyPickedPosition(Math.round(coords[0]), Math.round(coords[1]));
        }
    }

    onMount(() => {
        svgContext = d3.select(svgElement);
        svgContext.on('click', onSvgClick);
        svgReady = true;
    });
</script>

<svg id="canvas" width="800" height="800" bind:this={svgElement}></svg>
