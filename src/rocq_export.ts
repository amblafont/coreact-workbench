import { sortEmissionOrder } from "./index.svelte.ts";
import type { Artefact, Drawing, Layer, SortDefinition, SortStore } from "./index.svelte.ts";

export interface RocqDrawingRef {
    name: string;
    drawing: Drawing;
}

const ROCQ_KEYWORDS: ReadonlySet<string> = new Set([
    "Match", "End", "match", "end", "let", "in", "fun", "forall", "exists",
    "if", "then", "else", "Prop", "Set", "Type", "Record", "Inductive",
    "CoInductive", "Definition", "Example", "Theorem", "Lemma", "Corollary",
    "Proposition", "Fixpoint", "CoFixpoint", "Class", "Instance", "Structure",
    "Module", "Section", "Context", "Variable", "Variables", "Hypothesis",
    "Hypotheses", "Axiom", "Parameter", "Parameters", "Arguments", "Notation",
    "Infix", "Generalizable", "Implicit", "Admitted", "Obligation", "Proof",
    "eq", "and", "or", "not", "iff", "True", "False", "nat", "bool", "O", "S",
    "true", "false", "pair", "ex", "sig", "id"
]);

export function sanitizeIdent(raw: string): string {
    let s = raw.replace(/[^A-Za-z0-9_']/g, "_");
    if (!s) {
        s = "x";
    }
    if (/^[0-9_]/.test(s)) {
        s = `x${s}`;
    }
    if (ROCQ_KEYWORDS.has(s)) {
        s = `x${s}`;
    }
    return s;
}

export function ruleParamBaseName(drawingName: string): string {
    return `${sanitizeIdent(drawingName || "Drawing")}_rule`;
}

export class NameRegistry {
    private readonly used: Set<string>;

    constructor(initial: Iterable<string> = []) {
        this.used = new Set(initial);
    }

    has(name: string): boolean {
        return this.used.has(name);
    }

    reserve(name: string): void {
        this.used.add(name);
    }

    unique(base: string): string {
        let candidate = base;
        let index = 2;
        while (this.used.has(candidate)) {
            candidate = `${base}_${index}`;
            index++;
        }
        this.used.add(candidate);
        return candidate;
    }
}

export const SIGMA_DEFINITION = `(* This alias is a workaround of a rocq bug that makes 
  ltac:(subst_all_in ..) fail *)
  Definition Sigma {A : Type}(B : A -> Type) := sigT B.`;

export const SIGMA_NOTATION = `Notation "'Σ' x .. y , p" :=
  (Sigma (fun x => .. (Sigma (fun y => p)) ..))
  (at level 200, x binder, y binder, right associativity).`;

export const TUPLE_NOTATION = `(* (a, b, c) : Σ (a : A)(b : B), C a b *)
Notation "( x , .. , y , p )" :=
  (existT _ x .. (existT _ y p) ..).`;

export const SUBST_ALL_TACTIC = `Ltac subst_all1 :=
  repeat (match goal with 
     | e : ?x = ?y |- _ => 
        (* if e is a reflexive equality we use UIP *)
        ( (subst x; pose (x := y)) ||
         (
            let h := fresh in 
            assert (h := UIP e); subst e)
        );
     (* This cbn simplifies x (sometimes pose adds some explicit casting)
         and also transport along e (which are now transport along eq_refl)
          *)
         cbn in * 
    end). `;

export const SUBST_ALL_LTAC2 = `Ltac2 subst_all () := ltac1:(subst_all1).`;

export const INTROS_SIGMA_TACTIC = `Ltac2 intros_sigma () := repeat (intros; subst_all ()).`;

export const SUBST_ALL_IN_TACTIC = `Tactic Notation "subst_all_in"  uconstr(B)  :=
  subst_all1;  exact B.`;

export const DESTRUCT_SIGMA_TACTIC = `Ltac2 generate_name (l : Std.intro_pattern):ident :=
  match l with
  | Std.IntroNaming (Std.IntroIdentifier x) => x
  | Std.IntroAction Std.IntroWildcard => Fresh.in_goal @equal
  | _ => 
  (* raise an error *)
  Control.throw_invalid_argument  "destruct_sigma: unsupported pattern"
  end.

(* We use ltac2 because in ltac1 it is not be possible 
to destructure the list of identifiers. destruct_sigma substitutes the equalities *)

Ltac2 rec destruct_sigma_tac (t : constr) (l : Std.intro_pattern list) :=
  match l with
  | [] => ()
  | [xi] =>
      let x := generate_name xi in
      assert ($x := $t); subst_all ()
  | xi :: q =>
      let x := generate_name xi in
      let h := Fresh.in_goal @destruct in
      destruct $t as [$x $h];
      subst_all ();
      (* try because if h was an equality, subst_all already removed it *)
      try (destruct_sigma_tac (Control.hyp h) q;      
        clear $h)
  end.

Ltac2 Notation "destruct_sigma"
    t(constr) "as" l(list1(intropattern)) :=
  destruct_sigma_tac t l. `;

function getSort(sortStore: SortStore, name: string): SortDefinition {
    const def = sortStore.getSort(name);
    if (!def) {
        throw new Error(`Consistency Check Failed: Sort '${name}' is not defined.`);
    }
    return def;
}

function uniquePrefix(depKey: string, used: Set<string>): string {
    const base = sanitizeIdent(depKey);
    let prefix = base;
    let index = 2;
    while (used.has(prefix)) {
        prefix = `${base}_${index}`;
        index++;
    }
    used.add(prefix);
    return prefix;
}

function leafBinderNames(sortStore: SortStore, sortName: string): string[] {
    const def = getSort(sortStore, sortName);
    const deps = Object.entries(def.dependencies);
    if (deps.length === 0) {
        return [];
    }
    const result: string[] = [];
    const headerNames = new Set<string>();
    for (const [depKey, depSortName] of deps) {
        const prefix = uniquePrefix(depKey, headerNames);
        for (const leaf of leafBinderNames(sortStore, depSortName)) {
            result.push(`${prefix}_${leaf}`);
        }
        result.push(prefix);
    }
    return result;
}

function sortHeaderType(sortStore: SortStore, def: SortDefinition): string {
    const deps = Object.entries(def.dependencies);
    if (deps.length === 0) {
        return "Type";
    }
    const binders: string[] = [];
    const arrows: string[] = [];
    const headerNames = new Set<string>();
    for (const [depKey, depSortName] of deps) {
        const leafs = leafBinderNames(sortStore, depSortName);
        if (leafs.length === 0) {
            arrows.push(depSortName);
        } else {
            const prefix = uniquePrefix(depKey, headerNames);
            const prefixed = leafs.map(leaf => `${prefix}_${leaf}`);
            binders.push(`\`(${prefix} : ${depSortName} ${prefixed.join(" ")})`);
        }
    }
    if (binders.length === 0) {
        return `${arrows.join(" -> ")} -> Type`;
    }
    const tail = arrows.length > 0 ? `${arrows.join(" -> ")} -> Type` : "Type";
    return `forall ${binders.join(" ")}, ${tail}`;
}

export interface FieldItem {
    name: string;
    type: string;
    deps: string[];
}

export interface DrawingModel {
    name: string;
    layerById: Map<string, Layer>;
    artefactById: Map<string, Artefact>;
    layerOrder: Layer[];
    ancestors: Map<string, string[]>;
    recordNames: Map<string, string>;
    fieldNames: Map<string, string>;
}

export function buildDrawingModel(
    drawing: Drawing,
    name: string,
    registry: NameRegistry
): DrawingModel {
    const layers = drawing.getAllLayers();
    const artefacts = drawing.getArtefacts();
    const layerById = new Map(layers.map(layer => [layer.id, layer] as const));
    const artefactById = new Map(artefacts.map(art => [art.id, art] as const));

    const layerOrder: Layer[] = [];
    const visited = new Set<string>();
    const visit = (layerId: string): void => {
        if (visited.has(layerId)) {
            return;
        }
        const layer = layerById.get(layerId);
        if (!layer) {
            return;
        }
        if (layer.parentId !== null && layerById.has(layer.parentId) && !visited.has(layer.parentId)) {
            visit(layer.parentId);
        }
        visited.add(layerId);
        layerOrder.push(layer);
    };
    for (const layer of layers) {
        visit(layer.id);
    }

    const ancestors = new Map<string, string[]>();
    for (const layer of layers) {
        const chain: string[] = [];
        let current: string | null = layer.id;
        while (current !== null && layerById.has(current)) {
            chain.push(current);
            current = layerById.get(current)!.parentId;
        }
        ancestors.set(layer.id, chain);
    }

    const recordNames = new Map<string, string>();
    for (const layer of layers) {
        const baseName = sanitizeIdent(layer.name || layer.id);
        recordNames.set(layer.id, registry.unique(baseName));
    }

    const fieldNames = new Map<string, string>();
    for (const art of artefacts) {
        const baseName = sanitizeIdent(typeof art.data.label === "string" && art.data.label ? art.data.label : art.sortName);
        fieldNames.set(art.id, registry.unique(baseName));
    }

    return { name, layerById, artefactById, layerOrder, ancestors, recordNames, fieldNames };
}

function refFrom(model: DrawingModel, fromLayerId: string, artefactId: string): string {
    const art = model.artefactById.get(artefactId);
    if (!art) {
        throw new Error(`Consistency Check Failed: Artefact '${artefactId}' does not exist in drawing '${model.name}'.`);
    }
    const fieldName = model.fieldNames.get(artefactId);
    if (!fieldName) {
        throw new Error(`Consistency Check Failed: No field assigned for artefact '${artefactId}' in drawing '${model.name}'.`);
    }
    if (art.layerId !== fromLayerId) {
        const chain = model.ancestors.get(fromLayerId) ?? [];
        if (!chain.includes(art.layerId)) {
            const layerName = model.layerById.get(fromLayerId)?.name ?? fromLayerId;
            throw new Error(
                `Consistency Check Failed: Artefact '${labelOf(art)}' (in layer '${model.layerById.get(art.layerId)?.name ?? art.layerId}') is not in layer '${layerName}' or any of its lower ancestor layers.`
            );
        }
    }
    return fieldName;
}

function labelOf(art: Artefact): string {
    return typeof art.data.label === "string" && art.data.label ? art.data.label : art.sortName;
}

function stringDepEntries(dependencies: Record<string, Artefact>): Array<[string, string]> {
    return Object.entries(dependencies)
        .filter((entry): entry is [string, Artefact] => !!entry[1])
        .sort(([a], [b]) => a.localeCompare(b, "en", { numeric: true }))
        .map(([key, art]) => [key, art.id] as [string, string]);
}

function fieldType(model: DrawingModel, sortStore: SortStore, art: Artefact): string {
    const def = getSort(sortStore, art.sortName);
    const depRefs: string[] = [];
    for (const [depKey] of Object.entries(def.dependencies)) {
        const depValue = art.dependencies[depKey];
        if (!depValue) {
            throw new Error(
                `Consistency Check Failed: Missing artefact dependency '${depKey}' for artefact '${labelOf(art)}' (sort '${art.sortName}').`
            );
        }
        depRefs.push(refFrom(model, art.layerId, depValue.id));
    }
    return depRefs.length === 0 ? art.sortName : `${art.sortName} ${depRefs.join(" ")}`;
}

function equalityFieldName(model: DrawingModel, art: Artefact): string {
    const label = art.data.label;
    if (typeof label === "string" && label) {
        return `eq_${sanitizeIdent(label)}`;
    }
    const childIds = stringDepEntries(art.dependencies).map(([, value]) => value);
    const childLabels = childIds
        .map(id => model.artefactById.get(id))
        .filter((child): child is Artefact => !!child)
        .map(labelOf)
        .map(sanitizeIdent);
    return childLabels.length > 0 ? `eq_${childLabels.join("_")}` : "eq_x";
}

function equalityConjunctCount(art: Artefact): number {
    const childIds = stringDepEntries(art.dependencies);
    if (childIds.length < 2) {
        throw new Error("Consistency Check Failed: A degenerate equality artefact (fewer than 2 children) cannot be exported.");
    }
    return childIds.length - 1;
}

function equalityConjunctType(model: DrawingModel, art: Artefact, index: number): string {
    const childIds = stringDepEntries(art.dependencies).map(([, value]) => value);
    if (childIds.length < 2) {
        throw new Error("Consistency Check Failed: A degenerate equality artefact (fewer than 2 children) cannot be exported.");
    }
    const refs = childIds.map(id => refFrom(model, art.layerId, id));
    return `${refs[index]} = ${refs[index + 1]}`;
}

export interface ProofFieldNames {
    equalityFieldNames: Map<string, string[]>;
}

export function computeProofFieldNames(
    drawing: Drawing,
    model: DrawingModel,
    registry: NameRegistry
): ProofFieldNames {
    const equalityFieldNames = new Map<string, string[]>();
    for (const layer of model.layerOrder) {
        const layerArtefacts = drawing.getArtefacts().filter(art => art.layerId === layer.id);
        for (const art of layerArtefacts) {
            if (art.sortName !== "Equality") {
                continue;
            }
            const base = equalityFieldName(model, art);
            const names: string[] = [];
            for (let i = 0; i < equalityConjunctCount(art); i++) {
                names.push(registry.unique(base));
            }
            equalityFieldNames.set(art.id, names);
        }
    }

    return { equalityFieldNames };
}

// ---------------------------------------------------------------------------
// Sigma-based rule types
// ---------------------------------------------------------------------------

export interface LayerElement extends FieldItem {
    kind: "artefact" | "equation";
    /**
     * The sort whose group this element is emitted in. For an `artefact` that
     * is its own sort; for an `equation` it is the sort of its latest-ranked
     * child, so the equality follows the artefacts it constrains.
     */
    groupSort: string;
    artefactId?: string;
    eqIndex?: number;
}

/**
 * Reject an ordering in which an element's same-layer dependencies are not all
 * emitted before it, which would bind a type mentioning a name that is not yet
 * in scope.
 */
function assertDependenciesPrecede(items: FieldItem[]): void {
    const seen = new Set<string>();
    for (const item of items) {
        const missing = item.deps.filter(dep => !seen.has(dep));
        if (missing.length > 0) {
            throw new Error(
                `Consistency Check Failed: Sort groups do not order layer dependencies; '${item.name}' depends on ${missing.join(", ")}, which is emitted later. Every sort must be declared after the sorts it depends on.`
            );
        }
        seen.add(item.name);
    }
}

/**
 * Group a layer's elements by sort declaration order, emitting each sort's
 * artefacts before the equalities over them. Order inside a group is the
 * incoming order, i.e. the drawing's artefact order.
 *
 * `sortOrder` must be dependency-respecting (see `sortEmissionOrder`), which is
 * what makes the result a valid topological order: a sort's same-layer
 * dependencies are always sorts declared before it, and an equality is grouped
 * after the latest of its children. `SortStore.newSort` enforces that invariant
 * by refusing to declare a sort before its dependencies, so the grouping is
 * sound by construction and `assertDependenciesPrecede` only exists to turn a
 * violation into a clear error rather than a binder list Rocq cannot parse.
 */
export function orderLayerElements(elements: LayerElement[], sortOrder: string[]): LayerElement[] {
    const rank = new Map(sortOrder.map((sortName, index) => [sortName, index] as const));
    const fallbackRank = sortOrder.length;
    const buckets = new Map<number, LayerElement[]>();
    for (const el of elements) {
        const key = (rank.get(el.groupSort) ?? fallbackRank) * 2 + (el.kind === "equation" ? 1 : 0);
        const bucket = buckets.get(key);
        if (bucket) {
            bucket.push(el);
        } else {
            buckets.set(key, [el]);
        }
    }
    const ordered: LayerElement[] = [];
    for (const key of [...buckets.keys()].sort((a, b) => a - b)) {
        ordered.push(...buckets.get(key)!);
    }
    assertDependenciesPrecede(ordered);
    return ordered;
}

export function buildLayerElements(
    drawing: Drawing,
    sortStore: SortStore,
    model: DrawingModel,
    proofNames: ProofFieldNames,
    layerId: string,
    sortOrder: string[]
): LayerElement[] {
    const rank = new Map(sortOrder.map((sortName, index) => [sortName, index] as const));
    const items: LayerElement[] = [];
    const layerArtefacts = drawing.getArtefacts().filter(art => art.layerId === layerId);

    for (const art of layerArtefacts) {
        if (art.sortName === "Equality") {
            const names = proofNames.equalityFieldNames.get(art.id);
            if (!names || names.length === 0) {
                throw new Error(`Consistency Check Failed: No field names computed for equality artefact '${labelOf(art)}'.`);
            }
            const childIds = stringDepEntries(art.dependencies).map(([, value]) => value);
            const depFieldNames = childIds
                .filter(id => model.artefactById.get(id)?.layerId === layerId)
                .map(id => model.fieldNames.get(id))
                .filter((name): name is string => !!name);
            let groupSort = art.sortName;
            let groupRank = rank.get(groupSort) ?? -1;
            for (const id of childIds) {
                const childSort = model.artefactById.get(id)?.sortName;
                const childRank = childSort ? (rank.get(childSort) ?? -1) : -1;
                if (childSort && childRank > groupRank) {
                    groupSort = childSort;
                    groupRank = childRank;
                }
            }
            names.forEach((name, index) => {
                items.push({ name, type: equalityConjunctType(model, art, index), deps: depFieldNames, kind: "equation", groupSort, artefactId: art.id, eqIndex: index });
            });
        } else {
            const fieldName = model.fieldNames.get(art.id);
            if (!fieldName) {
                throw new Error(`Consistency Check Failed: No field assigned for artefact '${labelOf(art)}'.`);
            }
            const depFieldNames: string[] = [];
            const def = getSort(sortStore, art.sortName);
            for (const [depKey] of Object.entries(def.dependencies)) {
                const depValue = art.dependencies[depKey];
                if (!depValue) {
                    continue;
                }
                const depArt = model.artefactById.get(depValue.id);
                if (depArt && depArt.layerId === layerId) {
                    const depFieldName = model.fieldNames.get(depValue.id);
                    if (depFieldName) {
                        depFieldNames.push(depFieldName);
                    }
                }
            }
            items.push({ name: fieldName, type: fieldType(model, sortStore, art), deps: depFieldNames, kind: "artefact", groupSort: art.sortName, artefactId: art.id });
        }
    }

    return orderLayerElements(items, sortOrder);
}

function binderGroups(elements: LayerElement[]): Array<{ names: string[]; type: string }> {
    const groups: Array<{ names: string[]; type: string }> = [];
    for (const el of elements) {
        const last = groups[groups.length - 1];
        if (last && last.type === el.type) {
            last.names.push(el.name);
        } else {
            groups.push({ names: [el.name], type: el.type });
        }
    }
    return groups;
}

function renderGroups(groups: Array<{ names: string[]; type: string }>): string {
    return groups.map(g => `(${g.names.join(" ")} : ${g.type})`).join("");
}

function nextEquationRun(elements: LayerElement[]): number {
    for (let i = 0; i < elements.length; i++) {
        if (elements[i].kind === "equation") {
            let end = i;
            while (end < elements.length && elements[end].kind === "equation") {
                end++;
            }
            return end;
        }
    }
    return -1;
}

export function renderForallChain(elements: LayerElement[], rest: string): string {
    if (elements.length === 0) {
        return rest;
    }
    const runEnd = nextEquationRun(elements);
    if (runEnd === -1) {
        return `forall ${renderGroups(binderGroups(elements))}, ${rest}`;
    }
    const prefix = elements.slice(0, runEnd);
    const remainder = elements.slice(runEnd);
    const wrappedRest = remainder.length === 0 ? rest : renderForallChain(remainder, rest);
    return `forall ${renderGroups(binderGroups(prefix))}, ltac:(subst_all_in (${wrappedRest}))`;
}

export function renderSigma(elements: LayerElement[]): string {
    if (elements.length === 0) {
        return "True";
    }
    if (elements.length === 1) {
        return elements[0].type;
    }
    const binders = elements.slice(0, -1);
    const body = elements[elements.length - 1].type;
    const runEnd = nextEquationRun(binders);
    if (runEnd === -1) {
        return `Σ ${renderGroups(binderGroups(binders))}, ${body}`;
    }
    const prefix = binders.slice(0, runEnd);
    const remainder = elements.slice(runEnd);
    const wrappedRest = renderSigma(remainder);
    return `Σ ${renderGroups(binderGroups(prefix))}, ltac:(subst_all_in (${wrappedRest}))`;
}

export function renderExactTerm(elements: LayerElement[], witnessFor: (el: LayerElement) => string): string {
    if (elements.length === 0) {
        return "I";
    }
    if (elements.length === 1) {
        return witnessFor(elements[0]);
    }
    return `(${elements.map(witnessFor).join(", ")})`;
}

export interface PremiseInfo {
    premiseElements: LayerElement[];
    childElements: LayerElement[];
}

export interface RuleTypeInfo {
    paramName: string | null;
    type: string;
    model: DrawingModel;
    proofNames: ProofFieldNames;
    rootElements: LayerElement[];
    conclusionElements: LayerElement[];
    rootLayerId: string;
    conclusionLayerId: string | null;
    premiseLayers: PremiseInfo[];
}

export interface RuleTypeOptions {
    reserveParam: boolean;
    includePremises: boolean;
}

export function ruleTypeInfo(
    drawing: Drawing,
    name: string,
    sortStore: SortStore,
    registry: NameRegistry,
    options: RuleTypeOptions
): RuleTypeInfo {
    const model = buildDrawingModel(drawing, name, registry);
    const proofNames = computeProofFieldNames(drawing, model, registry);
    const sortOrder = sortEmissionOrder(sortStore);

    const rootLayers = drawing.getAllLayers().filter(l => l.parentId === null);
    if (rootLayers.length !== 1) {
        throw new Error(`Consistency Check Failed: Rule drawing '${name}' must have exactly one root layer.`);
    }
    const root = rootLayers[0];
    const rootElements = buildLayerElements(drawing, sortStore, model, proofNames, root.id, sortOrder);

    const rootChildren = drawing.getAllLayers().filter(l => l.parentId === root.id);
    const conclusion = rootChildren.find(child => {
        const childrenOfChild = drawing.getAllLayers().filter(l => l.parentId === child.id);
        return childrenOfChild.length === 0;
    });

    let paramName: string | null = null;
    if (options.reserveParam) {
        paramName = registry.unique(ruleParamBaseName(name));
    }

    if (!conclusion) {
        if (options.includePremises) {
            throw new Error(`Consistency Check Failed: Rule drawing '${name}' has no conclusion layer.`);
        }
        return {
            paramName,
            type: renderForallChain(rootElements, "True"),
            model,
            proofNames,
            rootElements,
            conclusionElements: [],
            rootLayerId: root.id,
            conclusionLayerId: null,
            premiseLayers: []
        };
    }

    const conclusionElements = buildLayerElements(drawing, sortStore, model, proofNames, conclusion.id, sortOrder);
    const conclusionStr = renderSigma(conclusionElements);

    let type: string;
    let premiseLayers: PremiseInfo[] = [];
    if (options.includePremises) {
        const premises = rootChildren
            .filter(child => child !== conclusion)
            .map(premise => {
                const childOfPremise = drawing.getAllLayers().find(l => l.parentId === premise.id);
                if (!childOfPremise) {
                    throw new Error(`Consistency Check Failed: Premise layer '${premise.name}' in rule drawing '${name}' has no child layer.`);
                }
                return {
                    premiseElements: buildLayerElements(drawing, sortStore, model, proofNames, premise.id, sortOrder),
                    childElements: buildLayerElements(drawing, sortStore, model, proofNames, childOfPremise.id, sortOrder)
                };
            });
        premiseLayers = premises;
        if (premises.length === 0) {
            type = renderForallChain(rootElements, conclusionStr);
        } else {
            const premiseStrs = premises.map(p => {
                const childStr = renderSigma(p.childElements);
                return `(${renderForallChain(p.premiseElements, childStr)})`;
            });
            type = renderForallChain(rootElements, `${premiseStrs.join(" -> ")} -> ${conclusionStr}`);
        }
    } else {
        type = renderForallChain(rootElements, conclusionStr);
    }

    return {
        paramName,
        type,
        model,
        proofNames,
        rootElements,
        conclusionElements,
        rootLayerId: root.id,
        conclusionLayerId: conclusion.id,
        premiseLayers
    };
}

export function newExportRegistry(sortStore: SortStore): NameRegistry {
    const registry = new NameRegistry();
    const sortDefs = sortStore.getAllSorts().filter(def => def.name !== "Equality");
    for (const def of sortDefs) {
        registry.reserve(def.name);
    }
    registry.reserve("Equality");
    return registry;
}

export function exportDrawingsToRocq(drawings: Array<{ name: string; drawing: Drawing }>, sortStore: SortStore): string {
    if (drawings.length === 0) {
        throw new Error("Consistency Check Failed: No drawings selected for export.");
    }

    const lines: string[] = [];
    lines.push("Require Import Ltac2.Ltac2.");
    lines.push("From Ltac2 Require Import Ltac1CompatNotations.");
    lines.push("Generalizable All Variables.");
    lines.push("Set Implicit Arguments.");
    lines.push("");
    lines.push("Axiom UIP : forall A, forall (x : A) (p : x = x), p = eq_refl.");
    lines.push("");
    lines.push(SIGMA_DEFINITION);
    lines.push("");
    lines.push(SIGMA_NOTATION);
    lines.push("");
    lines.push(TUPLE_NOTATION);
    lines.push("");
    lines.push(SUBST_ALL_TACTIC);
    lines.push("");
    lines.push(SUBST_ALL_LTAC2);
    lines.push("");
    lines.push(INTROS_SIGMA_TACTIC);
    lines.push("");
    lines.push(SUBST_ALL_IN_TACTIC);
    lines.push("");
    lines.push(DESTRUCT_SIGMA_TACTIC);
    lines.push("");
    lines.push("");

    for (const sortName of sortEmissionOrder(sortStore)) {
        const def = getSort(sortStore, sortName);
        lines.push(`Parameter ${def.name} : ${sortHeaderType(sortStore, def)}.`);
    }

    const rules = drawings.filter(ref => ref.drawing.isRule);
    if (rules.length > 0) {
        lines.push("");
    }
    for (const ref of rules) {
        const proof = ref.drawing.rocqProof;
        if (proof && proof.trim()) {
            lines.push(proof.trim());
            continue;
        }
        const registry = newExportRegistry(sortStore);
        const info = ruleTypeInfo(ref.drawing, ref.name, sortStore, registry, { reserveParam: true, includePremises: true });
        if (!info.paramName) {
            throw new Error(`Consistency Check Failed: Rule drawing '${ref.name}' has no rule parameter.`);
        }
        lines.push(`Parameter ${info.paramName} : ${info.type}.`);
    }

    return lines.join("\n") + "\n";
}

export interface DrawingExportNames {
    moduleName: string;
    ruleParam: string | null;
    recordNames: Map<string, string>;
    fieldNames: Map<string, string>;
    equalityFieldNames: Map<string, string[]>;
    model: DrawingModel;
}

export function drawingExportNames(drawing: Drawing, name: string, sortStore: SortStore): DrawingExportNames {
    const registry = new NameRegistry();
    const sortDefs = sortStore.getAllSorts().filter(def => def.name !== "Equality");

    for (const def of sortDefs) {
        registry.reserve(def.name);
    }
    registry.reserve("Equality");
    if (drawing.isRule) {
        registry.reserve("rule");
    }

    const moduleName = registry.unique(sanitizeIdent(name || "Drawing"));
    const model = buildDrawingModel(drawing, name, registry);
    const proofNames = computeProofFieldNames(drawing, model, registry);
    let ruleParam: string | null = null;
    if (drawing.isRule) {
        ruleParam = registry.unique(ruleParamBaseName(name));
    }

    return {
        moduleName,
        ruleParam,
        recordNames: model.recordNames,
        fieldNames: model.fieldNames,
        equalityFieldNames: proofNames.equalityFieldNames,
        model
    };
}
