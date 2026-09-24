import { describe, it, expect } from 'vitest';
import { AbellaRecorder } from '../abella_recording.svelte.ts';
import { Drawing, DrawingStore, findFirstOrderRuleApplications, applyFirstOrderRule, findSecondOrderRuleApplications, applySecondOrderRule } from '../index.svelte.ts';
import { newSortStore, makeVertex, makeEdge, buildComposableHost, buildComposableEdgesRule, buildChildEqRule } from './helpers';

describe('abella recording', () => {
    it('records a rule application and closes with proof recording', () => {
        const sortStore = newSortStore();
        const store = new DrawingStore();

        const { host } = buildComposableHost();
        store.addDrawing('MainDrawing', host);

        const { rule } = buildComposableEdgesRule();
        store.addDrawing('Foo', rule);

        const recorder = new AbellaRecorder();
        recorder.start(host, 'MainDrawing', sortStore);
        const apps = findFirstOrderRuleApplications(rule, host);
        expect(apps.length).toBe(1);
        const created = applyFirstOrderRule(rule, host, apps[0]);
        recorder.recordRuleApply(rule, 'Foo', apps[0], host, created, 'MainDrawing', sortStore);
        recorder.recordProveSuccess(host, null, null, 'MainDrawing');
        const script = recorder.stop();

        expect(script.startsWith('Theorem MainDrawing_rule : forall hv0 hv1 hv2 he1 he2, vertex hv0 -> vertex hv1 -> vertex hv2 -> edge hv0 hv1 he1 -> edge hv1 hv2 he2 -> True.')).toBe(true);
        expect(script).toContain('intros hv0 hv1 hv2 he1 he2.');
        expect(script).toContain('apply Foo_rule to hv0 hv1 hv2 he1 he2.');
        expect(script).toContain('assert (exists re3, edge hv0 hv2 re3).');
        expect(script).toContain('case H1.');
        expect(script.trim().endsWith('search.')).toBe(true);
        expect(script).not.toContain('skip.');
    });

    it('starts an unproved recording with intros and closes with skip', () => {
        const sortStore = newSortStore();
        const host = new Drawing(sortStore);
        makeVertex(host, 'a');
        makeVertex(host, 'b');

        const recorder = new AbellaRecorder();
        recorder.start(host, 'MainDrawing', sortStore);
        const script = recorder.stop();

        expect(script.startsWith('Theorem MainDrawing_rule : forall a b, vertex a -> vertex b -> True.')).toBe(true);
        expect(script).toContain('intros a b.');
        expect(script.trim().endsWith('skip.')).toBe(true);
    });

    it('records an image rename on the dependent relation', () => {
        const sortStore = newSortStore();
        const host = new Drawing(sortStore);
        makeVertex(host, 'a');

        const recorder = new AbellaRecorder();
        recorder.start(host, 'MainDrawing', sortStore);
        recorder.recordRename('a', 'a2', 'MainDrawing');
        const script = recorder.stop();

        expect(script).toContain('rename a to a2.');
    });

    it('records a vertex duplication as assert, search and rename', () => {
        const sortStore = newSortStore();
        const host = new Drawing(sortStore);
        const a = makeVertex(host, 'a');

        const recorder = new AbellaRecorder();
        recorder.start(host, 'MainDrawing', sortStore);

        const { artefact: a2 } = host.duplicateArtefact(a, {}, { position: [100, 100], label: 'a_copy' }, 'root');
        recorder.recordDuplicate(host, a, a2, 'MainDrawing', sortStore);

        const script = recorder.stop();
        expect(script).toContain('assert (vertex a).');
        expect(script).toContain('search.');
        expect(script).toContain('rename H1 to a_copy.');
    });

    it('records an edge duplication as assert on the full relation', () => {
        const sortStore = newSortStore();
        const host = new Drawing(sortStore);
        const a = makeVertex(host, 'a');
        const b = makeVertex(host, 'b');
        const f = makeEdge(host, 'f', a, b);

        const recorder = new AbellaRecorder();
        recorder.start(host, 'MainDrawing', sortStore);

        const { artefact: f2 } = host.duplicateArtefact(f, { source: a, target: b }, { width: 2, bend: 0, label: 'f_copy' }, 'root');
        recorder.recordDuplicate(host, f, f2, 'MainDrawing', sortStore);

        const script = recorder.stop();
        expect(script).toContain('assert (edge a b f).');
        expect(script).toContain('rename H1 to f_copy.');
    });

    it('inlines an unproved second-order premise as an assert sub-proof', () => {
        const sortStore = newSortStore();
        const store = new DrawingStore();

        const host = new Drawing(sortStore);
        makeVertex(host, 'a');
        makeVertex(host, 'b');
        store.addDrawing('MainDrawing', host);

        const rule = new Drawing(sortStore);
        const rx = makeVertex(rule, 'x');
        const ry = makeVertex(rule, 'y');
        rule.addLayer('premise-1', 'Premise', 'root');
        makeEdge(rule, 'pe', rx, ry, 'premise-1');
        rule.addLayer('premise-1-child', 'Premise Child', 'premise-1');
        makeEdge(rule, 'pce', rx, ry, 'premise-1-child');
        rule.addLayer('conclusion', 'Conclusion', 'root');
        makeEdge(rule, 'ce', rx, ry, 'conclusion');
        rule.setIsRule(true);
        store.addDrawing('SecondOrderRule', rule);

        const recorder = new AbellaRecorder();
        recorder.start(host, 'MainDrawing', sortStore);
        const apps = findSecondOrderRuleApplications(rule, host);
        expect(apps.length).toBeGreaterThan(0);
        const result = applySecondOrderRule(rule, host, apps[0], { hostName: 'MainDrawing', ruleName: 'SecondOrderRule' });
        const sub = result.derivedRules[0];
        recorder.recordRuleApply(
            rule,
            'SecondOrderRule',
            apps[0],
            host,
            { artefacts: result.hostArtefacts, created: result.hostCreated, derived: result.derivedRules },
            'MainDrawing',
            sortStore
        );

        recorder.recordRename('pe', 'pf', sub.name);
        const script = recorder.stop();

        expect(script.startsWith('Theorem MainDrawing_rule : forall a b, vertex a -> vertex b -> True.')).toBe(true);
        expect(script).toContain('intros a b.');
        expect(script).toContain('assert (forall pe, edge a b pe -> exists pce, edge a b pce).');
        expect(script).toContain('intros pe.');
        expect(script).toContain('apply SecondOrderRule_rule to a b H1.');
        expect(script).toContain('rename pe to pf.');
        // The subgoal is never proved, so both levels degrade to skip.
        const skipCount = script.split('skip.').length - 1;
        expect(skipCount).toBeGreaterThanOrEqual(2);
    });

    it('ignores equalities while destructuring an apply in the exported script', () => {
        const sortStore = newSortStore();
        const store = new DrawingStore();

        const { host } = buildComposableHost();
        store.addDrawing('MainDrawing', host);

        const rule = buildChildEqRule();
        store.addDrawing('ChildEqRule', rule);

        const recorder = new AbellaRecorder();
        recorder.start(host, 'MainDrawing', sortStore);
        const apps = findFirstOrderRuleApplications(rule, host);
        expect(apps.length).toBe(1);
        const created = applyFirstOrderRule(rule, host, apps[0]);
        recorder.recordRuleApply(rule, 'ChildEqRule', apps[0], host, created, 'MainDrawing', sortStore);
        const script = recorder.stop();

        expect(script).toContain('apply ChildEqRule_rule to hv0 hv1 hv2 he1 he2.');
        expect(script).toContain('case H1.');
        expect(script).not.toMatch(/rename H\d+ to eq_/);
        const renames = script.match(/rename H\d+ to [A-Za-z0-9_]+\./g) ?? [];
        expect(renames).toHaveLength(0);
    });
});