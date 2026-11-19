import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import RuleApplications from './RuleApplications.svelte';
import {
    drawingStore,
    getDrawing,
    setActiveDrawing,
    setRuleGroupExpanded,
    onArtefactNodeClick,
    sortStore,
    ruleNameMatches,
    ui
} from './store.svelte.ts';
import { registerDefaultSorts } from '../demo/buildDemo';
import { makeDrawing, makeVertex } from '../demo/helpers';

describe('RuleApplications layout', () => {
    let component: ReturnType<typeof mount> | undefined;

    function buildRule(name = 'Comp'): void {
        const rule = makeDrawing();
        makeVertex(rule, 'rv');
        rule.addLayer('conclusion', 'Conclusion', 'root');
        rule.setIsRule(true);
        drawingStore.addDrawing(name, rule);
    }

    function buildHost(vertices: number): void {
        for (let i = 0; i < vertices; i++) {
            makeVertex(getDrawing(), `v${i}`);
        }
        drawingStore.addDrawing('Host', getDrawing());
        setActiveDrawing('Host');
    }

    function render(): void {
        component = mount(RuleApplications, { target: document.body });
        flushSync();
    }

    beforeEach(() => {
        registerDefaultSorts(sortStore);
        getDrawing().clear(true);
        drawingStore.clear();
        ui.activeDrawingName = null;
        ui.expandedRuleGroups.clear();
        ui.filterRedundantMatches = false;
        ui.filterNoProgressMatches = false;
        ui.filterSolvesGoalMatches = false;
        ui.ruleFilterArtefacts.clear();
        ui.ruleFilterPicking = false;
        ui.ruleNameFilter = '*';
        ui.computedRuleNameFilter = '*';
    });

    afterEach(() => {
        if (component) {
            unmount(component);
            component = undefined;
        }
        document.body.innerHTML = '';
        ui.expandedRuleGroups.clear();
        ui.activeDrawingName = null;
        ui.filterRedundantMatches = true;
        ui.filterNoProgressMatches = true;
        ui.filterSolvesGoalMatches = false;
        ui.ruleFilterArtefacts.clear();
        ui.ruleFilterPicking = false;
        ui.ruleNameFilter = '';
        ui.computedRuleNameFilter = '';
    });

    it('does not render a rule with no applications', () => {
        buildRule();
        buildHost(0);

        render();

        expect(document.querySelectorAll('.rule-app-group')).toHaveLength(0);
        expect(document.querySelectorAll('.rule-app-row')).toHaveLength(0);
        expect(document.querySelectorAll('.rule-app-name, .rule-name-list li')).toHaveLength(0);
    });

    it('renders a rule with a single application as a flat row', () => {
        buildRule();
        buildHost(1);

        render();

        expect(document.querySelectorAll('.rule-app-group')).toHaveLength(0);
        expect(document.querySelectorAll('.rule-app-row')).toHaveLength(1);
        expect(document.querySelector('.rule-app-name')?.textContent).toContain('Comp');
    });

    it('renders a rule with several applications as a closed collapsible section', () => {
        buildRule();
        buildHost(2);

        render();

        const group = document.querySelector<HTMLDetailsElement>('.rule-app-group');
        expect(group).not.toBeNull();
        expect(group!.open).toBe(false);
        expect(group!.querySelectorAll('.rule-app-row')).toHaveLength(2);
        expect(group!.querySelector('.rule-app-group-count')?.textContent).toBe('2 matches');
    });

    it('only previews a large collapsed rule', () => {
        buildRule();
        buildHost(12);

        render();

        const group = document.querySelector<HTMLDetailsElement>('.rule-app-group');
        expect(group).not.toBeNull();
        expect(group!.open).toBe(false);
        expect(group!.querySelectorAll('.rule-app-row')).toHaveLength(0);
        expect(group!.querySelector('.rule-app-group-count')?.textContent).toBe('more than 10 matches');

        setRuleGroupExpanded('Comp', true);
        flushSync();

        expect(group!.querySelectorAll('.rule-app-row')).toHaveLength(12);
        expect(group!.querySelector('.rule-app-group-count')?.textContent).toBe('12 matches');
    });

    it('shows the artefact picker and restricts the list to picked artefacts', () => {
        buildRule();
        buildHost(2);
        const v0 = getDrawing().getArtefacts()[0];

        render();

        const pickButton = document.querySelector<HTMLButtonElement>('.rule-artefact-filter .pick-dep-btn');
        expect(pickButton).not.toBeNull();
        expect(pickButton!.textContent).toContain('+ Pick Artefact');
        expect(document.querySelectorAll('.rule-app-row')).toHaveLength(2);

        pickButton!.click();
        flushSync();
        expect(ui.ruleFilterPicking).toBe(true);
        expect(pickButton!.textContent).toContain('Click artefacts in tree...');

        onArtefactNodeClick(v0);
        flushSync();
        expect(document.querySelector('.rule-filter-artefacts')?.textContent).toContain('v0');
        expect(document.querySelectorAll('.rule-app-row')).toHaveLength(1);

        pickButton!.click();
        flushSync();
        expect(ui.ruleFilterPicking).toBe(false);
        expect(pickButton!.textContent).toContain('(1)');
    });

    function typeInNameFilter(text: string): void {
        const input = document.querySelector<HTMLInputElement>('#rule-name-filter-input');
        expect(input).not.toBeNull();
        input!.value = text;
        input!.dispatchEvent(new Event('input', { bubbles: true }));
        flushSync();
    }

    function pressEnterInNameFilter(): void {
        document.querySelector<HTMLInputElement>('#rule-name-filter-input')!
            .dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        flushSync();
    }

    it('lists matching rule names only until Enter is pressed', () => {
        buildRule('Comp');
        buildRule('Other');
        buildHost(1);
        render();

        expect(document.querySelectorAll('.rule-app-row')).toHaveLength(2);

        typeInNameFilter('comp');

        expect(ui.ruleNameFilter).toBe('comp');
        expect(ui.computedRuleNameFilter).toBe('*');
        expect(document.querySelectorAll('.rule-app-row')).toHaveLength(0);
        expect([...document.querySelectorAll('.rule-name-list li')].map(li => li.textContent)).toEqual(['Comp']);
        expect(document.querySelector('.rule-name-filter .rule-filter-hint')?.textContent).toContain('press Enter');
        expect(document.querySelector('.rule-name-filter button')).toBeNull();

        pressEnterInNameFilter();

        expect(ui.computedRuleNameFilter).toBe('comp');
        expect(document.querySelectorAll('.rule-name-list li')).toHaveLength(0);
        expect(document.querySelectorAll('.rule-app-row')).toHaveLength(1);
        expect(document.querySelector('.rule-app-name')?.textContent).toContain('Comp');
    });

    it('commits the filter when Enter is pressed in the textbox', () => {
        buildRule('Comp');
        buildRule('Other');
        buildHost(1);
        render();

        typeInNameFilter('OTHER');
        expect(document.querySelectorAll('.rule-app-row')).toHaveLength(0);
        expect([...document.querySelectorAll('.rule-name-list li')].map(li => li.textContent)).toEqual(['Other']);

        pressEnterInNameFilter();

        expect(ui.computedRuleNameFilter).toBe('OTHER');
        expect(document.querySelectorAll('.rule-app-row')).toHaveLength(1);
        expect(document.querySelector('.rule-app-name')?.textContent).toContain('Other');
    });

    it('shows no names for an empty filter and all names for "*"', () => {
        buildRule('Comp');
        buildRule('Other');
        buildHost(1);
        render();

        typeInNameFilter('');
        expect(document.querySelectorAll('.rule-name-list li')).toHaveLength(0);
        expect(document.querySelector('.rule-name-empty')?.textContent).toContain('No rules match');
        expect(document.querySelectorAll('.rule-app-row')).toHaveLength(0);

        // Commit the empty filter first, so typing '*' becomes a pending edit.
        pressEnterInNameFilter();
        typeInNameFilter('*');
        expect([...document.querySelectorAll('.rule-name-list li')].map(li => li.textContent)).toEqual(['Comp', 'Other']);
    });
});

describe('rule name filter matching', () => {
    it('treats empty as none, "*" as all, and otherwise matches case-insensitively', () => {
        expect(ruleNameMatches('Comp', '')).toBe(false);
        expect(ruleNameMatches('Comp', '   ')).toBe(false);
        expect(ruleNameMatches('Comp', 'nomatch')).toBe(false);
        expect(ruleNameMatches('Comp', '*')).toBe(true);
        expect(ruleNameMatches('Comp', '  *  ')).toBe(true);
        expect(ruleNameMatches('Composable Edges', 'posable')).toBe(true);
        expect(ruleNameMatches('Composable Edges', 'POSABLE')).toBe(true);
    });
});
