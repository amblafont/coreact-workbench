import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import ArtefactMenu from './ArtefactMenu.svelte';
import {
    drawingStore,
    getDrawing,
    isSortConstructible,
    resetInteractionState,
    sortFilterMatches,
    sortStore,
    startDraftForSort,
    toggleEqualityExtend,
    ui
} from './store.svelte.ts';
import { registerDefaultSorts } from '../demo/buildDemo';
import { makeEdge, makeVertex } from '../demo/helpers';

describe('artefact menu sort filter', () => {
    let component: ReturnType<typeof mount> | undefined;

    function buildDrawing(): { v0: ReturnType<typeof makeVertex>; v1: ReturnType<typeof makeVertex> } {
        const v0 = makeVertex(getDrawing(), 'v0');
        const v1 = makeVertex(getDrawing(), 'v1');
        makeEdge(getDrawing(), 'e', v0, v1);
        return { v0, v1 };
    }

    function render(): void {
        component = mount(ArtefactMenu, { target: document.body });
        flushSync();
    }

    function typeInSortFilter(text: string): void {
        const input = document.querySelector<HTMLInputElement>('#artefact-sort-filter-input');
        expect(input).not.toBeNull();
        input!.value = text;
        input!.dispatchEvent(new Event('input', { bubbles: true }));
        flushSync();
    }

    function setConstructibleOnly(checked: boolean): void {
        const input = document.querySelector<HTMLInputElement>('.sort-filter-checkbox input');
        expect(input).not.toBeNull();
        input!.checked = checked;
        input!.dispatchEvent(new Event('change', { bubbles: true }));
        flushSync();
    }

    function sortHeaders(): string[] {
        return [...document.querySelectorAll('h3 > span')]
            .map(span => (span.textContent ?? '').replace(/\s*\(\d+\)$/, ''));
    }

    beforeEach(() => {
        registerDefaultSorts(sortStore);
        drawingStore.clear();
        getDrawing().clear(true);
        resetInteractionState();
        ui.artefactSortFilter = '*';
        ui.constructibleSortsOnly = true;
    });

    afterEach(() => {
        if (component) {
            unmount(component);
            component = undefined;
        }
        document.body.innerHTML = '';
        resetInteractionState();
        ui.artefactSortFilter = '*';
        ui.constructibleSortsOnly = true;
    });

    it('starts with "*" and shows only sorts used by the drawing when cleared', () => {
        buildDrawing();
        render();

        expect(document.querySelector<HTMLInputElement>('#artefact-sort-filter-input')?.value).toBe('*');
        typeInSortFilter('');

        expect(sortHeaders()).toEqual(['Equality', 'Vertex', 'Edge']);
    });

    it('checks the constructible filter by default and hides sorts whose dependencies are missing', () => {
        render();

        expect(document.querySelector<HTMLInputElement>('.sort-filter-checkbox input')?.checked).toBe(true);
        expect(sortHeaders()).toEqual(['Equality', 'Vertex']);

        const v0 = makeVertex(getDrawing(), 'v0');
        const v1 = makeVertex(getDrawing(), 'v1');
        flushSync();

        // Edge needs a Vertex, but Triangle still needs an Edge.
        expect(sortHeaders()).toEqual(['Equality', 'Vertex', 'Edge']);

        makeEdge(getDrawing(), 'e', v0, v1);
        flushSync();

        expect(sortHeaders()).toEqual(sortStore.getAllSorts().map(sort => sort.name));
    });

    it('lists non-constructible sorts when the checkbox is unchecked', () => {
        makeVertex(getDrawing(), 'v0');
        makeVertex(getDrawing(), 'v1');
        render();

        typeInSortFilter('*');
        // Vertex is present, so Edge is constructible, but Triangle (which
        // needs an Edge) is not.
        expect(sortHeaders()).toEqual(['Equality', 'Vertex', 'Edge']);

        setConstructibleOnly(false);

        expect(sortHeaders()).toEqual(sortStore.getAllSorts().map(sort => sort.name));
    });

    it('combines the checkbox with the textbox filter', () => {
        render();
        typeInSortFilter('triangle');
        expect(sortHeaders()).toEqual(['Equality']);

        setConstructibleOnly(false);
        expect(sortHeaders()).toEqual(['Equality', 'Triangle']);
    });

    it('lists every sort with "*", including unused ones', () => {
        buildDrawing();
        render();

        typeInSortFilter('  *  ');

        expect(sortHeaders()).toEqual(sortStore.getAllSorts().map(sort => sort.name));
    });

    it('matches sort names by case-insensitive substring, including unused sorts', () => {
        buildDrawing();
        render();

        typeInSortFilter('VERTEX');
        expect(sortHeaders()).toEqual(['Equality', 'Vertex']);

        typeInSortFilter('square');
        expect(sortHeaders()).toEqual(['Equality', 'Square']);
        expect(document.querySelector('h3 > span')?.parentElement?.textContent).toContain('Equality (0)');
    });

    it('never hides equality artefacts behind the sort filter', () => {
        const { v0, v1 } = buildDrawing();
        getDrawing().newEqualityArtefact([v0, v1], 'root');
        render();

        typeInSortFilter('square');

        expect(sortHeaders()).toEqual(['Equality', 'Square']);
        expect([...document.querySelectorAll('.node-label')].some(el => el.textContent?.includes('v0 = v1'))).toBe(true);
    });

    it('ignores both filters while picking a dependency', () => {
        render();
        const squareSort = sortStore.getSort('Square')!;
        startDraftForSort(squareSort);
        flushSync();

        typeInSortFilter('Square');

        // Edge has no artefacts, so it is not constructible, but it is the
        // dependency that must be picked for Square.
        expect(sortHeaders()).toEqual(['Edge']);
    });

    it('ignores the filter while extending an equality', () => {
        const { v0, v1 } = buildDrawing();
        const equality = getDrawing().newEqualityArtefact([v0, v1], 'root');
        render();
        toggleEqualityExtend(equality);
        flushSync();

        typeInSortFilter('Square');

        expect(sortHeaders()).toEqual(['Equality', 'Vertex']);
    });
});

describe('sort filter matching', () => {
    it('treats empty as used sorts only, "*" as all, and matches substrings case-insensitively', () => {
        expect(sortFilterMatches('Vertex', '', true)).toBe(true);
        expect(sortFilterMatches('Vertex', '', false)).toBe(false);
        expect(sortFilterMatches('Vertex', '   ', false)).toBe(false);
        expect(sortFilterMatches('Vertex', '   ', true)).toBe(true);
        expect(sortFilterMatches('Vertex', '*', false)).toBe(true);
        expect(sortFilterMatches('Vertex', '  *  ', false)).toBe(true);
        expect(sortFilterMatches('Pullback', 'back', false)).toBe(true);
        expect(sortFilterMatches('Pullback', 'BACK', false)).toBe(true);
        expect(sortFilterMatches('Pullback', 'nope', true)).toBe(false);
        expect(sortFilterMatches('Equality', 'nope', false)).toBe(true);
    });
});

describe('constructible sorts', () => {
    it('requires an artefact of each dependency sort', () => {
        registerDefaultSorts(sortStore);
        const vertex = sortStore.getSort('Vertex')!;
        const edge = sortStore.getSort('Edge')!;
        const triangle = sortStore.getSort('Triangle')!;

        expect(isSortConstructible(vertex, new Set())).toBe(true);
        expect(isSortConstructible(edge, new Set())).toBe(false);
        // One vertex satisfies both Edge dependencies (source and target).
        expect(isSortConstructible(edge, new Set(['Vertex']))).toBe(true);
        expect(isSortConstructible(triangle, new Set(['Vertex']))).toBe(false);
        expect(isSortConstructible(triangle, new Set(['Edge']))).toBe(true);
    });
});
