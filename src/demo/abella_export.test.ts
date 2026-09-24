import { describe, it, expect } from 'vitest';
import { exportDrawingsToAbella, renderAbellaSigma, renderAbellaForall } from '../abella_export';
import { Drawing, DrawingStore } from '../index.svelte.ts';
import { newSortStore, makeVertex, makeEdge, buildComposableEdgesRule } from './helpers';
import type { LayerElement } from '../rocq_export';

describe('abella export', () => {
    it('exports sorts as Kind and Type declarations ordered by dependency', () => {
        const sortStore = newSortStore();
        const drawing = new Drawing(sortStore);
        const v0 = makeVertex(drawing, 'a');
        const v1 = makeVertex(drawing, 'b');
        makeEdge(drawing, 'f', v0, v1);

        const store = new DrawingStore();
        store.addDrawing('MainDrawing', drawing);

        const code = exportDrawingsToAbella(store.getAllDrawings(), sortStore);
        expect(code).toContain('Kind vertex type.');
        expect(code).toContain('Type vertex vertex -> prop.');
        expect(code).toContain('Kind edge type.');
        expect(code).toContain('Type edge vertex -> vertex -> edge -> prop.');
        expect(code).not.toContain('Kind Vertex');
        expect(code).not.toContain('Type Vertex');
        expect(code).not.toContain('Type vertex -> prop.');
    });

    it('exports each rule as a skipped Theorem with per-variable predicates', () => {
        const sortStore = newSortStore();
        const { rule } = buildComposableEdgesRule();

        const store = new DrawingStore();
        store.addDrawing('ComposableEdges', rule);

        const code = exportDrawingsToAbella(store.getAllDrawings(), sortStore);
        expect(code).toContain(
            'Theorem ComposableEdges_rule : forall rv0 rv1 rv2 re1 re2, vertex rv0 -> vertex rv1 -> vertex rv2 -> ' +
            'edge rv0 rv1 re1 -> edge rv1 rv2 re2 -> exists re3, edge rv0 rv2 re3.\nskip.'
        );
    });

    it('inlines an attached Abella proof verbatim', () => {
        const sortStore = newSortStore();
        const { rule } = buildComposableEdgesRule();
        rule.setAbellaProof('Theorem ComposableEdges_alias : forall a, Vertex a -> Vertex a.\nskip.');

        const store = new DrawingStore();
        store.addDrawing('ComposableEdges', rule);

        const code = exportDrawingsToAbella(store.getAllDrawings(), sortStore);
        expect(code).toContain('Theorem ComposableEdges_alias : forall a, Vertex a -> Vertex a.\nskip.');
        expect(code).not.toContain('Theorem ComposableEdges_rule :');
    });

    it('does not inline a Rocq-shaped attached proof', () => {
        const sortStore = newSortStore();
        const { rule } = buildComposableEdgesRule();
        rule.setRocqProof('Lemma ComposableEdges_lemma : True.\nProof.\n  exact I.\nQed.');

        const store = new DrawingStore();
        store.addDrawing('ComposableEdges', rule);

        const code = exportDrawingsToAbella(store.getAllDrawings(), sortStore);
        expect(code).not.toContain('Lemma ComposableEdges_lemma');
        expect(code).toContain('Theorem ComposableEdges_rule :');
    });

    it('renders conclusion equalities as plain conjuncts without existential binders', () => {
        const sortStore = newSortStore();
        const drawing = new Drawing(sortStore);
        const a = makeVertex(drawing, 'a');
        const b = makeVertex(drawing, 'b');
        makeEdge(drawing, 'f', a, b);
        drawing.addLayer('conclusion', 'Conclusion', 'root');
        makeEdge(drawing, 'g', a, b, 'conclusion');
        drawing.newEqualityArtefact([a, b], 'conclusion');
        drawing.setIsRule(true);

        const store = new DrawingStore();
        store.addDrawing('EqRule', drawing);

        const code = exportDrawingsToAbella(store.getAllDrawings(), sortStore);
        expect(code).not.toContain('exists a = b');
        expect(code).toContain('exists g, edge a b g /\\ a = b.');
        expect(code).toMatch(/Theorem EqRule_rule :[^\n]*a = b\./)
    });
});

describe('abella rendering primitives', () => {
    const artefact = (name: string, type: string): LayerElement => ({ name, type, kind: 'artefact', deps: [] });
    const equation = (name: string, type: string): LayerElement => ({ name, type, kind: 'equation', deps: [] });

    it('renderAbellaSigma yields True, a witness, or a witnessed conjunction', () => {
        const sortStore = newSortStore();
        expect(renderAbellaSigma([], sortStore)).toBe('True');

        const single = artefact('f', 'Edge a b');
        const multi = [artefact('f', 'Edge a b'), artefact('g', 'Edge a b')];
        const eqs = [equation('e', 'a = b')];

        expect(renderAbellaSigma([single], sortStore)).toBe('exists f, edge a b f');
        expect(renderAbellaSigma(multi, sortStore)).toBe('exists f g, edge a b f /\\ edge a b g');
        expect(renderAbellaSigma(eqs, sortStore)).toBe('a = b');
        expect(renderAbellaSigma([...eqs, single], sortStore)).toBe('exists f, a = b /\\ edge a b f');
    });

    it('renderAbellaForall hoists all binders before the hypotheses', () => {
        const sortStore = newSortStore();
        expect(renderAbellaForall([], 'Q', sortStore)).toBe('Q');
        expect(renderAbellaForall([artefact('a', 'Vertex')], 'Q', sortStore)).toBe('forall a, vertex a -> Q');
        expect(renderAbellaForall([artefact('f', 'Edge a a')], 'Q', sortStore)).toBe('forall f, edge a a f -> Q');
        expect(renderAbellaForall([equation('e', 'a = b')], 'Q', sortStore)).toBe('a = b -> Q');
        expect(renderAbellaForall([artefact('f', 'Edge a b'), equation('e', 'a = b')], 'Q', sortStore))
            .toBe('forall f, edge a b f -> a = b -> Q');
        expect(renderAbellaForall([artefact('a', 'Vertex'), artefact('b', 'Vertex'), artefact('m', 'Edge a b')], 'Q', sortStore))
            .toBe('forall a b m, vertex a -> vertex b -> edge a b m -> Q');
    });
});