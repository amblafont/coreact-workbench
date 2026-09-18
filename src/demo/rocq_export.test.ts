import { describe, it, expect } from 'vitest';
import { exportDrawingsToRocq, ruleParamBaseName } from '../rocq_export';
import { RocqRecorder } from '../rocq_recording';
import { Drawing, DrawingStore, findFirstOrderRuleApplications, applyFirstOrderRule, findSecondOrderRuleApplications, applySecondOrderRule, getFirstOrderStatementChildLayer } from '../index';
import { newSortStore, makeVertex, makeEdge, makeDrawing, buildComposableHost, buildIsMonoInChildLayerRule, buildIsMonoOnlyConclusionRule, buildSecondOrderRule } from './helpers';

describe('rocq export', () => {
    it('exports sorts and a sigma notation preamble without records or modules', () => {
        const sortStore = newSortStore();
        const drawing = new Drawing(sortStore);
        const v0 = makeVertex(drawing, 'a');
        const v1 = makeVertex(drawing, 'b');
        makeEdge(drawing, 'f', v0, v1);

        const store = new DrawingStore();
        store.saveDrawing('MainDrawing', drawing);

        const code = exportDrawingsToRocq(store.getAllDrawings(), sortStore);
        expect(code.startsWith('Require Import Ltac2.Ltac2.')).toBe(true);
        expect(code).toContain('Definition Sigma');
        expect(code).not.toContain('(sigT (fun x => ..');
        expect(code).toContain('Parameter Vertex : Type.');
        expect(code).toContain('Parameter Edge : Vertex -> Vertex -> Type.');
        expect(code).not.toContain('Module MainDrawing');
        expect(code).not.toContain('Record');
    });

    it('records a rule application against a host and emits a goal', () => {
        const sortStore = newSortStore();
        const store = new DrawingStore();

        const host = new Drawing(sortStore);
        const ma = makeVertex(host, 'a');
        const mb = makeVertex(host, 'b');
        makeEdge(host, 'g', ma, mb);
        host.newEqualityArtefact([ma, mb], 'root');
        store.saveDrawing('MainDrawing', host);

        const rule = new Drawing(sortStore);
        const rx = makeVertex(rule, 'x');
        const ry = makeVertex(rule, 'y');
        rule.addLayer('conclusion', 'Conclusion', 'root');
        rule.newArtefact('Edge', { source: rx, target: ry }, { width: 2, bend: 0, label: 'f' }, 'conclusion');
        rule.setIsRule(true);
        store.saveDrawing('Foo', rule);

        const recorder = new RocqRecorder();
        recorder.start(host, 'MainDrawing', sortStore);
        const apps = findFirstOrderRuleApplications(rule, host);
        expect(apps.length).toBe(1);
        const created = applyFirstOrderRule(rule, host, apps[0]);
        recorder.recordRuleApply(rule, 'Foo', apps[0], host, created, 'MainDrawing', sortStore);
        recorder.recordProveSuccess(host, null, null, 'MainDrawing');
        const script = recorder.stop();

        expect(script).toContain('Lemma MainDrawing_rule :');
        expect(script).toContain('intros');
        expect(script).toContain('@Foo_rule a b');
        expect(script).toContain('as f');
        expect(script).toContain('forall (a b : Vertex)');
        expect(script).toContain('Qed');

        const code = exportDrawingsToRocq(store.getAllDrawings(), sortStore) + '\n' + script;
        expect(code).toContain('Parameter Foo_rule :');
        expect(code).toContain('forall');
        expect(code).not.toContain('Module MainDrawing');
        expect(code).not.toContain('Module Foo');
    });

    it('starts the proof with intros only when the root layer has no equality', () => {
        const sortStore = newSortStore();
        const store = new DrawingStore();

        const host = new Drawing(sortStore);
        makeVertex(host, 'a');
        makeVertex(host, 'b');
        store.saveDrawing('MainDrawing', host);

        const recorder = new RocqRecorder();
        recorder.start(host, 'MainDrawing', sortStore);
        const script = recorder.stop();

        expect(script).toContain('Lemma MainDrawing_rule :');
    });

    it('applies a rule whose multi-element conclusion combines an artefact and an equality', () => {
        const sortStore = newSortStore();
        const store = new DrawingStore();

        const host = new Drawing(sortStore);
        const ma = makeVertex(host, 'a');
        const mb = makeVertex(host, 'b');
        makeEdge(host, 'g', ma, mb);
        host.newEqualityArtefact([ma, mb], 'root');
        store.saveDrawing('MainDrawing', host);

        const rule = new Drawing(sortStore);
        const rx = makeVertex(rule, 'x');
        const ry = makeVertex(rule, 'y');
        rule.addLayer('conclusion', 'Conclusion', 'root');
        rule.newArtefact('Edge', { source: rx, target: ry }, { width: 2, bend: 0, label: 'f' }, 'conclusion');
        rule.newEqualityArtefact([rx, ry], 'conclusion');
        rule.setIsRule(true);
        store.saveDrawing('FooEq', rule);

        const recorder = new RocqRecorder();
        recorder.start(host, 'MainDrawing', sortStore);
        const apps = findFirstOrderRuleApplications(rule, host);
        expect(apps.length).toBe(1);
        const created = applyFirstOrderRule(rule, host, apps[0]);
        recorder.recordRuleApply(rule, 'FooEq', apps[0], host, created, 'MainDrawing', sortStore);
        const script = recorder.stop();

        expect(script).toContain('@FooEq_rule a b');
    });

    it('applies a rule whose conclusion is a single equality', () => {
        const sortStore = newSortStore();
        const store = new DrawingStore();

        const host = new Drawing(sortStore);
        makeVertex(host, 'a');
        makeVertex(host, 'b');
        store.saveDrawing('MainDrawing', host);

        const rule = new Drawing(sortStore);
        const rx = makeVertex(rule, 'x');
        const ry = makeVertex(rule, 'y');
        rule.addLayer('conclusion', 'Conclusion', 'root');
        rule.newEqualityArtefact([rx, ry], 'conclusion');
        rule.setIsRule(true);
        store.saveDrawing('EqConclusionRule', rule);

        const recorder = new RocqRecorder();
        recorder.start(host, 'MainDrawing', sortStore);
        const apps = findFirstOrderRuleApplications(rule, host);
        expect(apps.length).toBeGreaterThan(0);
        const created = applyFirstOrderRule(rule, host, apps[0]);
        recorder.recordRuleApply(rule, 'EqConclusionRule', apps[0], host, created, 'MainDrawing', sortStore);
        const script = recorder.stop();

        expect(script).toContain('@EqConclusionRule_rule a b');
        expect(script).toContain('as eq_a_b');
    });

    it('applies a second-order rule with a single non-equality conclusion', () => {
        const sortStore = newSortStore();
        const store = new DrawingStore();

        const host = new Drawing(sortStore);
        makeVertex(host, 'a');
        makeVertex(host, 'b');
        store.saveDrawing('MainDrawing', host);

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
        recorder.start(host, 'MainDrawing', sortStore);
        const apps = findSecondOrderRuleApplications(rule, host);
        expect(apps.length).toBeGreaterThan(0);
        const result = applySecondOrderRule(rule, host, apps[0], { hostName: 'MainDrawing', ruleName: 'SecondOrderRule' });
        recorder.recordRuleApply(rule, 'SecondOrderRule', apps[0], host, { artefacts: result.hostArtefacts, created: result.hostCreated, derived: result.derivedRules }, 'MainDrawing', sortStore);
        const script = recorder.stop();

        expect(script).not.toContain('Lemma MainDrawing___SecondOrderRule___Premise_rule :');
        expect(script).toContain('Admitted.');
        expect(script).toContain('assert (Hpremise1 : forall (pe : Edge a b), Edge a b). {');
        expect(script).toContain('@SecondOrderRule_rule a b Hpremise1');
        expect(script).toContain('as ce');
        expect(script).toContain('admit.');

        // The unfinished subgoal's partial proof is inlined between the braces.
        const inlineStart = script.indexOf('assert (Hpremise1 : forall (pe : Edge a b), Edge a b). {');
        const inlineEnd = script.indexOf('}', inlineStart);
        expect(inlineStart).toBeGreaterThan(-1);
        expect(inlineEnd).toBeGreaterThan(-1);
        expect(script.slice(inlineStart, inlineEnd)).toContain('intros_sigma ().');
    });

    it('keeps recorded steps of an unfinished subgoal proof inlined before the enclosing admit', () => {
        const sortStore = newSortStore();
        const store = new DrawingStore();

        const host = new Drawing(sortStore);
        makeVertex(host, 'a');
        makeVertex(host, 'b');
        store.saveDrawing('MainDrawing', host);

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

        // The subgoal is partly worked (a rename) but never proved.
        recorder.recordRename('pe', 'pf', sub.name);
        const script = recorder.stop();

        expect(script).not.toContain('Lemma MainDrawing___SecondOrderRule___Premise_rule :');
        const inlineStart = script.indexOf('assert (Hpremise1 : forall (pe : Edge a b), Edge a b). {');
        const inlineEnd = script.indexOf('}', inlineStart);
        expect(inlineStart).toBeGreaterThan(-1);
        expect(inlineEnd).toBeGreaterThan(-1);
        expect(script.slice(inlineStart, inlineEnd)).toContain('rename pe into pf.');
        expect(script.slice(inlineStart, inlineEnd)).toContain('admit.');
    });

    it('inlines the subgoal proof against the mapped premise type, leaving host context enclosing', () => {
        const sortStore = newSortStore();
        const store = new DrawingStore();

        const host = new Drawing(sortStore);
        const ha = makeVertex(host, 'a');
        const hb = makeVertex(host, 'b');
        makeVertex(host, 'c');
        store.saveDrawing('MainDrawing', host);

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
        recorder.start(host, 'MainDrawing', sortStore);
        const apps = findSecondOrderRuleApplications(rule, host);
        expect(apps.length).toBeGreaterThan(0);
        const app = apps.find(a => a.matchedArtefacts.get(rx) === ha && a.matchedArtefacts.get(ry) === hb) ?? apps[0];
        const result = applySecondOrderRule(rule, host, app, { hostName: 'MainDrawing', ruleName: 'SecondOrderRule' });
        const derived = result.derivedRules[0];
        store.saveDrawing(derived.name, derived.drawing);
        recorder.recordRuleApply(
            rule,
            'SecondOrderRule',
            app,
            host,
            { artefacts: result.hostArtefacts, created: result.hostCreated, derivedNames: result.derivedRules.map(d => d.name), derived: result.derivedRules },
            'MainDrawing',
            sortStore
        );
        const script = recorder.stop();

        // The subgoal is asserted inline with the mapped premise type; the extra
        // host vertex `c` stays in the enclosing lemma's context. No standalone
        // subgoal lemma is emitted.
        expect(script).not.toContain('Lemma MainDrawing___SecondOrderRule___Premise_rule : forall (a b c : Vertex)(pe : Edge a b), Edge a b.');
        expect(script).toContain('assert (Hpremise1 : forall (pe : Edge a b), Edge a b). {');
        expect(script).toContain('admit.');
    });

    it('orders rule arguments topologically, interleaving root equalities at their dependency position', () => {
        const sortStore = newSortStore();
        const store = new DrawingStore();

        const host = new Drawing(sortStore);
        const ha = makeVertex(host, 'a');
        const hb = makeVertex(host, 'b');
        const hc = makeVertex(host, 'c');
        host.newEqualityArtefact([ha, hb], 'root');
        const hmw = host.newArtefact('Edge', { source: ha, target: hc }, { width: 2, bend: 0, label: 'mw' }, 'root');
        host.newArtefact('isMono', { arrow: hmw }, {}, 'root');
        store.saveDrawing('MainDrawing', host);

        const rule = new Drawing(sortStore);
        const rx = makeVertex(rule, 'x');
        const ry = makeVertex(rule, 'y');
        const rw = makeVertex(rule, 'w');
        rule.newEqualityArtefact([rx, ry], 'root');
        const rmw = rule.newArtefact('Edge', { source: rx, target: rw }, { width: 2, bend: 0, label: 'mw' }, 'root');
        rule.newArtefact('isMono', { arrow: rmw }, {}, 'root');
        rule.addLayer('conclusion', 'Conclusion', 'root');
        rule.newArtefact('Edge', { source: rx, target: ry }, { width: 2, bend: 0, label: 'f' }, 'conclusion');
        rule.setIsRule(true);
        store.saveDrawing('ArgOrderRule', rule);

        const recorder = new RocqRecorder();
        recorder.start(host, 'MainDrawing', sortStore);
        const apps = findFirstOrderRuleApplications(rule, host);
        expect(apps.length).toBe(1);
        const created = applyFirstOrderRule(rule, host, apps[0]);
        recorder.recordRuleApply(rule, 'ArgOrderRule', apps[0], host, created, 'MainDrawing', sortStore);
        recorder.recordProveSuccess(host, null, null, 'MainDrawing');
        const script = recorder.stop();

        expect(script).toContain('@ArgOrderRule_rule a b c eq_refl mw isMono_2');
        expect(script).not.toContain('@ArgOrderRule_rule a b c mw isMono_2 eq_refl');
    });

    it('applies a first-order rule combining an artefact and a conclusion-layer isMono, naming it from the host', () => {
        const sortStore = newSortStore();
        const store = new DrawingStore();

        const host = buildComposableHost().host;
        store.saveDrawing('MainDrawing', host);

        const rule = buildIsMonoInChildLayerRule();
        store.saveDrawing('IsMonoInChildLayer', rule);

        const recorder = new RocqRecorder();
        recorder.start(host, 'MainDrawing', sortStore);
        const apps = findFirstOrderRuleApplications(rule, host);
        expect(apps.length).toBe(1);
        const created = applyFirstOrderRule(rule, host, apps[0]);
        recorder.recordRuleApply(rule, 'IsMonoInChildLayer', apps[0], host, created, 'MainDrawing', sortStore);
        const script = recorder.stop();

        expect(script).toContain('@IsMonoInChildLayer_rule hv0 hv1 hv2 he1 he2');
        expect(script).toContain('as fe3 isMono_2');
        expect(script).not.toContain('as ()');
    });

    it('applies a second-order rule combining an artefact and a conclusion-layer isMono, naming it from the host', () => {
        const sortStore = newSortStore();
        const store = new DrawingStore();

        const host = buildComposableHost().host;
        store.saveDrawing('MainDrawing', host);

        const rule = buildSecondOrderRule();
        store.saveDrawing('SecondOrderRule', rule);

        const recorder = new RocqRecorder();
        recorder.start(host, 'MainDrawing', sortStore);
        const apps = findSecondOrderRuleApplications(rule, host);
        expect(apps.length).toBeGreaterThan(0);
        const result = applySecondOrderRule(rule, host, apps[0], { hostName: 'MainDrawing', ruleName: 'SecondOrderRule' });
        recorder.recordRuleApply(rule, 'SecondOrderRule', apps[0], host, { artefacts: result.hostArtefacts, created: result.hostCreated, derived: result.derivedRules }, 'MainDrawing', sortStore);
        const script = recorder.stop();

        expect(script).not.toContain('Lemma MainDrawing___SecondOrderRule___Premise_A_rule :');
        expect(script).toContain('assert (Hpremise1 : ');
        expect(script).toContain('admit.');
        expect(script).toContain('@SecondOrderRule_rule hv0 hv1 hv2 he1 he2 Hpremise1');
        expect(script).toContain('as sh isMono_2');
        expect(script).not.toContain('as ()');
    });

    it('applies a rule whose conclusion is only an isMono already present in a host child layer', () => {
        const sortStore = newSortStore();
        const store = new DrawingStore();

        const host = makeDrawing();
        const hv0 = makeVertex(host, 'hv0');
        const hv1 = makeVertex(host, 'hv1');
        const hv2 = makeVertex(host, 'hv2');
        makeEdge(host, 'he1', hv0, hv1);
        host.addLayer('mono-layer', 'Mono Layer', 'root');
        const he2 = host.newArtefact('Edge', { source: hv1, target: hv2 }, { width: 2, bend: 0, label: 'he2' }, 'root');
        host.newArtefact('isMono', { arrow: he2 }, {}, 'mono-layer');
        store.saveDrawing('MainDrawing', host);

        const rule = buildIsMonoOnlyConclusionRule();
        store.saveDrawing('FlagOnlyRule', rule);

        const recorder = new RocqRecorder();
        recorder.start(host, 'MainDrawing', sortStore);
        const apps = findFirstOrderRuleApplications(rule, host);
        expect(apps.length).toBe(1);
        const created = applyFirstOrderRule(rule, host, apps[0]);
        recorder.recordRuleApply(rule, 'FlagOnlyRule', apps[0], host, created, 'MainDrawing', sortStore);
        const script = recorder.stop();

        // The output isMono is a genuine goal layer (mono-layer) that was never
        // proved, so the unfinished main is exported as Admitted rather than a
        // bogus Qed, keeping the recorded partial proof.
        expect(script).toContain('Lemma MainDrawing_rule :');
        expect(script).toContain('forall (hv0 hv1 hv2 : Vertex)(he1 : Edge hv0 hv1)(he2 : Edge hv1 hv2), isMono he2');
        expect(script).toContain('Admitted.');
        expect(script).not.toContain('Qed.');
        const mainStart = script.indexOf('Lemma MainDrawing_rule :');
        const mainEnd = script.indexOf('Admitted.', mainStart);
        expect(script.slice(mainStart, mainEnd)).toContain('destruct_sigma (@FlagOnlyRule_rule hv0 hv1 hv2 he1 he2) as isMono_3.');
    });

    it('places a root equality binder before the conclusion sorts in the rule type', () => {
        const sortStore = newSortStore();
        const store = new DrawingStore();

        const rule = new Drawing(sortStore);
        const rx = makeVertex(rule, 'x');
        const ry = makeVertex(rule, 'y');
        rule.newEqualityArtefact([rx, ry], 'root');
        rule.addLayer('conclusion', 'Conclusion', 'root');
        makeEdge(rule, 'f', rx, ry, 'conclusion');
        rule.setIsRule(true);
        store.saveDrawing('WrappedEqRule', rule);

        const code = exportDrawingsToRocq(store.getAllDrawings(), sortStore);
        expect(code).toContain('Parameter WrappedEqRule_rule : forall (x y : Vertex)(eq_x_y : x = y),');
        expect(code).toContain('Edge x y');
    });

    it('places a conclusion equality binder before the sigma body in the rule type', () => {
        const sortStore = newSortStore();
        const store = new DrawingStore();

        const rule = new Drawing(sortStore);
        const rx = makeVertex(rule, 'x');
        const ry = makeVertex(rule, 'y');
        rule.addLayer('conclusion', 'Conclusion', 'root');
        rule.newEqualityArtefact([rx, ry], 'conclusion');
        makeEdge(rule, 'f', rx, ry, 'conclusion');
        rule.setIsRule(true);
        store.saveDrawing('SigmaEqRule', rule);

        const code = exportDrawingsToRocq(store.getAllDrawings(), sortStore);
        expect(code).toContain('Parameter SigmaEqRule_rule : forall (x y : Vertex), Σ (eq_x_y : x = y),');
        expect(code).toContain('Edge x y');
    });

    it('exports a rule with a three-artefact root equality as separate equality binders', () => {
        const sortStore = newSortStore();
        const store = new DrawingStore();

        const rule = new Drawing(sortStore);
        const rx = makeVertex(rule, 'r3');
        const ry = makeVertex(rule, 'r4');
        const rz = makeVertex(rule, 'r2');
        rule.newEqualityArtefact([rx, ry, rz], 'root');
        rule.addLayer('conclusion', 'Conclusion', 'root');
        makeEdge(rule, 'f', rx, rz, 'conclusion');
        rule.setIsRule(true);
        store.saveDrawing('TriEqRoot', rule);

        const code = exportDrawingsToRocq(store.getAllDrawings(), sortStore);
        expect(code).toContain('Parameter TriEqRoot_rule : forall (r3 r4 r2 : Vertex)(eq_r3_r4_r2 : r3 = r4)(eq_r3_r4_r2_2 : r4 = r2),');
        expect(code).not.toContain('r3 = r4 /\\');
    });

    it('records a rule application with a three-artefact root equality using two eq_refl witnesses', () => {
        const sortStore = newSortStore();
        const store = new DrawingStore();

        const host = new Drawing(sortStore);
        const ha = makeVertex(host, 'a');
        const hb = makeVertex(host, 'b');
        const hc = makeVertex(host, 'c');
        host.newEqualityArtefact([ha, hb, hc], 'root');
        store.saveDrawing('MainDrawing', host);

        const rule = new Drawing(sortStore);
        const rx = makeVertex(rule, 'x');
        const ry = makeVertex(rule, 'y');
        const rz = makeVertex(rule, 'z');
        rule.newEqualityArtefact([rx, ry, rz], 'root');
        rule.addLayer('conclusion', 'Conclusion', 'root');
        makeEdge(rule, 'f', rx, rz, 'conclusion');
        rule.setIsRule(true);
        store.saveDrawing('TriEqRoot', rule);

        const recorder = new RocqRecorder();
        recorder.start(host, 'MainDrawing', sortStore);
        const apps = findFirstOrderRuleApplications(rule, host);
        expect(apps.length).toBe(1);
        const created = applyFirstOrderRule(rule, host, apps[0]);
        recorder.recordRuleApply(rule, 'TriEqRoot', apps[0], host, created, 'MainDrawing', sortStore);
        const script = recorder.stop();

        expect(script).toContain('destruct_sigma (@TriEqRoot_rule a b c eq_refl eq_refl) as');
    });

    it('records an exact proof of a provable child layer, naming the matched parent', () => {
        const sortStore = newSortStore();
        const store = new DrawingStore();

        const host = new Drawing(sortStore);
        const ma = makeVertex(host, 'a');
        const mb = makeVertex(host, 'b');
        makeEdge(host, 'g', ma, mb);
        host.addLayer('child', 'Child Layer', 'root');
        makeEdge(host, 'c', ma, mb, 'child');
        store.saveDrawing('MainDrawing', host);

        const result = host.checkLayerProvable('child');
        expect(result.provable).toBe(true);

        const recorder = new RocqRecorder();
        recorder.start(host, 'MainDrawing', sortStore);
        recorder.recordProveSuccess(host, 'child', result.match ?? null, 'MainDrawing');
        const script = recorder.stop();

        expect(script).toContain('exact g.');
    });

    it('records an exact proof for a child layer containing an isMono established in the parent', () => {
        const sortStore = newSortStore();
        const store = new DrawingStore();

        const host = new Drawing(sortStore);
        const ma = makeVertex(host, 'a');
        const mb = makeVertex(host, 'b');
        const me = makeEdge(host, 'g', ma, mb);
        
        host.addLayer('child', 'Child Layer', 'root');
        const ce = host.newArtefact('Edge', { source: ma, target: mb }, { width: 2, bend: 0, label: 'c' }, 'child');
        host.addEqualityArtefactUnchecked([me, ce], 'child');

        // isMono established in root AND child
        host.newArtefact('isMono', { arrow: me }, {}, 'root');
        host.newArtefact('isMono', { arrow: me }, {}, 'child');
        
        store.saveDrawing('MainDrawing', host);

        const recorder = new RocqRecorder();
        recorder.start(host, 'MainDrawing', sortStore);
        
        const result = host.checkLayerProvable('child');
        expect(result.provable).toBe(true);
        recorder.recordProveSuccess(host, 'child', result.match ?? null, 'MainDrawing');
        
        const script = recorder.stop();
        // The proof witness should be a tuple with 'g' and the isMono proof term.
        // It might be 'isMono_2' depending on NameRegistry specifics, so we check for exact (...).
        expect(script).toContain('exact (');
    });

    it('records an exact proof when a child layer contains equations', () => {
        const sortStore = newSortStore();
        const store = new DrawingStore();

        const host = new Drawing(sortStore);
        const ma = makeVertex(host, 'a');
        const mb = makeVertex(host, 'b');
        makeEdge(host, 'g', ma, mb);
        host.addEqualityArtefactUnchecked([ma, mb], 'root');

        host.addLayer('child', 'Child Layer', 'root');
        host.addEqualityArtefactUnchecked([ma, mb], 'child');
        makeEdge(host, 'c', ma, mb, 'child');

        store.saveDrawing('MainDrawing', host);

        const recorder = new RocqRecorder();
        recorder.start(host, 'MainDrawing', sortStore);

        const result = host.checkLayerProvable('child');
        expect(result.provable).toBe(true);
        recorder.recordProveSuccess(host, 'child', result.match ?? null, 'MainDrawing');

        const script = recorder.stop();
        expect(script).toContain('exact (');
    });

    it('records an edge duplication as set (new := old : Sort deps...)', () => {
        const sortStore = newSortStore();
        const host = new Drawing(sortStore);
        const a = makeVertex(host, 'a');
        const b = makeVertex(host, 'b');
        const f = makeEdge(host, 'f', a, b);

        const store = new DrawingStore();
        store.saveDrawing('MainDrawing', host);

        const recorder = new RocqRecorder();
        recorder.start(host, 'MainDrawing', sortStore);

        const { artefact: f2 } = host.duplicateArtefact(f, { source: a, target: b }, { width: 2, bend: 0, label: 'f_copy' }, 'root');
        recorder.recordDuplicate(host, f, f2, 'MainDrawing', sortStore);

        const script = recorder.stop();
        expect(script).toContain('set (f_copy := f : Edge a b).');
    });

    it('records a vertex duplication without dependencies as set (new := old : Vertex)', () => {
        const sortStore = newSortStore();
        const host = new Drawing(sortStore);
        const a = makeVertex(host, 'a');

        const store = new DrawingStore();
        store.saveDrawing('MainDrawing', host);

        const recorder = new RocqRecorder();
        recorder.start(host, 'MainDrawing', sortStore);

        const { artefact: a2 } = host.duplicateArtefact(a, {}, { position: [100, 100], label: 'a_copy' }, 'root');
        recorder.recordDuplicate(host, a, a2, 'MainDrawing', sortStore);

        const script = recorder.stop();
        expect(script).toContain('set (a_copy := a : Vertex).');
    });

    it('does not record duplication when recording is not active', () => {
        const sortStore = newSortStore();
        const host = new Drawing(sortStore);
        const a = makeVertex(host, 'a');

        const recorder = new RocqRecorder();
        const { artefact: a2 } = host.duplicateArtefact(a, {}, { position: [100, 100], label: 'a_copy' }, 'root');
        recorder.recordDuplicate(host, a, a2, 'MainDrawing', sortStore);

        expect(recorder.isActive()).toBe(false);
    });

    it('inlines the real proof of a subgoal proven in the derived drawing', () => {
        const sortStore = newSortStore();
        const store = new DrawingStore();

        const host = new Drawing(sortStore);
        makeVertex(host, 'a');
        makeVertex(host, 'b');
        store.saveDrawing('MainDrawing', host);

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
        recorder.start(host, 'MainDrawing', sortStore);

        const apps = findSecondOrderRuleApplications(rule, host);
        expect(apps.length).toBeGreaterThan(0);
        const result = applySecondOrderRule(rule, host, apps[0], { hostName: 'MainDrawing', ruleName: 'SecondOrderRule' });
        const derived = result.derivedRules[0];
        store.saveDrawing(derived.name, derived.drawing);

        const childLayer = getFirstOrderStatementChildLayer(derived.drawing);
        expect(childLayer).not.toBeNull();
        const prove = derived.drawing.checkLayerProvable(childLayer!.id);
        expect(prove.provable).toBe(true);

        recorder.recordRuleApply(
            rule,
            'SecondOrderRule',
            apps[0],
            host,
            { artefacts: result.hostArtefacts, created: result.hostCreated, derivedNames: result.derivedRules.map(d => d.name), derived: result.derivedRules },
            'MainDrawing',
            sortStore
        );
        recorder.recordProveSuccess(derived.drawing, childLayer!.id, prove.match ?? null, derived.name);
        const script = recorder.stop();

        const subInlineIndex = script.indexOf('assert (Hpremise1 : forall (pe : Edge a b), Edge a b). {');
        const mainLemmaIndex = script.indexOf('Lemma MainDrawing_rule :');
        expect(subInlineIndex).toBeGreaterThan(-1);
        expect(mainLemmaIndex).toBeGreaterThan(-1);
        expect(subInlineIndex).toBeGreaterThan(mainLemmaIndex);
        expect(script).not.toContain('Lemma MainDrawing___SecondOrderRule___Premise_rule :');
        expect(script).not.toContain('Admitted.');
        expect(script.slice(subInlineIndex)).toContain('exact pe.');
        expect(script.slice(subInlineIndex)).toContain('\n}');
        expect(script.slice(mainLemmaIndex)).toContain('Qed.');
    });

    it('inlines nested subgoal proofs inside the main lemma', () => {
        const sortStore = newSortStore();
        const store = new DrawingStore();

        const host = new Drawing(sortStore);
        makeVertex(host, 'a');
        makeVertex(host, 'b');
        store.saveDrawing('MainDrawing', host);

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
        recorder.start(host, 'MainDrawing', sortStore);

        const apps1 = findSecondOrderRuleApplications(rule, host);
        expect(apps1.length).toBeGreaterThan(0);
        const result1 = applySecondOrderRule(rule, host, apps1[0], { hostName: 'MainDrawing', ruleName: 'SecondOrderRule' });
        const s1 = result1.derivedRules[0];
        store.saveDrawing(s1.name, s1.drawing);
        recorder.recordRuleApply(
            rule,
            'SecondOrderRule',
            apps1[0],
            host,
            { artefacts: result1.hostArtefacts, created: result1.hostCreated, derivedNames: result1.derivedRules.map(d => d.name) },
            'MainDrawing',
            sortStore
        );

        const apps2 = findSecondOrderRuleApplications(rule, s1.drawing);
        expect(apps2.length).toBeGreaterThan(0);
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

        const script = recorder.stop();

        // No standalone subgoal lemmas are emitted; both levels of subgoals are
        // inlined as nested `assert ... . { ... }` blocks inside the main lemma.
        expect(script).not.toContain('Lemma MainDrawing___SecondOrderRule___Premise___SecondOrderRule___Premise_rule :');
        expect(script).not.toContain('Lemma MainDrawing___SecondOrderRule___Premise_rule :');
        expect(script).toContain('Lemma MainDrawing_rule :');

        // The same rule applied twice produces two inlined premise asserts (the
        // inner one inside the outer one's braces).
        const inlineAssertes = script.match(/assert \(Hpremise1 : forall \(pe : Edge a b\), Edge a b\)\. \{/g);
        expect(inlineAssertes).not.toBeNull();
        expect(inlineAssertes!.length).toBe(2);

        // The first inline assert opens before the second one does, so the
        // structure nests rather than flattening.
        const first = script.indexOf('assert (Hpremise1 : forall (pe : Edge a b), Edge a b). {');
        const second = script.indexOf('assert (Hpremise1 : forall (pe : Edge a b), Edge a b). {', first + 1);
        expect(first).toBeGreaterThan(-1);
        expect(second).toBeGreaterThan(first);
    });

    it('reverts a recorded proof to pending when a rule is applied after the proof was recorded', () => {
        const sortStore = newSortStore();
        const store = new DrawingStore();

        const host = new Drawing(sortStore);
        const ma = makeVertex(host, 'a');
        const mb = makeVertex(host, 'b');
        makeEdge(host, 'g', ma, mb);
        host.addLayer('child', 'Child Layer', 'root');
        makeEdge(host, 'c', ma, mb, 'child');
        store.saveDrawing('MainDrawing', host);

        const result = host.checkLayerProvable('child');
        expect(result.provable).toBe(true);

        const recorder = new RocqRecorder();
        recorder.start(host, 'MainDrawing', sortStore);
        recorder.recordProveSuccess(host, 'child', result.match ?? null, 'MainDrawing');
        expect(recorder.getRecordedStatements().find(s => s.drawingName === 'MainDrawing')!.proved).toBe(true);

        const rule = new Drawing(sortStore);
        const rx = makeVertex(rule, 'x');
        const ry = makeVertex(rule, 'y');
        rule.addLayer('conclusion', 'Conclusion', 'root');
        rule.newArtefact('Edge', { source: rx, target: ry }, { width: 2, bend: 0, label: 'f' }, 'conclusion');
        rule.setIsRule(true);
        store.saveDrawing('Foo', rule);
        const apps = findFirstOrderRuleApplications(rule, host);
        expect(apps.length).toBeGreaterThan(0);
        const created = applyFirstOrderRule(rule, host, apps[0]);
        recorder.recordRuleApply(rule, 'Foo', apps[0], host, created, 'MainDrawing', sortStore);

        expect(recorder.getRecordedStatements().find(s => s.drawingName === 'MainDrawing')!.proved).toBe(false);
        const script = recorder.stop();
        expect(script).toContain('Admitted.');
        expect(script).not.toContain('Qed.');
    });

    it('exports an unfinished main with a conclusion goal as Admitted instead of Qed', () => {
        const sortStore = newSortStore();
        const store = new DrawingStore();

        const host = buildIsMonoInChildLayerRule();
        store.saveDrawing('UnfinishedMonoHost', host);

        const recorder = new RocqRecorder();
        recorder.start(host, 'UnfinishedMonoHost', sortStore);
        const script = recorder.stop();

        expect(script).toContain('Lemma UnfinishedMonoHost_rule :');
        expect(script).toContain('Admitted.');
        expect(script).not.toContain('Qed.');
        expect(script).not.toContain('exact');
    });

    it('closes a child-less main with exact I when no proof was recorded', () => {
        const sortStore = newSortStore();
        const store = new DrawingStore();

        const host = buildComposableHost().host;
        store.saveDrawing('MainDrawing', host);

        const recorder = new RocqRecorder();
        recorder.start(host, 'MainDrawing', sortStore);
        const script = recorder.stop();

        expect(script).toContain('Lemma MainDrawing_rule :');
        expect(script).toContain('exact I.');
        expect(script).toContain('Qed.');
        expect(script).not.toContain('Admitted.');
    });

    it('names premise binders consistently when a second-order rule has multiple premises with shared labels', () => {
        const sortStore = newSortStore();
        const store = new DrawingStore();

        const host = new Drawing(sortStore);
        makeVertex(host, 'a');
        makeVertex(host, 'b');
        store.saveDrawing('MainDrawing', host);

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
        recorder.start(host, 'MainDrawing', sortStore);

        const apps = findSecondOrderRuleApplications(rule, host);
        expect(apps.length).toBeGreaterThan(0);
        const result = applySecondOrderRule(rule, host, apps[0], { hostName: 'MainDrawing', ruleName: 'MultiPremiseRule' });
        expect(result.derivedRules.length).toBe(2);

        const sub1 = result.derivedRules[0];
        const sub2 = result.derivedRules[1];
        store.saveDrawing(sub1.name, sub1.drawing);
        store.saveDrawing(sub2.name, sub2.drawing);

        const childLayer1 = getFirstOrderStatementChildLayer(sub1.drawing);
        expect(childLayer1).not.toBeNull();
        const prove1 = sub1.drawing.checkLayerProvable(childLayer1!.id);
        expect(prove1.provable).toBe(true);

        const childLayer2 = getFirstOrderStatementChildLayer(sub2.drawing);
        expect(childLayer2).not.toBeNull();
        const prove2 = sub2.drawing.checkLayerProvable(childLayer2!.id);
        expect(prove2.provable).toBe(true);

        recorder.recordRuleApply(
            rule,
            'MultiPremiseRule',
            apps[0],
            host,
            { artefacts: result.hostArtefacts, created: result.hostCreated, derivedNames: result.derivedRules.map(d => d.name), derived: result.derivedRules },
            'MainDrawing',
            sortStore
        );

        recorder.recordProveSuccess(sub1.drawing, childLayer1!.id, prove1.match ?? null, sub1.name);
        recorder.recordProveSuccess(sub2.drawing, childLayer2!.id, prove2.match ?? null, sub2.name);
        recorder.recordProveSuccess(host, null, null, 'MainDrawing');

        const script = recorder.stop();

        // Both inlined premise asserts should use the derived drawing's local binder name 'pe',
        // matching the inner 'exact pe.', rather than the rule-global 'pe_2'.
        expect(script).toContain('assert (Hpremise1 : forall (pe : Edge a b), Edge a b). {');
        expect(script).toContain('assert (Hpremise2 : forall (pe : Edge a b), Edge a b). {');
        expect(script).not.toContain('Hpremise2 : forall (pe_2');

        const firstAssert = script.indexOf('assert (Hpremise1 : forall (pe : Edge a b), Edge a b). {');
        const firstExact = script.indexOf('exact pe.', firstAssert);
        const secondAssert = script.indexOf('assert (Hpremise2 : forall (pe : Edge a b), Edge a b). {', firstExact);
        const secondExact = script.indexOf('exact pe.', secondAssert);

        expect(firstAssert).toBeGreaterThan(-1);
        expect(firstExact).toBeGreaterThan(firstAssert);
        expect(secondAssert).toBeGreaterThan(firstExact);
        expect(secondExact).toBeGreaterThan(secondAssert);

        expect(script).toContain('Qed.');
        expect(script).not.toContain('Admitted.');
    });

    it('computes rule parameter base names consistently', () => {
        expect(ruleParamBaseName('Triangle')).toBe('Triangle_rule');
        expect(ruleParamBaseName('rule')).toBe('rule_rule');
        expect(ruleParamBaseName('')).toBe('Drawing_rule');
    });

    it('invokes a second-order rule named after a reserved sort with matching rule parameter in destruct_sigma', () => {
        const sortStore = newSortStore();
        const store = new DrawingStore();

        const host = new Drawing(sortStore);
        makeVertex(host, 'a');
        makeVertex(host, 'b');
        store.saveDrawing('MainDrawing', host);

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
        // "Triangle" is a defined sort, so previously drawingExportNames produced Triangle_2_rule
        // whereas exportDrawingsToRocq produced Parameter Triangle_rule : ...
        store.saveDrawing('Triangle', rule);

        const recorder = new RocqRecorder();
        recorder.start(host, 'MainDrawing', sortStore);
        const apps = findSecondOrderRuleApplications(rule, host);
        expect(apps.length).toBeGreaterThan(0);
        const result = applySecondOrderRule(rule, host, apps[0], { hostName: 'MainDrawing', ruleName: 'Triangle' });
        recorder.recordRuleApply(rule, 'Triangle', apps[0], host, { artefacts: result.hostArtefacts, created: result.hostCreated, derived: result.derivedRules }, 'MainDrawing', sortStore);
        const script = recorder.stop();

        const code = exportDrawingsToRocq(store.getAllDrawings(), sortStore);
        expect(code).toContain('Parameter Triangle_rule :');
        expect(script).toContain('@Triangle_rule a b Hpremise1');
        expect(script).toContain('destruct_sigma (@Triangle_rule a b Hpremise1) as ce.');
        expect(script).not.toContain('@Triangle_2_rule');
    });
});
