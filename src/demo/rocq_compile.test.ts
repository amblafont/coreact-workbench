import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import {
    Drawing,
    DrawingStore,
    findFirstOrderRuleApplications,
    findSecondOrderRuleApplications,
    applyFirstOrderRule,
    applySecondOrderRule,
    type Artefact,
    type RuleApplication,
    type SortStore
} from '../index.svelte.ts';
import { exportDrawingsToRocq } from '../rocq_export';
import { RocqRecorder } from '../rocq_recording';
import { newSortStore, makeVertex, makeEdge, buildIsMonoOnlyConclusionRule } from './helpers';
import { getFirstOrderStatementChildLayer } from '../index.svelte.ts';

const rocqAvailable = ((): boolean => {
    try {
        const result = spawnSync('rocq', ['--version'], { encoding: 'utf8', timeout: 30000 });
        return result.status === 0;
    } catch {
        return false;
    }
})();

type ApplyResult = { artefacts: Artefact[]; created: Map<Artefact, Artefact> };

interface BuiltScenario {
    host: Drawing;
    rule: Drawing;
    ruleName: string;
    secondOrder: boolean;
    apps: RuleApplication[];
}

function recordScenario(sortStore: SortStore, scenario: BuiltScenario): string {
    const store = new DrawingStore();
    store.saveDrawing('Main', scenario.host);
    store.saveDrawing(scenario.ruleName, scenario.rule);
    const recorder = new RocqRecorder();
    recorder.start(scenario.host, 'Main', sortStore);
    let applyResult: ApplyResult;
    if (scenario.secondOrder) {
        const result = applySecondOrderRule(scenario.rule, scenario.host, scenario.apps[0], { hostName: 'Main', ruleName: scenario.ruleName });
        applyResult = { artefacts: result.hostArtefacts, created: result.hostCreated };
    } else {
        applyResult = applyFirstOrderRule(scenario.rule, scenario.host, scenario.apps[0]);
    }
    recorder.recordRuleApply(scenario.rule, scenario.ruleName, scenario.apps[0], scenario.host, applyResult, 'Main', sortStore);
    recorder.recordProveSuccess(scenario.host, null, null, 'Main');
    const script = recorder.stop();
    return exportDrawingsToRocq(store.getAllDrawings(), sortStore) + '\n' + script;
}

function buildSingleEqConclusion(sortStore: SortStore): BuiltScenario {
    const host = new Drawing(sortStore);
    makeVertex(host, 'a');
    makeVertex(host, 'b');
    const rule = new Drawing(sortStore);
    const rx = makeVertex(rule, 'x');
    const ry = makeVertex(rule, 'y');
    rule.addLayer('conclusion', 'Conclusion', 'root');
    rule.newEqualityArtefact([rx, ry], 'conclusion');
    rule.setIsRule(true);
    const apps = findFirstOrderRuleApplications(rule, host);
    if (apps.length === 0) {
        throw new Error('EqConclusionRule produced no applications');
    }
    return { host, rule, ruleName: 'EqConclusionRule', secondOrder: false, apps };
}

function buildMultiEqConclusion(sortStore: SortStore): BuiltScenario {
    const host = new Drawing(sortStore);
    const ma = makeVertex(host, 'a');
    const mb = makeVertex(host, 'b');
    makeEdge(host, 'g', ma, mb);
    host.newEqualityArtefact([ma, mb], 'root');
    const rule = new Drawing(sortStore);
    const rx = makeVertex(rule, 'x');
    const ry = makeVertex(rule, 'y');
    rule.addLayer('conclusion', 'Conclusion', 'root');
    rule.newArtefact('Edge', { source: rx, target: ry }, { width: 2, bend: 0, label: 'f' }, 'conclusion');
    rule.newEqualityArtefact([rx, ry], 'conclusion');
    rule.setIsRule(true);
    const apps = findFirstOrderRuleApplications(rule, host);
    if (apps.length === 0) {
        throw new Error('FooEq produced no applications');
    }
    return { host, rule, ruleName: 'FooEq', secondOrder: false, apps };
}

function buildTriEqRoot(sortStore: SortStore): BuiltScenario {
    const host = new Drawing(sortStore);
    const ha = makeVertex(host, 'a');
    const hb = makeVertex(host, 'b');
    const hc = makeVertex(host, 'c');
    host.newEqualityArtefact([ha, hb, hc], 'root');
    const rule = new Drawing(sortStore);
    const rx = makeVertex(rule, 'x');
    const ry = makeVertex(rule, 'y');
    const rz = makeVertex(rule, 'z');
    rule.newEqualityArtefact([rx, ry, rz], 'root');
    rule.addLayer('conclusion', 'Conclusion', 'root');
    makeEdge(rule, 'f', rx, rz, 'conclusion');
    rule.setIsRule(true);
    const apps = findFirstOrderRuleApplications(rule, host);
    if (apps.length === 0) {
        throw new Error('TriEqRoot produced no applications');
    }
    return { host, rule, ruleName: 'TriEqRoot', secondOrder: false, apps };
}

function buildSecondOrder(sortStore: SortStore): BuiltScenario {
    const host = new Drawing(sortStore);
    makeVertex(host, 'a');
    makeVertex(host, 'b');
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
    const apps = findSecondOrderRuleApplications(rule, host);
    if (apps.length === 0) {
        throw new Error('SecondOrderRule produced no applications');
    }
    return { host, rule, ruleName: 'SecondOrderRule', secondOrder: true, apps };
}

function buildProvableChild(sortStore: SortStore): Drawing {
    const host = new Drawing(sortStore);
    const a = makeVertex(host, 'a');
    const b = makeVertex(host, 'b');
    const c = makeVertex(host, 'c');
    makeEdge(host, 'e1', a, b);
    makeEdge(host, 'e2', b, c);
    host.newEqualityArtefact([a, b], 'root');
    host.newEqualityArtefact([b, c], 'root');
    host.addLayer('child', 'Child Layer', 'root');
    makeEdge(host, 'g1', a, b, 'child');
    makeEdge(host, 'g2', b, c, 'child');
    host.newEqualityArtefact([a, b, c], 'child');
    return host;
}

function buildIsMonoOnlyConclusion(sortStore: SortStore): BuiltScenario {
    const host = new Drawing(sortStore);
    const hv0 = makeVertex(host, 'hv0');
    const hv1 = makeVertex(host, 'hv1');
    const hv2 = makeVertex(host, 'hv2');
    makeEdge(host, 'he1', hv0, hv1);
    makeEdge(host, 'he2', hv1, hv2);
    const rule = buildIsMonoOnlyConclusionRule();
    const apps = findFirstOrderRuleApplications(rule, host);
    if (apps.length === 0) {
        throw new Error('FlagOnlyRule produced no applications');
    }
    return { host, rule, ruleName: 'FlagOnlyRule', secondOrder: false, apps };
}

describe.skipIf(!rocqAvailable)('rocq export compiles', () => {
    let dir: string;

    beforeAll(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rocq-compile-'));
    });

    afterAll(() => {
        if (dir) {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    function compile(name: string, code: string): void {
        const file = path.join(dir, `${name}.v`);
        fs.writeFileSync(file, code);
        const result = spawnSync('rocq', ['compile', file], { encoding: 'utf8', timeout: 120000 });
        expect(result.status, `rocq failed for ${name}:\n${result.stderr}\n---\n${code}`).toBe(0);
    }

    it.each([
        { name: 'single_eq_conclusion', build: buildSingleEqConclusion },
        { name: 'multi_eq_conclusion', build: buildMultiEqConclusion },
        { name: 'tri_eq_root', build: buildTriEqRoot },
        { name: 'second_order', build: buildSecondOrder },
        { name: 'isMono_only_conclusion', build: buildIsMonoOnlyConclusion }
    ])('compiles $name', ({ name, build }) => {
        const sortStore = newSortStore();
        compile(name, recordScenario(sortStore, build(sortStore)));
    });

    it('compiles a host whose second-order subgoal derived drawing is proved for real', () => {
        const sortStore = newSortStore();
        const store = new DrawingStore();

        const host = new Drawing(sortStore);
        makeVertex(host, 'a');
        makeVertex(host, 'b');
        store.saveDrawing('Main', host);

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
        store.saveDrawing('SecondOrderRule', rule);

        const recorder = new RocqRecorder();
        recorder.start(host, 'Main', sortStore);

        const apps = findSecondOrderRuleApplications(rule, host);
        if (apps.length === 0) {
            throw new Error('SecondOrderRule produced no applications');
        }
        const result = applySecondOrderRule(rule, host, apps[0], { hostName: 'Main', ruleName: 'SecondOrderRule' });
        const sub = result.derivedRules[0];
        const childLayer = getFirstOrderStatementChildLayer(sub.drawing);
        if (!childLayer) {
            throw new Error('derived drawing has no first-order statement child layer');
        }
        const prove = sub.drawing.checkLayerProvable(childLayer.id);
        if (!prove.provable) {
            throw new Error('derived Goal layer not provable: ' + (prove.reason ?? 'unknown'));
        }

        recorder.recordRuleApply(
            rule,
            'SecondOrderRule',
            apps[0],
            host,
            { artefacts: result.hostArtefacts, created: result.hostCreated, derivedNames: result.derivedRules.map(d => d.name), derived: result.derivedRules },
            'Main',
            sortStore
        );
        recorder.recordProveSuccess(sub.drawing, childLayer.id, prove.match ?? null, sub.name);
        recorder.recordProveSuccess(host, null, null, 'Main');
        const script = recorder.stop();

        expect(script).not.toContain('Admitted.');
        expect(script).toContain('exact pe.');
        compile('proven_subgoal', exportDrawingsToRocq(store.getAllDrawings(), sortStore) + '\n' + script);
    });

    it('compiles an inlined subgoal proof with extra host context', () => {
        const sortStore = newSortStore();
        const store = new DrawingStore();

        const host = new Drawing(sortStore);
        const ha = makeVertex(host, 'a');
        const hb = makeVertex(host, 'b');
        makeVertex(host, 'c');
        store.saveDrawing('Main', host);

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
        store.saveDrawing('SecondOrderRule', rule);

        const recorder = new RocqRecorder();
        recorder.start(host, 'Main', sortStore);

        const apps = findSecondOrderRuleApplications(rule, host);
        if (apps.length === 0) {
            throw new Error('SecondOrderRule produced no applications');
        }
        const app = apps.find(a => a.matchedArtefacts.get(rx) === ha && a.matchedArtefacts.get(ry) === hb) ?? apps[0];
        const result = applySecondOrderRule(rule, host, app, { hostName: 'Main', ruleName: 'SecondOrderRule' });
        const sub = result.derivedRules[0];
        const childLayer = getFirstOrderStatementChildLayer(sub.drawing);
        if (!childLayer) {
            throw new Error('derived drawing has no first-order statement child layer');
        }
        const prove = sub.drawing.checkLayerProvable(childLayer.id);
        if (!prove.provable) {
            throw new Error('derived Goal layer not provable: ' + (prove.reason ?? 'unknown'));
        }

        recorder.recordRuleApply(
            rule,
            'SecondOrderRule',
            app,
            host,
            { artefacts: result.hostArtefacts, created: result.hostCreated, derivedNames: result.derivedRules.map(d => d.name), derived: result.derivedRules },
            'Main',
            sortStore
        );
        recorder.recordProveSuccess(sub.drawing, childLayer.id, prove.match ?? null, sub.name);
        recorder.recordProveSuccess(host, null, null, 'Main');
        const script = recorder.stop();

        expect(script).not.toContain('Lemma Main___SecondOrderRule___Premise_rule :');
        expect(script).toContain('assert (Hpremise1 : forall (pe : Edge a b), Edge a b). {');
        expect(script).toContain('exact pe.');
        expect(script).not.toContain('Admitted.');
        compile('subgoal_extra_context', exportDrawingsToRocq(store.getAllDrawings(), sortStore) + '\n' + script);
    });

    it('compiles a provable child layer with a tuple and equality conclusion', () => {
        const sortStore = newSortStore();
        const store = new DrawingStore();
        const host = buildProvableChild(sortStore);
        const result = host.checkLayerProvable('child');
        expect(result.provable).toBe(true);

        store.saveDrawing('Main', host);
        const recorder = new RocqRecorder();
        recorder.start(host, 'Main', sortStore);
        recorder.recordProveSuccess(host, 'child', result.match ?? null, 'Main');
        const script = recorder.stop();
        compile('provable_child', exportDrawingsToRocq(store.getAllDrawings(), sortStore) + '\n' + script);
    });

    it('compiles a host with several sequential rule applications', () => {
        const sortStore = newSortStore();
        const store = new DrawingStore();

        const host = new Drawing(sortStore);
        const ma = makeVertex(host, 'a');
        const mb = makeVertex(host, 'b');
        host.addLayer('child', 'Child Layer', 'root');
        makeEdge(host, 'g', ma, mb, 'child');
        const mf = host.newArtefact('Edge', { source: ma, target: mb }, { width: 2, bend: 0, label: 'mf' }, 'root');
        host.newArtefact('isMono', { arrow: mf }, {}, 'root');
        host.newEqualityArtefact([ma, mb], 'root');
        store.saveDrawing('Main', host);

        const foo = new Drawing(sortStore);
        const fx = makeVertex(foo, 'x');
        const fy = makeVertex(foo, 'y');
        foo.addLayer('conclusion', 'Conclusion', 'root');
        foo.newArtefact('Edge', { source: fx, target: fy }, { width: 2, bend: 0, label: 'f' }, 'conclusion');
        foo.setIsRule(true);
        store.saveDrawing('Foo', foo);

        const secondOrderRule = new Drawing(sortStore);
        const sx = makeVertex(secondOrderRule, 'x');
        const sy = makeVertex(secondOrderRule, 'y');
        secondOrderRule.addLayer('premise-1', 'Premise Layer', 'root');
        makeEdge(secondOrderRule, 'pe', sx, sy, 'premise-1');
        secondOrderRule.addLayer('premise-1-child', 'Premise Child Layer', 'premise-1');
        makeEdge(secondOrderRule, 'pce', sx, sy, 'premise-1-child');
        secondOrderRule.addLayer('conclusion', 'Conclusion Layer', 'root');
        makeEdge(secondOrderRule, 'ce', sx, sy, 'conclusion');
        secondOrderRule.setIsRule(true);
        store.saveDrawing('SecondOrderRule', secondOrderRule);

        const monoRule = new Drawing(sortStore);
        const mx = makeVertex(monoRule, 'x');
        const my = makeVertex(monoRule, 'y');
        const mfRule = monoRule.newArtefact('Edge', { source: mx, target: my }, { width: 2, bend: 0, label: 'f' }, 'root');
        monoRule.newArtefact('isMono', { arrow: mfRule }, {}, 'root');
        monoRule.addLayer('conclusion', 'Conclusion Layer', 'root');
        makeEdge(monoRule, 'g', mx, my, 'conclusion');
        monoRule.setIsRule(true);
        store.saveDrawing('MonoRule', monoRule);

        const eqRule = new Drawing(sortStore);
        const ex = makeVertex(eqRule, 'x');
        const ey = makeVertex(eqRule, 'y');
        eqRule.newEqualityArtefact([ex, ey], 'root');
        eqRule.addLayer('conclusion', 'Conclusion Layer', 'root');
        makeEdge(eqRule, 'g', ex, ey, 'conclusion');
        eqRule.setIsRule(true);
        store.saveDrawing('EqRule', eqRule);

        const recorder = new RocqRecorder();
        recorder.start(host, 'Main', sortStore);

        const fooApps = findFirstOrderRuleApplications(foo, host);
        if (fooApps.length === 0) {
            throw new Error('Foo produced no applications');
        }
        recorder.recordRuleApply(foo, 'Foo', fooApps[0], host, applyFirstOrderRule(foo, host, fooApps[0]), 'Main', sortStore);

        const soApps = findSecondOrderRuleApplications(secondOrderRule, host);
        if (soApps.length === 0) {
            throw new Error('SecondOrderRule produced no applications');
        }
        const soResult = applySecondOrderRule(secondOrderRule, host, soApps[0], { hostName: 'Main', ruleName: 'SecondOrderRule' });
        recorder.recordRuleApply(
            secondOrderRule,
            'SecondOrderRule',
            soApps[0],
            host,
            { artefacts: soResult.hostArtefacts, created: soResult.hostCreated, derived: soResult.derivedRules },
            'Main',
            sortStore
        );

        const monoApps = findFirstOrderRuleApplications(monoRule, host);
        if (monoApps.length === 0) {
            throw new Error('MonoRule produced no applications');
        }
        recorder.recordRuleApply(monoRule, 'MonoRule', monoApps[0], host, applyFirstOrderRule(monoRule, host, monoApps[0]), 'Main', sortStore);

        const eqApps = findFirstOrderRuleApplications(eqRule, host);
        if (eqApps.length === 0) {
            throw new Error('EqRule produced no applications');
        }
        recorder.recordRuleApply(eqRule, 'EqRule', eqApps[0], host, applyFirstOrderRule(eqRule, host, eqApps[0]), 'Main', sortStore);

        const childResult = host.checkLayerProvable('child');
        if (!childResult.provable) {
            throw new Error('child layer not provable: ' + (childResult.reason ?? 'unknown'));
        }
        recorder.recordProveSuccess(host, 'child', childResult.match ?? null, 'Main');
        const script = recorder.stop();
        compile('main', exportDrawingsToRocq(store.getAllDrawings(), sortStore) + '\n' + script);
    });

    it('compiles a host with a recorded duplicate artefact move', () => {
        const sortStore = newSortStore();
        const store = new DrawingStore();

        const host = new Drawing(sortStore);
        const a = makeVertex(host, 'a');
        const b = makeVertex(host, 'b');
        const f = makeEdge(host, 'f', a, b);
        store.saveDrawing('Main', host);

        const recorder = new RocqRecorder();
        recorder.start(host, 'Main', sortStore);

        const { artefact: f2 } = host.duplicateArtefact(f, { source: a, target: b }, { width: 2, bend: 0, label: 'f_copy' }, 'root');
        recorder.recordDuplicate(host, f, f2, 'Main', sortStore);
        recorder.recordProveSuccess(host, null, null, 'Main');
        const script = recorder.stop();

        compile('duplicate_move', exportDrawingsToRocq(store.getAllDrawings(), sortStore) + '\n' + script);
    });

    it('compiles an unfinished main with a goal conclusion exported as Admitted', () => {
        const sortStore = newSortStore();
        const store = new DrawingStore();
        const host = buildProvableChild(sortStore);
        store.saveDrawing('Main', host);

        const recorder = new RocqRecorder();
        recorder.start(host, 'Main', sortStore);
        const script = recorder.stop();

        expect(script).toContain('Admitted.');
        expect(script).not.toContain('Qed.');
        compile('admitted_unfinished_main', exportDrawingsToRocq(store.getAllDrawings(), sortStore) + '\n' + script);
    });

    it('compiles a subgoal proof reverted to pending after a later recorded step', () => {
        const sortStore = newSortStore();
        const store = new DrawingStore();

        const host = new Drawing(sortStore);
        makeVertex(host, 'a');
        makeVertex(host, 'b');
        store.saveDrawing('Main', host);

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
        store.saveDrawing('SecondOrderRule', rule);

        const recorder = new RocqRecorder();
        recorder.start(host, 'Main', sortStore);

        const apps = findSecondOrderRuleApplications(rule, host);
        if (apps.length === 0) {
            throw new Error('SecondOrderRule produced no applications');
        }
        const result = applySecondOrderRule(rule, host, apps[0], { hostName: 'Main', ruleName: 'SecondOrderRule' });
        const sub = result.derivedRules[0];
        const childLayer = getFirstOrderStatementChildLayer(sub.drawing);
        if (!childLayer) {
            throw new Error('derived drawing has no first-order statement child layer');
        }
        const prove = sub.drawing.checkLayerProvable(childLayer.id);
        if (!prove.provable) {
            throw new Error('derived Goal layer not provable: ' + (prove.reason ?? 'unknown'));
        }
        recorder.recordRuleApply(
            rule,
            'SecondOrderRule',
            apps[0],
            host,
            { artefacts: result.hostArtefacts, created: result.hostCreated, derivedNames: result.derivedRules.map(d => d.name), derived: result.derivedRules },
            'Main',
            sortStore
        );
        recorder.recordProveSuccess(sub.drawing, childLayer.id, prove.match ?? null, sub.name);
        // A later edit on the sub supersedes the recorded proof: it reverts to pending.
        recorder.recordRename('pe', 'pf', sub.name);
        recorder.recordProveSuccess(host, null, null, 'Main');
        const script = recorder.stop();

        expect(script).toContain('Admitted.');
        compile('superseded_subgoal', exportDrawingsToRocq(store.getAllDrawings(), sortStore) + '\n' + script);
    });

    it('compiles nested inline subgoal proofs referencing the enclosing context', () => {
        const sortStore = newSortStore();
        const store = new DrawingStore();

        const host = new Drawing(sortStore);
        makeVertex(host, 'a');
        makeVertex(host, 'b');
        store.saveDrawing('Main', host);

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
        store.saveDrawing('SecondOrderRule', rule);

        const recorder = new RocqRecorder();
        recorder.start(host, 'Main', sortStore);

        const apps1 = findSecondOrderRuleApplications(rule, host);
        if (apps1.length === 0) {
            throw new Error('SecondOrderRule produced no applications on Main');
        }
        const result1 = applySecondOrderRule(rule, host, apps1[0], { hostName: 'Main', ruleName: 'SecondOrderRule' });
        const s1 = result1.derivedRules[0];
        store.saveDrawing(s1.name, s1.drawing);
        recorder.recordRuleApply(
            rule,
            'SecondOrderRule',
            apps1[0],
            host,
            { artefacts: result1.hostArtefacts, created: result1.hostCreated, derivedNames: result1.derivedRules.map(d => d.name) },
            'Main',
            sortStore
        );

        const apps2 = findSecondOrderRuleApplications(rule, s1.drawing);
        if (apps2.length === 0) {
            throw new Error('SecondOrderRule produced no applications on the subgoal drawing');
        }
        const result2 = applySecondOrderRule(rule, s1.drawing, apps2[0], { hostName: s1.name, ruleName: 'SecondOrderRule' });
        const s1sub = result2.derivedRules[0];
        store.saveDrawing(s1sub.name, s1sub.drawing);
        recorder.recordRuleApply(
            rule,
            'SecondOrderRule',
            apps2[0],
            s1.drawing,
            { artefacts: result2.hostArtefacts, created: result2.hostCreated, derivedNames: result2.derivedRules.map(d => d.name) },
            s1.name,
            sortStore
        );

        recorder.recordProveSuccess(host, null, null, 'Main');
        const script = recorder.stop();

        expect(script).not.toContain('Lemma Main___SecondOrderRule___Premise_rule :');
        expect(script).toContain('Admitted.');
        compile('nested_inline_subgoals', exportDrawingsToRocq(store.getAllDrawings(), sortStore) + '\n' + script);
    });

    it('compiles a multi-premise second-order rule whose premises share artefact names', () => {
        const sortStore = newSortStore();
        const store = new DrawingStore();

        const host = new Drawing(sortStore);
        makeVertex(host, 'a');
        makeVertex(host, 'b');
        store.saveDrawing('Main', host);

        const rule = new Drawing(sortStore);
        const rx = makeVertex(rule, 'x');
        const ry = makeVertex(rule, 'y');
        rule.addLayer('premise-1', 'Premise 1', 'root');
        makeEdge(rule, 'pe', rx, ry, 'premise-1');
        rule.addLayer('premise-1-child', 'Premise 1 Child', 'premise-1');
        makeEdge(rule, 'pce', rx, ry, 'premise-1-child');
        rule.addLayer('premise-2', 'Premise 2', 'root');
        makeEdge(rule, 'pe', rx, ry, 'premise-2');
        rule.addLayer('premise-2-child', 'Premise 2 Child', 'premise-2');
        makeEdge(rule, 'pce', rx, ry, 'premise-2-child');
        rule.addLayer('conclusion', 'Conclusion', 'root');
        makeEdge(rule, 'ce', rx, ry, 'conclusion');
        rule.setIsRule(true);
        store.saveDrawing('MultiPremiseRule', rule);

        const recorder = new RocqRecorder();
        recorder.start(host, 'Main', sortStore);

        const apps = findSecondOrderRuleApplications(rule, host);
        if (apps.length === 0) {
            throw new Error('MultiPremiseRule produced no applications');
        }
        const result = applySecondOrderRule(rule, host, apps[0], { hostName: 'Main', ruleName: 'MultiPremiseRule' });
        expect(result.derivedRules.length).toBe(2);

        const sub1 = result.derivedRules[0];
        const sub2 = result.derivedRules[1];
        store.saveDrawing(sub1.name, sub1.drawing);
        store.saveDrawing(sub2.name, sub2.drawing);

        const childLayer1 = getFirstOrderStatementChildLayer(sub1.drawing);
        if (!childLayer1) {
            throw new Error('sub1 has no child layer');
        }
        const prove1 = sub1.drawing.checkLayerProvable(childLayer1.id);
        if (!prove1.provable) {
            throw new Error('sub1 not provable: ' + (prove1.reason ?? 'unknown'));
        }

        const childLayer2 = getFirstOrderStatementChildLayer(sub2.drawing);
        if (!childLayer2) {
            throw new Error('sub2 has no child layer');
        }
        const prove2 = sub2.drawing.checkLayerProvable(childLayer2.id);
        if (!prove2.provable) {
            throw new Error('sub2 not provable: ' + (prove2.reason ?? 'unknown'));
        }

        recorder.recordRuleApply(
            rule,
            'MultiPremiseRule',
            apps[0],
            host,
            { artefacts: result.hostArtefacts, created: result.hostCreated, derivedNames: result.derivedRules.map(d => d.name), derived: result.derivedRules },
            'Main',
            sortStore
        );

        recorder.recordProveSuccess(sub1.drawing, childLayer1.id, prove1.match ?? null, sub1.name);
        recorder.recordProveSuccess(sub2.drawing, childLayer2.id, prove2.match ?? null, sub2.name);
        recorder.recordProveSuccess(host, null, null, 'Main');
        const script = recorder.stop();

        expect(script).not.toContain('Admitted.');
        expect(script).toContain('assert (Hpremise1 : forall (pe : Edge a b), Edge a b). {');
        expect(script).toContain('assert (Hpremise2 : forall (pe : Edge a b), Edge a b). {');
        expect(script).toContain('exact pe.');

        compile('multi_premise_subgoals', exportDrawingsToRocq(store.getAllDrawings(), sortStore) + '\n' + script);
    });
});
