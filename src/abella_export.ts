import type { SortDefinition, SortStore, Drawing } from "./index.svelte.ts";
import { newExportRegistry, ruleTypeInfo } from "./rocq_export";
import type { LayerElement, RuleTypeInfo } from "./rocq_export";

// ---------------------------------------------------------------------------
// Abella export
//
// Every Abella identifier (kind names and the predicate constants declared for
// each sort) must start with a lowercase letter. Each sort is therefore first-
// letter lowercased, and that spelling is used consistently for the `Kind`
// declaration, the `Type` declaration's constant and argument kinds, and the
// relation symbols inside recorded rule types, e.g.:
//
//   Kind vertex type.
//   Type vertex vertex -> prop.
//   Kind edge type.
//   Type edge vertex -> vertex -> edge -> prop.
//
// Rules become `Theorem <name> : <type>.` skipped with the unsound `skip.`
// tactic, unless the drawing carries an attached Abella proof.
// ---------------------------------------------------------------------------

export function toAbellaKindName(sortName: string): string {
    return /^[A-Z]/.test(sortName) ? sortName[0].toLowerCase() + sortName.slice(1) : sortName;
}

function escapeRegExp(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function substituteKindNames(s: string, sortStore: SortStore): string {
    const sorts = sortStore.getAllSorts()
        .filter(def => def.name !== "Equality" && /^[A-Z]/.test(def.name))
        .map(def => ({ from: def.name, to: toAbellaKindName(def.name) }))
        .sort((a, b) => b.from.length - a.from.length);
    if (sorts.length === 0) {
        return s;
    }
    const tokens: string[] = [];
    let out = s;
    sorts.forEach(({ from }, i) => {
        const token = `\u0001${i}\u0001`;
        tokens.push(sorts[i].to);
        out = out.replace(new RegExp(`\\b${escapeRegExp(from)}\\b`, "g"), token);
    });
    tokens.forEach((to, i) => {
        out = out.split(`\u0001${i}\u0001`).join(to);
    });
    return out;
}

function getSort(sortStore: SortStore, name: string): SortDefinition {
    const def = sortStore.getSort(name);
    if (!def) {
        throw new Error(`Consistency Check Failed: Sort '${name}' is not defined.`);
    }
    return def;
}

export function renderAbellaSigma(elements: LayerElement[], sortStore: SortStore): string {
    const mappedElements = elements.map(el => ({ ...el, type: substituteKindNames(el.type, sortStore) }));
    const artefacts = mappedElements.filter(el => el.kind === "artefact");
    if (artefacts.length === 0) {
        const conjuncts = mappedElements.map(el => el.type);
        return conjuncts.length === 0 ? "True" : conjuncts.join(" /\\ ");
    }
    const names = artefacts.map(el => el.name).join(" ");
    const rels = mappedElements.map(el => (el.kind === "equation" ? el.type : `${el.type} ${el.name}`));
    return `exists ${names}, ${rels.join(" /\\ ")}`;
}

export function renderAbellaForall(elements: LayerElement[], rest: string, sortStore: SortStore): string {
    if (elements.length === 0) {
        return rest;
    }
    const names = elements.filter(el => el.kind !== "equation").map(el => el.name);
    const predicates = elements.map(el => {
        const type = substituteKindNames(el.type, sortStore);
        return el.kind === "equation" ? type : `${type} ${el.name}`;
    });
    const head = names.length === 0 ? "" : `forall ${names.join(" ")}, `;
    return `${head}${predicates.join(" -> ")} -> ${rest}`;
}

export function renderAbellaRuleType(info: RuleTypeInfo, sortStore: SortStore): string {
    const conclusion = renderAbellaSigma(info.conclusionElements, sortStore);
    if (info.premiseLayers.length === 0) {
        return renderAbellaForall(info.rootElements, conclusion, sortStore);
    }
    const premiseStrs = info.premiseLayers.map(p =>
        `(${renderAbellaForall(p.premiseElements, renderAbellaSigma(p.childElements, sortStore), sortStore)})`
    );
    return renderAbellaForall(info.rootElements, `${premiseStrs.join(" -> ")} -> ${conclusion}`, sortStore);
}

export function exportDrawingsToAbella(
    drawings: Array<{ name: string; drawing: Drawing }>,
    sortStore: SortStore
): string {
    if (drawings.length === 0) {
        throw new Error("Consistency Check Failed: No drawings selected for export.");
    }

    const lines: string[] = [];

    const sortDefs = sortStore.getAllSorts().filter(def => def.name !== "Equality");
    const emittedSorts = new Set<string>();
    const emitSort = (name: string): void => {
        if (emittedSorts.has(name)) {
            return;
        }
        const def = getSort(sortStore, name);
        for (const [, depSortName] of Object.entries(def.dependencies)) {
            if (depSortName !== "Equality") {
                emitSort(depSortName);
            }
        }
        emittedSorts.add(name);
        const deps = Object.entries(def.dependencies).map(([, depSortName]) => toAbellaKindName(depSortName));
        const kindName = toAbellaKindName(def.name);
        const argKinds = deps.length === 0 ? [kindName] : [...deps, kindName];
        lines.push(`Kind ${kindName} type.`);
        lines.push(`Type ${kindName} ${argKinds.join(" -> ")} -> prop.`);
    };
    for (const def of sortDefs) {
        emitSort(def.name);
    }

    const rules = drawings.filter(ref => ref.drawing.isRule);
    if (rules.length > 0) {
        lines.push("");
    }
    for (const ref of rules) {
        const proof = ref.drawing.abellaProof;
        if (proof && proof.trim()) {
            lines.push(proof.trim());
            continue;
        }
        const registry = newExportRegistry(sortStore);
        const info = ruleTypeInfo(ref.drawing, ref.name, sortStore, registry, { reserveParam: true, includePremises: true });
        if (!info.paramName) {
            throw new Error(`Consistency Check Failed: Rule drawing '${ref.name}' has no rule parameter.`);
        }
        lines.push(`Theorem ${info.paramName} : ${renderAbellaRuleType(info, sortStore)}.\nskip.`);
    }

    return lines.join("\n") + "\n";
}