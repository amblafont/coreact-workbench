<script lang="ts">
    import { onMount, untrack } from 'svelte';
    import * as d3 from 'd3';
    import { Artefact, getAttributeType } from '../index.svelte.ts';
    import type { D3Context } from '../types';
    import {
        getDrawing,
        sortStore,
        ui,
        applyPickedPosition,
        mergeBaseOpacityFor
    } from './store.svelte.ts';

    const VIEW_BOUNDS = { min: 0.05, max: 20 };
    const FIT_PADDING = 80;

    let svgElement!: SVGSVGElement;
    let worldGroup!: SVGGElement;
    let svgContext: d3.Selection<SVGSVGElement, unknown, null, undefined> | null = null;
    let worldSelection: d3.Selection<SVGGElement, unknown, null, undefined> | null = null;
    let contentSelection: d3.Selection<SVGGElement, unknown, null, undefined> | null = null;
    let zoomBehavior: d3.ZoomBehavior<SVGSVGElement, unknown> | null = null;
    let svgReady = $state(false);
    let viewReady = $state(false);
    let zoomLevel = $state(1);
    let fitForDrawing: string | null = null;

    const picking = $derived(ui.positionPicker !== null);

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
        const name = ui.activeDrawingName;
        void name;
        redraw();
        untrack(applyOverlays);
        if (fitForDrawing !== name) {
            fitForDrawing = name;
            fitToContent();
        }
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
        if (!worldSelection) return;
        for (const art of getDrawing().getArtefacts()) {
            if (!art.svgElement) continue;
            const opacity = canvasOpacity(art);
            if (opacity !== null) {
                art.svgElement.attr('opacity', opacity);
            }
        }
    }

    function drawDraftPreview(): void {
        if (!contentSelection) return;
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
            tempArt.draw(contentSelection as unknown as D3Context, undefined, undefined, sortDef, (n) => sortStore.getSort(n));
            if (tempArt.svgElement) {
                tempArt.svgElement.attr('opacity', 0.7);
            }
        } catch (e) {
            // Ignore preview errors if draft incomplete
        }
    }

    function redraw(): void {
        if (!contentSelection) return;
        contentSelection.selectAll('*').remove();
        getDrawing().draw(contentSelection as unknown as D3Context);
        drawDraftPreview();
    }

    function zoomBy(factor: number): void {
        if (zoomBehavior && svgContext) {
            zoomBehavior.scaleBy(svgContext, factor);
        }
    }

    function resetZoom(): void {
        if (zoomBehavior && svgContext) {
            zoomBehavior.transform(svgContext, d3.zoomIdentity);
        }
    }

    function computeContentBounds(): { minX: number; minY: number; maxX: number; maxY: number } | null {
        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;
        let found = false;
        for (const art of getDrawing().getArtefacts()) {
            const sortDef = sortStore.getSort(art.sortName);
            if (!sortDef) continue;
            for (const [attrName, attrType] of Object.entries(sortDef.attributes)) {
                if (getAttributeType(attrType) !== 'position') continue;
                const p = art.data[attrName];
                if (Array.isArray(p) && p.length === 2 && typeof p[0] === 'number' && typeof p[1] === 'number') {
                    found = true;
                    minX = Math.min(minX, p[0]);
                    maxX = Math.max(maxX, p[0]);
                    minY = Math.min(minY, p[1]);
                    maxY = Math.max(maxY, p[1]);
                }
            }
        }
        return found ? { minX, minY, maxX, maxY } : null;
    }

    function clamp(value: number, min: number, max: number): number {
        return Math.min(max, Math.max(min, value));
    }

    function fitToContent(): void {
        if (!zoomBehavior || !svgContext) return;
        const viewW = svgElement.clientWidth;
        const viewH = svgElement.clientHeight;
        const bounds = computeContentBounds();
        if (!bounds || !viewW || !viewH) {
            resetZoom();
            return;
        }
        const spanX = Math.max(bounds.maxX - bounds.minX, 1);
        const spanY = Math.max(bounds.maxY - bounds.minY, 1);
        const cx = (bounds.minX + bounds.maxX) / 2;
        const cy = (bounds.minY + bounds.maxY) / 2;
        const k = clamp(Math.min(viewW / (spanX + 2 * FIT_PADDING), viewH / (spanY + 2 * FIT_PADDING)), VIEW_BOUNDS.min, VIEW_BOUNDS.max);
        const t = d3.zoomIdentity
            .translate(viewW / 2, viewH / 2)
            .scale(k)
            .translate(-cx, -cy);
        zoomBehavior.transform(svgContext, t);
    }

    function onSvgClick(event: MouseEvent): void {
        if (ui.positionPicker) {
            event.stopPropagation();
            if (!worldGroup) return;
            const coords = d3.pointer(event, worldGroup);
            applyPickedPosition(Math.round(coords[0]), Math.round(coords[1]));
        }
    }

    onMount(() => {
        svgContext = d3.select(svgElement);
        worldSelection = d3.select(worldGroup);
        contentSelection = worldSelection.select('#canvas-content');
        zoomBehavior = d3.zoom<SVGSVGElement, unknown>()
            .scaleExtent([VIEW_BOUNDS.min, VIEW_BOUNDS.max])
            .on('zoom', (event: d3.D3ZoomEvent<SVGSVGElement, unknown>) => {
                worldSelection!.attr('transform', event.transform.toString());
                zoomLevel = event.transform.k;
            });
        svgContext.call(zoomBehavior);
        // Disable double-click zoom so it does not surprise the position picker.
        svgContext.on('dblclick.zoom', null);
        svgContext.on('click', onSvgClick);

        svgReady = true;
        viewReady = true;
    });
</script>

<svg
    id="canvas"
    class:crosshair-picking={picking}
    bind:this={svgElement}
>
    <g bind:this={worldGroup}>
        <g id="canvas-content"></g>
    </g>
</svg>

{#if viewReady}
    <div class="canvas-toolbar">
        <button
            class="layer-btn canvas-zoom-btn"
            title="Zoom in"
            aria-label="Zoom in"
            onclick={() => zoomBy(1.3)}
        >+</button>
        <button
            class="layer-btn canvas-zoom-btn"
            title="Zoom out"
            aria-label="Zoom out"
            onclick={() => zoomBy(1 / 1.3)}
        >−</button>
        <span class="canvas-zoom-level">{Math.round(zoomLevel * 100)}%</span>
        <button
            class="layer-btn"
            title="Reset zoom to 100%"
            onclick={resetZoom}
        >Reset</button>
        <button
            class="layer-btn"
            title="Zoom to fit all artefacts"
            onclick={fitToContent}
        >Fit</button>
    </div>
{/if}