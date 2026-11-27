import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import HrxImportModal from './HrxImportModal.svelte';
import { drawingStore, sortStore, ui } from './store.svelte.ts';
import { registerDefaultSorts } from '../default_sorts/index.ts';
import { analyseHrxArchive, loadHrxArchive } from '../hrx/load.ts';
import { parseHrx, serializeHrx } from '../hrx/codec.ts';

const EXAMPLE = readFileSync(resolve(process.cwd(), 'examples/newformat.hrx'), 'utf8');

function group(title: string): HTMLElement {
    const headings = Array.from(document.querySelectorAll('.hrx-group-title')) as HTMLElement[];
    const heading = headings.find(element => element.textContent?.includes(title));
    if (!heading) throw new Error(`Group not found: ${title}`);
    return heading.parentElement as HTMLElement;
}

function buttonIn(container: HTMLElement, label: string): HTMLButtonElement {
    const button = Array.from(container.querySelectorAll('button'))
        .find(element => element.textContent?.trim() === label);
    if (!button) throw new Error(`Button not found: ${label}`);
    return button as HTMLButtonElement;
}

function actionButton(label: string): HTMLButtonElement {
    const actions = document.querySelector('.modal-actions') as HTMLElement;
    return buttonIn(actions, label);
}

function namedRow(name: string): HTMLElement {
    const row = Array.from(document.querySelectorAll('.hrx-row'))
        .find(element => element.textContent?.includes(name)) as HTMLElement | undefined;
    if (!row) throw new Error(`Row not found: ${name}`);
    return row;
}

function sortRow(name: string): HTMLElement {
    return namedRow(name);
}

function hasButton(container: HTMLElement, label: string): boolean {
    return Array.from(container.querySelectorAll('button')).some(element => element.textContent?.trim() === label);
}

/**
 * Same sorts as the example, but with a changed Vertex source, weaker Triangle
 * equations, and an exact Triangle source so only Vertex can be replaced.
 */
function archiveWithDifferences(): string {
    const sections = parseHrx(EXAMPLE).sections;
    const records = JSON.parse(sections.get('sorts.json')!);
    const triangle = sortStore.getSort('Triangle')!;
    records.push({
        name: 'Triangle',
        data: triangle.attributes,
        deps: triangle.dependencies,
        equations: []
    });
    sections.set('sorts.json', JSON.stringify(records));
    sections.set('sorts/Vertex.js', `${sections.get('sorts/Vertex.js')}\n// changed\n`);
    sections.set('sorts/Triangle.js', sortStore.getSortSource('Triangle')!.drawBody);
    return serializeHrx(sections);
}

function modifiedDrawingArchive(mutate: (drawing: Record<string, any>) => void): string {
    const sections = parseHrx(EXAMPLE).sections;
    const payload = JSON.parse(sections.get('drawings.json')!);
    mutate(payload.drawings[0]);
    sections.set('drawings.json', JSON.stringify(payload));
    return serializeHrx(sections);
}

function archiveWithDrawingDataChange(): string {
    return modifiedDrawingArchive(drawing => {
        drawing.artefacts[0].data.position = [999, 999];
    });
}

function archiveWithDifferentDrawing(): string {
    return modifiedDrawingArchive(drawing => {
        drawing.artefacts.pop();
    });
}

function emptyArchive(): string {
    const sections = parseHrx(EXAMPLE).sections;
    sections.set('sorts.json', '[]\n');
    sections.set('drawings.json', '{"drawings":[]}\n');
    return serializeHrx(sections);
}

function subsectionElements(title: string): Element[] {
    const headings = Array.from(document.querySelectorAll('.hrx-subtitle'));
    const heading = headings.find(element => element.textContent?.includes(title));
    if (!heading) throw new Error(`Subsection not found: ${title}`);
    const children = Array.from(heading.parentElement!.children);
    const start = children.indexOf(heading) + 1;
    const end = children.findIndex((element, index) => index > start && element.classList.contains('hrx-subtitle'));
    return children.slice(start, end === -1 ? children.length : end);
}

function archiveWithOnlyUnchangedSorts(): string {
    const sections = parseHrx(EXAMPLE).sections;
    for (const name of ['Vertex', 'Edge']) {
        sections.set(`sorts/${name}.js`, sortStore.getSortSource(name)!.drawBody);
    }
    return serializeHrx(sections);
}

function archiveWithIncompatibleEquations(): string {
    const sections = parseHrx(EXAMPLE).sections;
    const records = JSON.parse(sections.get('sorts.json')!);
    const triangle = sortStore.getSort('Triangle')!;
    records.push({
        name: 'Triangle',
        data: triangle.attributes,
        deps: triangle.dependencies,
        equations: ['1.source = 1.target']
    });
    sections.set('sorts.json', JSON.stringify(records));
    sections.set('sorts/Triangle.js', sortStore.getSortSource('Triangle')!.drawBody);
    return serializeHrx(sections);
}

describe('HRX import preview dialog', () => {
    let component: ReturnType<typeof mount> | undefined;

    function render(): void {
        component = mount(HrxImportModal, { target: document.body });
        flushSync();
    }

    function open(text: string = EXAMPLE): void {
        ui.hrxImport = {
            fileName: 'drawings.hrx',
            text,
            plan: analyseHrxArchive(text, sortStore, drawingStore, { ui: true })
        };
    }

    beforeEach(() => {
        sortStore.clear();
        registerDefaultSorts(sortStore);
        drawingStore.clear();
        ui.hrxImport = null;
        ui.toasts = [];
    });

    afterEach(() => {
        if (component) {
            unmount(component);
            component = undefined;
        }
        document.body.innerHTML = '';
        ui.hrxImport = null;
    });

    it('groups the four kinds of rows and shows their defaults', () => {
        open();
        render();

        expect(Array.from(document.querySelectorAll('.hrx-group-title')).map(element => element.textContent?.trim())).toEqual([
            'Sorts already in the workspace (2)',
            'Drawings to add (1)'
        ]);
        expect(document.body.textContent).not.toContain('None in this archive.');

        const existingSorts = group('Sorts already in the workspace');
        expect(existingSorts.textContent).toContain('Vertex');
        expect(existingSorts.textContent).toContain('Edge');
        expect(hasButton(existingSorts, 'Keep equations')).toBe(false);
        expect(buttonIn(existingSorts, 'Replace draw functions').getAttribute('aria-pressed')).toBe('false');

        const newDrawings = group('Drawings to add');
        expect(newDrawings.textContent).toContain('Example');
        expect(buttonIn(newDrawings, 'Add').getAttribute('aria-pressed')).toBe('true');
        expect(newDrawings.querySelector('input')).toBeNull();
    });

    it('hides all sections and shows a neutral message for an empty archive', () => {
        open(emptyArchive());
        render();

        expect(document.querySelector('.hrx-group-title')).toBeNull();
        expect(document.querySelector('.hrx-subtitle')).toBeNull();
        expect(document.body.textContent).toContain('Nothing to import.');
        expect(actionButton('Import').disabled).toBe(false);
    });

    it('collapses existing sorts with nothing to decide into one line', () => {
        open(archiveWithOnlyUnchangedSorts());
        render();

        const existingSorts = group('Sorts already in the workspace');
        expect(existingSorts.querySelector('.hrx-compact')?.textContent?.trim()).toBe('Vertex, Edge');
        expect(existingSorts.querySelector('.hrx-row')).toBeNull();
        expect(existingSorts.querySelector('button')).toBeNull();
    });

    it('shows and updates only the toggles whose values actually differ', () => {
        open(archiveWithDifferences());
        render();

        const vertex = sortRow('Vertex');
        expect(hasButton(vertex, 'Keep equations')).toBe(false);
        const replace = buttonIn(vertex, 'Replace draw functions');
        expect(replace.getAttribute('aria-pressed')).toBe('false');
        replace.click();
        flushSync();
        expect(replace.getAttribute('aria-pressed')).toBe('true');
        expect(ui.hrxImport!.plan.sorts.find(row => row.name === 'Vertex')!.replaceDrawFunctions).toBe(true);

        const triangle = sortRow('Triangle');
        expect(hasButton(triangle, 'Replace draw functions')).toBe(false);
        const keep = buttonIn(triangle, 'Keep equations');
        expect(keep.textContent?.trim()).toBe('Keep equations');
        expect(keep.getAttribute('title')).toMatch(/weaker/);
        expect(keep.getAttribute('aria-pressed')).toBe('true');
        expect(document.body.textContent).not.toContain('Existing stronger equations are kept');
        keep.click();
        flushSync();
        expect(keep.getAttribute('aria-pressed')).toBe('false');
        expect(ui.hrxImport!.plan.sorts.find(row => row.name === 'Triangle')!.keepEquations).toBe(false);
        expect(document.body.textContent).not.toContain('Existing stronger equations are kept');

        const skip = buttonIn(group('Drawings to add'), 'Skip');
        skip.click();
        flushSync();
        expect(skip.getAttribute('aria-pressed')).toBe('true');
        expect(ui.hrxImport!.plan.drawings[0].decision).toBe('skip');
        expect(actionButton('Import').disabled).toBe(false);
    });

    it('hides the equation toggle when the equations are incompatible', () => {
        open(archiveWithIncompatibleEquations());
        render();

        const triangle = sortRow('Triangle');
        expect(triangle.textContent).toContain('different dependencies, data fields, or equations');
        expect(hasButton(triangle, 'Keep equations')).toBe(false);
        expect(hasButton(triangle, 'Replace draw functions')).toBe(false);
        expect(actionButton('Import').disabled).toBe(true);
    });

    it('shows identical drawings as a compact, always-skipped line', () => {
        loadHrxArchive(EXAMPLE, sortStore, drawingStore);
        open();
        render();

        const existing = group('Drawings already in the workspace');
        expect(existing.textContent).toContain('Identical (skipped)');
        expect(existing.querySelector('.hrx-compact')?.textContent?.trim()).toBe('Example');
        expect(existing.querySelector('.hrx-row')).toBeNull();
        expect(existing.querySelector('button')).toBeNull();
        expect(ui.hrxImport!.plan.drawings[0]).toMatchObject({ collision: 'duplicate', decision: 'skip' });
    });

    it('distinguishes drawings whose data differs and defaults to Skip', () => {
        loadHrxArchive(EXAMPLE, sortStore, drawingStore);
        open(archiveWithDrawingDataChange());
        render();

        expect(subsectionElements('Only data differs').map(element => element.textContent).join(' '))
            .toContain('Example');
        const row = namedRow('Example');
        expect(buttonIn(row, 'Skip').getAttribute('aria-pressed')).toBe('true');
        expect(hasButton(row, 'Replace')).toBe(true);
        expect(hasButton(row, 'Rename')).toBe(true);

        buttonIn(row, 'Rename').click();
        flushSync();
        const input = row.querySelector('input') as HTMLInputElement;
        expect(input).toBeTruthy();
        input.value = 'My copy';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        flushSync();
        expect(ui.hrxImport!.plan.drawings[0].renameTo).toBe('My copy');
    });

    it('distinguishes structurally different drawings', () => {
        loadHrxArchive(EXAMPLE, sortStore, drawingStore);
        open(archiveWithDifferentDrawing());
        render();

        expect(Array.from(document.querySelectorAll('.hrx-subtitle')).map(element => element.textContent?.trim()))
            .toEqual(['Different structure']);
        expect(subsectionElements('Different structure').map(element => element.textContent).join(' '))
            .toContain('Example');
        const row = namedRow('Example');
        expect(buttonIn(row, 'Skip').getAttribute('aria-pressed')).toBe('true');
        expect(hasButton(row, 'Replace')).toBe(true);
        expect(hasButton(row, 'Rename')).toBe(true);
    });

    it('shows error reasons and disables Import while an error blocks the archive', () => {
        const sections = parseHrx(EXAMPLE).sections;
        sections.delete('sorts/Edge.js');
        open(serializeHrx(sections));
        render();

        expect(document.body.textContent).toContain('has no sorts/Edge.js section');
        expect(actionButton('Import').disabled).toBe(true);
        const edgeRow = sortRow('Edge');
        expect(hasButton(edgeRow, 'Keep equations')).toBe(false);
        expect(buttonIn(edgeRow, 'Replace draw functions').disabled).toBe(true);
    });

    it('commits the plan on Import and closes on Cancel', () => {
        open();
        render();
        actionButton('Import').click();
        flushSync();
        expect(ui.hrxImport).toBeNull();
        expect(drawingStore.getDrawing('Example')).toBeDefined();

        open();
        flushSync();
        actionButton('Cancel').click();
        flushSync();
        expect(ui.hrxImport).toBeNull();
        expect(drawingStore.getDrawing('Example (1)')).toBeUndefined();
    });
});
