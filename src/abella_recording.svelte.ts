import { SvelteMap } from 'svelte/reactivity';
import { Artefact, Drawing, DrawingStore, SortStore } from "./index.svelte.ts";
import type { DerivedRule } from "./index.svelte.ts";
import { drawingExportNames, ruleTypeInfo, newExportRegistry, sanitizeIdent } from "./rocq_export";
import type { LayerElement, RuleTypeInfo } from "./rocq_export";
import { renderAbellaForall, renderAbellaRuleType, renderAbellaSigma, toAbellaKindName } from "./abella_export";

function escapeRegExp(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function substituteRuleNames(s: string, rootNameToHost: Map<string, string>): string {
    const substitutions = [...rootNameToHost.entries()].sort(([a], [b]) => b.length - a.length);
    let out = s;
    const tokens: string[] = [];
    substitutions.forEach(([ruleName], i) => {
        const token = `\u0001${i}\u0001`;
        tokens.push(rootNameToHost.get(ruleName)!);
        out = out.replace(new RegExp(`\\b${escapeRegExp(ruleName)}\\b`, "g"), token);
    });
    tokens.forEach((hostName, i) => {
        out = out.split(`\u0001${i}\u0001`).join(hostName);
    });
    return out;
}

function mapElements(elements: LayerElement[], rootNameToHost: Map<string, string>): LayerElement[] {
    return elements.map(el => ({ ...el, type: substituteRuleNames(el.type, rootNameToHost) }));
}

function mapElementsToHost(elements: LayerElement[], rootNameToHost: Map<string, string>): LayerElement[] {
    return elements.map(el => ({
        ...el,
        name: el.kind === "equation" ? el.name : rootNameToHost.get(el.name) ?? el.name,
        type: substituteRuleNames(el.type, rootNameToHost)
    }));
}

function renderPremiseType(
    premiseElements: LayerElement[],
    childElements: LayerElement[],
    rootNameToHost: Map<string, string>,
    sortStore: SortStore
): string {
    return renderAbellaForall(mapElements(premiseElements, rootNameToHost), renderAbellaSigma(mapElements(childElements, rootNameToHost), sortStore), sortStore);
}

function renderPremiseLemmaType(
    rootElements: LayerElement[],
    premiseElements: LayerElement[],
    childElements: LayerElement[],
    rootNameToHost: Map<string, string>,
    sortStore: SortStore
): string {
    const premiseType = renderPremiseType(premiseElements, childElements, rootNameToHost, sortStore);
    return renderAbellaForall(mapElementsToHost(rootElements, rootNameToHost), premiseType, sortStore);
}

const AUTO_HYP_RE = /^H(\d*)$/;

export interface RecordedStatementInfo {
    drawingName: string;
    lemmaName: string;
    proved: boolean;
    isMain: boolean;
}

interface InlineSubgoal {
    index: number;
    lemmaName: string;
    proofName: string;
    premiseType: string;
}

class RecordedStatement {
    readonly drawingName: string;
    readonly lemmaName: string;
    readonly lemmaType: string;
    readonly isMain: boolean;
    bodyLines = $state<string[]>([]);
    proved = $state(false);
    conclusionLayerId = $state<string | null>(null);
    ruleInfo = $state<RuleTypeInfo | null>(null);
    inlineSubgoals = $state<InlineSubgoal[]>([]);
    proofClosedAt = $state<number | null>(null);

    constructor(init: {
        drawingName: string;
        lemmaName: string;
        lemmaType: string;
        isMain: boolean;
        bodyLines: string[];
        conclusionLayerId: string | null;
        ruleInfo: RuleTypeInfo | null;
    }) {
        this.drawingName = init.drawingName;
        this.lemmaName = init.lemmaName;
        this.lemmaType = init.lemmaType;
        this.isMain = init.isMain;
        this.bodyLines = init.bodyLines;
        this.conclusionLayerId = init.conclusionLayerId;
        this.ruleInfo = init.ruleInfo;
    }
}

export class AbellaRecorder {
    private active = $state(false);
    private mainName = $state<string | null>(null);
    private sortStore = $state<SortStore | null>(null);
    private statements = new SvelteMap<string, RecordedStatement>();
    private snapshot: Drawing | null = null;
    private hypCounter = 1;

    public isActive(): boolean {
        return this.active;
    }

    public getRecordedDrawingName(): string | null {
        return this.mainName;
    }

    public takeSnapshot(): Drawing | null {
        const snapshot = this.snapshot;
        this.snapshot = null;
        return snapshot;
    }

    // Abella auto-names hypotheses H, H1, H2, ... when they are not given
    // explicit names. Track the sequent's next auto-generated name so that
    // `assert` results and `apply`/`case`-generated assumptions can be renamed.
    private nextAutoHyp(): string {
        const name = `H${this.hypCounter}`;
        this.hypCounter++;
        return name;
    }

    private startHypCounter(introNames: string[]): void {
        this.hypCounter = 1;
        for (const name of introNames) {
            const m = AUTO_HYP_RE.exec(name);
            if (m) {
                const n = m[1] === "" ? 1 : parseInt(m[1], 10);
                this.hypCounter = Math.max(this.hypCounter, n + 1);
            }
        }
    }

    public start(drawing: Drawing, activeDrawingName: string, sortStore: SortStore): void {
        this.mainName = activeDrawingName;
        this.sortStore = sortStore;
        this.statements.clear();

        const exportNames = drawingExportNames(drawing, activeDrawingName, sortStore);
        const moduleName = exportNames.moduleName;

        const rootLayers = drawing.getAllLayers().filter(l => l.parentId === null);
        if (rootLayers.length === 0) {
            throw new Error(`Consistency Check Failed: Recorded drawing '${activeDrawingName}' has no root layer.`);
        }

        const registry = newExportRegistry(sortStore);
        const info = ruleTypeInfo(drawing, activeDrawingName, sortStore, registry, { reserveParam: false, includePremises: false });
        const lemmaName = `${moduleName}_rule`;
        const introNames = info.rootElements.map(el => el.name);
        this.startHypCounter(introNames);

        this.statements.set(activeDrawingName, new RecordedStatement({
            drawingName: activeDrawingName,
            lemmaName,
            lemmaType: renderAbellaRuleType(info, sortStore),
            isMain: true,
            bodyLines: introNames.length > 0 ? [`intros ${introNames.join(" ")}.`] : [],
            conclusionLayerId: info.conclusionLayerId,
            ruleInfo: info
        }));

        this.snapshot = DrawingStore.cloneDrawing(drawing, sortStore);

        this.active = true;
    }

    public getRecordedStatements(): RecordedStatementInfo[] {
        return Array.from(this.statements.values()).map(s => ({
            drawingName: s.drawingName,
            lemmaName: s.lemmaName,
            proved: s.proved,
            isMain: s.isMain
        }));
    }

    private statementFor(hostActiveName: string): RecordedStatement | null {
        if (!this.active) {
            return null;
        }
        return this.statements.get(hostActiveName) ?? null;
    }

    // Recording any further step supersedes a closed proof: drop the stale
    // closing `witness ... / search.` sequence and revert to pending so the
    // exported script degrades to `skip.` unless the drawing is re-proven.
    private revertProof(stmt: RecordedStatement): void {
        if (!stmt.proved) {
            return;
        }
        if (stmt.proofClosedAt !== null) {
            stmt.bodyLines.splice(stmt.proofClosedAt);
        }
        stmt.proved = false;
        stmt.proofClosedAt = null;
    }

    private registerSubgoal(drawingName: string, lemmaName: string, lemmaType: string, introNames: string[]): void {
        if ([...this.statements.values()].some(s => s.lemmaName === lemmaName)) {
            return;
        }
        this.statements.set(drawingName, new RecordedStatement({
            drawingName,
            lemmaName,
            lemmaType,
            isMain: false,
            bodyLines: introNames.length > 0 ? [`intros ${introNames.join(" ")}.`] : [],
            conclusionLayerId: null,
            ruleInfo: null
        }));
    }

    public recordRuleApply(
        ruleDrawing: Drawing,
        savedRuleName: string,
        application: { matchedArtefacts: Map<Artefact, Artefact> },
        hostDrawing: Drawing,
        applicationResult: { artefacts: Artefact[]; created: Map<Artefact, Artefact>; derivedNames?: string[]; derived?: DerivedRule[] },
        hostActiveName: string,
        sortStore: SortStore
    ): void {
        const stmt = this.statementFor(hostActiveName);
        if (!stmt) {
            return;
        }
        this.revertProof(stmt);

        const ruleNames = drawingExportNames(ruleDrawing, savedRuleName, sortStore);

        const ruleRoot = ruleDrawing.getAllLayers().find(l => l.parentId === null);
        if (!ruleRoot) {
            throw new Error(`Consistency Check Failed: Applied rule '${savedRuleName}' has no root layer.`);
        }

        const hostNames = drawingExportNames(hostDrawing, hostActiveName, sortStore);

        const matchMap = new Map<string, string>();
        for (const [pArt, hArt] of application.matchedArtefacts.entries()) {
            matchMap.set(pArt.id, hArt.id);
        }

        const rootChildren = ruleDrawing.getAllLayers().filter(l => l.parentId === ruleRoot.id);
        const hasConclusion = rootChildren.some(child => {
            const childrenOfChild = ruleDrawing.getAllLayers().filter(l => l.parentId === child.id);
            return childrenOfChild.length === 0;
        });
        const ruleInfo = ruleTypeInfo(ruleDrawing, savedRuleName, sortStore, newExportRegistry(sortStore), {
            reserveParam: true,
            includePremises: hasConclusion
        });
        const ruleParam = ruleInfo.paramName ?? ruleNames.ruleParam;
        if (!ruleParam) {
            throw new Error(`Consistency Check Failed: Rule '${savedRuleName}' has no exported rule parameter.`);
        }

        // Build the rule argument list in the exported type's binder order
        // (artefacts and equalities interleaved topologically). Each argument
        // is the name of the hypothesis the rule is applied to.
        const tupleValues: string[] = [];
        for (const el of ruleInfo.rootElements) {
            const artefactId = el.artefactId;
            if (!artefactId) {
                throw new Error(`Consistency Check Failed: Rule element '${el.name}' in '${savedRuleName}' has no artefact id.`);
            }
            const matchedHostId = matchMap.get(artefactId);
            if (!matchedHostId) {
                throw new Error(`Consistency Check Failed: Pattern artefact '${artefactId}' was not matched in rule application.`);
            }
            const hostFieldName = el.kind === "equation"
                ? hostNames.equalityFieldNames.get(matchedHostId)?.[el.eqIndex ?? 0] ?? hostNames.fieldNames.get(matchedHostId)
                : hostNames.fieldNames.get(matchedHostId);
            if (!hostFieldName) {
                throw new Error(`Consistency Check Failed: No field name assigned for matched host artefact '${matchedHostId}'.`);
            }
            tupleValues.push(hostFieldName);
        }

        const ruleArtById = new Map<string, Artefact>();
        for (const ruleArt of ruleDrawing.getArtefacts()) {
            ruleArtById.set(ruleArt.id, ruleArt);
        }

        const conclusionHostNames = ruleInfo.conclusionElements.map(el => {
            const ruleArt = el.artefactId ? ruleArtById.get(el.artefactId) : undefined;
            if (!ruleArt) {
                throw new Error(`Consistency Check Failed: Conclusion element '${el.name}' in rule '${savedRuleName}' has no artefact id.`);
            }
            const hostCopy = applicationResult.created.get(ruleArt);
            if (!hostCopy) {
                throw new Error(`Consistency Check Failed: No created host artefact for conclusion element '${el.name}' in rule '${savedRuleName}'.`);
            }
            const hostId = hostCopy.id;
            const hostFieldName = el.kind === "equation"
                ? hostNames.equalityFieldNames.get(hostId)?.[el.eqIndex ?? 0] ?? hostNames.fieldNames.get(hostId)
                : hostNames.fieldNames.get(hostId);
            if (!hostFieldName) {
                throw new Error(`Consistency Check Failed: No field name assigned for created host artefact '${el.name}' in rule '${savedRuleName}'.`);
            }
            return hostFieldName;
        });

        const rootNameToHost = new Map<string, string>();
        ruleInfo.rootElements.forEach((el, i) => rootNameToHost.set(el.name, tupleValues[i]));

        const premiseLayerDefs = rootChildren.filter(child => {
            const childrenOfChild = ruleDrawing.getAllLayers().filter(l => l.parentId === child.id);
            return childrenOfChild.length > 0;
        });
        if (premiseLayerDefs.length !== ruleInfo.premiseLayers.length) {
            throw new Error(`Consistency Check Failed: Premise layer mismatch in rule '${savedRuleName}'.`);
        }

        const premiseProofNames: string[] = [];
        for (let k = 0; k < ruleInfo.premiseLayers.length; k++) {
            const premise = ruleInfo.premiseLayers[k];
            const proofName = this.nextAutoHyp();
            const derivedName = `${hostActiveName} > ${savedRuleName} > ${premiseLayerDefs[k].name}`;
            const derivedDrawingName = (applicationResult.derivedNames && applicationResult.derivedNames[k]) || derivedName;
            const lemmaName = `${sanitizeIdent(derivedDrawingName)}_rule`;
            const derivedDrawing = applicationResult.derived?.[k];

            let premiseType: string;
            let lemmaType: string;
            let premiseIntroNames: string[];
            if (derivedDrawing) {
                lemmaType = ruleTypeInfo(derivedDrawing.drawing, derivedDrawingName, sortStore, newExportRegistry(sortStore), {
                    reserveParam: false,
                    includePremises: false
                }).type;

                if (derivedDrawing.created) {
                    const derivedExport = drawingExportNames(derivedDrawing.drawing, derivedDrawingName, sortStore);
                    const effectiveNameMap = new Map<string, string>(rootNameToHost);

                    for (const el of [...premise.premiseElements, ...premise.childElements]) {
                        const ruleArt = el.artefactId ? ruleArtById.get(el.artefactId) : undefined;
                        const derivedArt = ruleArt ? derivedDrawing.created.get(ruleArt) : undefined;
                        if (derivedArt) {
                            const derivedArtId = derivedArt.id;
                            const derivedFieldName = el.kind === "equation"
                                ? derivedExport.equalityFieldNames.get(derivedArtId)?.[el.eqIndex ?? 0] ?? derivedExport.fieldNames.get(derivedArtId)
                                : derivedExport.fieldNames.get(derivedArtId);
                            if (derivedFieldName) {
                                effectiveNameMap.set(el.name, derivedFieldName);
                            }
                        }
                    }

                    const mappedPremiseElements = premise.premiseElements.map(el => ({
                        ...el,
                        name: effectiveNameMap.get(el.name) ?? el.name,
                        type: substituteRuleNames(el.type, effectiveNameMap)
                    }));
                    const mappedChildElements = premise.childElements.map(el => ({
                        ...el,
                        name: effectiveNameMap.get(el.name) ?? el.name,
                        type: substituteRuleNames(el.type, effectiveNameMap)
                    }));
                    premiseType = renderAbellaForall(mappedPremiseElements, renderAbellaSigma(mappedChildElements, sortStore), sortStore);
                    premiseIntroNames = mappedPremiseElements.filter(el => el.kind === "artefact").map(el => el.name);
                } else {
                    premiseType = renderPremiseType(premise.premiseElements, premise.childElements, rootNameToHost, sortStore);
                    premiseIntroNames = premise.premiseElements.filter(el => el.kind === "artefact")
                        .map(el => rootNameToHost.get(el.name) ?? el.name);
                }
            } else {
                premiseType = renderPremiseType(premise.premiseElements, premise.childElements, rootNameToHost, sortStore);
                premiseIntroNames = premise.premiseElements.filter(el => el.kind === "artefact")
                    .map(el => rootNameToHost.get(el.name) ?? el.name);
                lemmaType = renderPremiseLemmaType(ruleInfo.rootElements, premise.premiseElements, premise.childElements, rootNameToHost, sortStore);
            }
            this.registerSubgoal(derivedDrawingName, lemmaName, lemmaType, premiseIntroNames);
            stmt.bodyLines.push(`assert (${premiseType}).`);
            stmt.inlineSubgoals.push({ index: stmt.bodyLines.length - 1, lemmaName, proofName, premiseType });
            premiseProofNames.push(proofName);
        }

        const fullArgsStr = [...tupleValues, ...premiseProofNames].join(" ");

        // Do not emit a bare `apply`: its conclusion has no matching goal unless
        // we first pose it as an assertion whose `exists` binders carry the host
        // conclusion names. `assert` fixes those names, `apply` solves the
        // assertion, and `case` introduces the named variables directly, so no
        // `rename` of the case-created hypothesis is needed afterwards.
        if (ruleInfo.conclusionElements.length === 0) {
            stmt.bodyLines.push(`apply ${ruleParam} to ${fullArgsStr}.`);
        } else {
            const mappedConclusionElements = ruleInfo.conclusionElements.map((el, i) => ({
                ...el,
                name: el.kind === "equation" ? el.name : conclusionHostNames[i],
                type: substituteRuleNames(el.type, rootNameToHost)
            }));
            const conclusionAssert = renderAbellaSigma(mappedConclusionElements, sortStore);
            stmt.bodyLines.push(`assert (${conclusionAssert}).`);
            stmt.bodyLines.push(`apply ${ruleParam} to ${fullArgsStr}.`);
            stmt.bodyLines.push(`case ${this.nextAutoHyp()}.`);
        }
    }

    public recordRename(oldFieldName: string, newFieldName: string, hostActiveName: string): void {
        const stmt = this.statementFor(hostActiveName);
        if (!stmt) {
            return;
        }
        this.revertProof(stmt);
        if (oldFieldName !== newFieldName) {
            stmt.bodyLines.push(`rename ${oldFieldName} to ${newFieldName}.`);
        }
    }

    public recordDuplicate(
        hostDrawing: Drawing,
        original: Artefact,
        created: Artefact,
        hostActiveName: string,
        sortStore: SortStore
    ): void {
        const stmt = this.statementFor(hostActiveName);
        if (!stmt) {
            return;
        }
        this.revertProof(stmt);

        const hostNames = drawingExportNames(hostDrawing, hostActiveName, sortStore);

        const originalId = original.id;
        const originalField = hostNames.fieldNames.get(originalId);
        if (!originalField) {
            throw new Error(`Consistency Check Failed: No field name assigned for original artefact '${original.data.label || original.sortName}'.`);
        }

        const createdId = created.id;
        const createdField = hostNames.fieldNames.get(createdId);
        if (!createdField) {
            throw new Error(`Consistency Check Failed: No field name assigned for created duplicate artefact '${created.data.label || created.sortName}'.`);
        }

        const sortDef = sortStore.getSort(created.sortName);
        if (!sortDef) {
            throw new Error(`Consistency Check Failed: Sort '${created.sortName}' is not defined.`);
        }

        const depFieldNames: string[] = [];
        for (const [depKey] of Object.entries(sortDef.dependencies)) {
            const dep = created.dependencies[depKey];
            if (!dep) {
                throw new Error(`Consistency Check Failed: Missing dependency '${depKey}' for duplicated artefact.`);
            }
            const depId = dep.id;
            const depField = hostNames.fieldNames.get(depId);
            if (!depField) {
                throw new Error(`Consistency Check Failed: No field name assigned for dependency '${depKey}' of duplicated artefact.`);
            }
            depFieldNames.push(depField);
        }

        const relType = depFieldNames.length === 0
            ? toAbellaKindName(created.sortName)
            : `${toAbellaKindName(created.sortName)} ${depFieldNames.join(" ")}`;

        stmt.bodyLines.push(`assert (${relType} ${originalField}).`);
        stmt.bodyLines.push("search.");
        stmt.bodyLines.push(`rename ${this.nextAutoHyp()} to ${createdField}.`);
    }

    public recordProveSuccess(hostDrawing: Drawing, layerId: string | null, match: Map<Artefact, Artefact> | null, hostActiveName: string): void {
        const stmt = this.statementFor(hostActiveName);
        if (!stmt) {
            return;
        }
        if (stmt.proved) {
            return;
        }

        if (!stmt.ruleInfo) {
            if (!this.sortStore) {
                throw new Error("Consistency Check Failed: No sort store available; start a recording before proving a layer.");
            }
            const info = ruleTypeInfo(hostDrawing, hostActiveName, this.sortStore, newExportRegistry(this.sortStore), {
                reserveParam: false,
                includePremises: false
            });
            stmt.ruleInfo = info;
            stmt.conclusionLayerId = info.conclusionLayerId;
        }

        if (stmt.conclusionLayerId === null) {
            stmt.bodyLines.push("search.");
            stmt.proved = true;
            stmt.proofClosedAt = stmt.bodyLines.length - 1;
            return;
        }

        if (layerId !== stmt.conclusionLayerId) {
            throw new Error(`Consistency Check Failed: Recording rule for drawing '${hostActiveName}' has conclusion layer '${stmt.conclusionLayerId}', cannot prove layer '${layerId}'.`);
        }
        if (!match) {
            throw new Error(`Consistency Check Failed: Recording rule for drawing '${hostActiveName}' has conclusion layer '${stmt.conclusionLayerId}' and requires a successful match to produce an exact proof term.`);
        }

        const info = stmt.ruleInfo;
        const hostNames = drawingExportNames(hostDrawing, hostActiveName, this.sortStore!);

        const idToLiveArt = new Map<string, Artefact>();
        for (const art of hostDrawing.getArtefacts()) {
            idToLiveArt.set(art.id, art);
        }

        // Only artefact conclusions are existentially bound in the Abella
        // statement; equality conjuncts are settled by `search.`.
        const artefactElements = info.conclusionElements.filter(el => el.kind === "artefact");
        if (artefactElements.length === 0) {
            stmt.bodyLines.push("search.");
            stmt.proved = true;
            stmt.proofClosedAt = stmt.bodyLines.length - 1;
            return;
        }

        const witnessNames: string[] = [];
        for (const el of artefactElements) {
            const live = el.artefactId ? idToLiveArt.get(el.artefactId) : undefined;
            const parent = live ? match.get(live) : undefined;
            if (!parent) {
                throw new Error(`Consistency Check Failed: No host parent matched for artefact '${el.artefactId}' in conclusion layer '${stmt.conclusionLayerId}'.`);
            }
            const parentDataId = parent.id;
            const hostFieldName = hostNames.fieldNames.get(parentDataId);
            if (!hostFieldName) {
                throw new Error(`Consistency Check Failed: Matched parent for '${el.artefactId}' has no assigned field name in '${hostActiveName}'.`);
            }
            witnessNames.push(hostFieldName);
        }

        const startIndex = stmt.bodyLines.length;
        stmt.bodyLines.push(`witness ${witnessNames.join(" ")}.`);
        for (let i = 0; i < info.conclusionElements.length - 1; i++) {
            stmt.bodyLines.push("split.");
        }
        stmt.bodyLines.push("search.");
        stmt.proved = true;
        stmt.proofClosedAt = startIndex;
    }

    public stop(): string {
        if (!this.active) {
            throw new Error("Consistency Check Failed: Abella recording is not active.");
        }
        this.active = false;

        const byLemmaName = new Map<string, RecordedStatement>();
        for (const s of this.statements.values()) {
            byLemmaName.set(s.lemmaName, s);
        }

        const isClosed = (stmt: RecordedStatement): boolean => {
            const lastLine = stmt.bodyLines[stmt.bodyLines.length - 1] ?? "";
            return stmt.proved && lastLine.startsWith("search.");
        };

        const renderProof = (stmt: RecordedStatement, indent: string): { lines: string[]; unproved: boolean } => {
            const lines: string[] = [];
            let unproved = !isClosed(stmt);
            stmt.bodyLines.forEach((line, i) => {
                const inline = stmt.inlineSubgoals.find(g => g.index === i);
                if (!inline) {
                    lines.push(indent + line);
                    return;
                }
                const sub = byLemmaName.get(inline.lemmaName);
                if (!sub) {
                    throw new Error(`Consistency Check Failed: Inline subgoal '${inline.lemmaName}' has no recorded statement.`);
                }
                lines.push(indent + line);
                const subRepr = renderProof(sub, indent + "  ");
                lines.push(...subRepr.lines);
                if (subRepr.unproved) {
                    lines.push(indent + "  skip.");
                    unproved = true;
                }
            });
            return { lines, unproved };
        };

        const main = Array.from(this.statements.values()).find(s => s.isMain);
        if (!main) {
            throw new Error("Consistency Check Failed: No main recorded statement found; recording never started.");
        }

        const mainRepr = renderProof(main, "");
        const script = mainRepr.lines;
        if (mainRepr.unproved) {
            script.push("skip.");
        }
        this.statements.clear();
        this.mainName = null;
        this.sortStore = null;
        this.snapshot = null;
        return `Theorem ${main.lemmaName} : ${main.lemmaType}.\n${script.join("\n")}\n`;
    }
}