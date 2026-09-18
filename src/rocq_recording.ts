import { Artefact, Drawing, DrawingStore, SortStore } from "./index.svelte.ts";
import type { DerivedRule } from "./index.svelte.ts";
import { drawingExportNames, ruleTypeInfo, newExportRegistry, renderExactTerm, renderForallChain, renderSigma, sanitizeIdent } from "./rocq_export";
import type { LayerElement, RuleTypeInfo } from "./rocq_export";

function escapeRegExp(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function substituteRuleNames(s: string, rootNameToHost: Map<string, string>): string {
    // Substitute rule root names for their matched host names in two passes so
    // a host name can never be re-matched by another substitution.
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
    rootNameToHost: Map<string, string>
): string {
    return renderForallChain(mapElements(premiseElements, rootNameToHost), renderSigma(mapElements(childElements, rootNameToHost)));
}

function renderPremiseLemmaType(
    rootElements: LayerElement[],
    premiseElements: LayerElement[],
    childElements: LayerElement[],
    rootNameToHost: Map<string, string>
): string {
    const premiseType = renderPremiseType(premiseElements, childElements, rootNameToHost);
    return renderForallChain(mapElementsToHost(rootElements, rootNameToHost), premiseType);
}

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

interface RecordedStatement {
    drawingName: string;
    lemmaName: string;
    lemmaType: string;
    bodyLines: string[];
    proved: boolean;
    isMain: boolean;
    conclusionLayerId: string | null;
    ruleInfo: RuleTypeInfo | null;
    inlineSubgoals: InlineSubgoal[];
    proofClosedAt: number | null;
}

export class RocqRecorder {
    private active: boolean = false;
    private mainName: string | null = null;
    private sortStore: SortStore | null = null;
    private statements: Map<string, RecordedStatement> = new Map();

    public isActive(): boolean {
        return this.active;
    }

    public getRecordedDrawingName(): string | null {
        return this.mainName;
    }

    public start(drawing: Drawing, activeDrawingName: string, sortStore: SortStore): void {
        this.mainName = activeDrawingName;
        this.sortStore = sortStore;
        this.statements = new Map();

        const savedDrawing = DrawingStore.drawingToSavedDrawing(activeDrawingName, drawing);
        const exportNames = drawingExportNames(savedDrawing, sortStore);
        const moduleName = exportNames.moduleName;

        const rootLayers = savedDrawing.layers.filter(l => l.parentId === null);
        if (rootLayers.length === 0) {
            throw new Error(`Consistency Check Failed: Recorded drawing '${activeDrawingName}' has no root layer.`);
        }

        const registry = newExportRegistry(sortStore);
        const info = ruleTypeInfo(savedDrawing, sortStore, registry, { reserveParam: false, includePremises: false });
        const lemmaName = `${moduleName}_rule`;

        this.statements.set(activeDrawingName, {
            drawingName: activeDrawingName,
            lemmaName,
            lemmaType: info.type,
            bodyLines: ["intros_sigma ()."],
            proved: false,
            isMain: true,
            conclusionLayerId: info.conclusionLayerId,
            ruleInfo: info,
            inlineSubgoals: [],
            proofClosedAt: null
        });

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

    // A recorded proof is tied to the drawing state at the moment it closed.
    // Recording any further step supersedes that closed proof: drop the stale
    // closing `exact ...` line and revert to pending so the exported script
    // degrades to `Admitted.` unless the drawing is re-proven afterwards.
    private revertProof(stmt: RecordedStatement): void {
        if (!stmt.proved) {
            return;
        }
        if (stmt.proofClosedAt !== null) {
            stmt.bodyLines.splice(stmt.proofClosedAt, 1);
        }
        stmt.proved = false;
        stmt.proofClosedAt = null;
    }

    private registerSubgoal(drawingName: string, lemmaName: string, lemmaType: string): void {
        if ([...this.statements.values()].some(s => s.lemmaName === lemmaName)) {
            return;
        }
        this.statements.set(drawingName, {
            drawingName,
            lemmaName,
            lemmaType,
            bodyLines: ["intros_sigma ()."],
            proved: false,
            isMain: false,
            conclusionLayerId: null,
            ruleInfo: null,
            inlineSubgoals: [],
            proofClosedAt: null
        });
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

        const savedRule = DrawingStore.drawingToSavedDrawing(savedRuleName, ruleDrawing);
        const ruleNames = drawingExportNames(savedRule, sortStore);

        const ruleRoot = savedRule.layers.find(l => l.parentId === null);
        if (!ruleRoot) {
            throw new Error(`Consistency Check Failed: Applied rule '${savedRuleName}' has no root layer.`);
        }

        const savedHost = DrawingStore.drawingToSavedDrawing(hostActiveName, hostDrawing);
        const hostNames = drawingExportNames(savedHost, sortStore);

        // Map pattern artefact ID -> matched host artefact ID
        const matchMap = new Map<string, string>();
        for (const [pArt, hArt] of application.matchedArtefacts.entries()) {
            const pId = pArt.id;
            const hId = hArt.id;
            matchMap.set(pId, hId);
        }

        // The rule's own structure: root elements give the canonical
        // (dependency-ordered) argument order of the exported rule parameter.
        const rootChildren = savedRule.layers.filter(l => l.parentId === ruleRoot.id);
        const hasConclusion = rootChildren.some(child => {
            const childrenOfChild = savedRule.layers.filter(l => l.parentId === child.id);
            return childrenOfChild.length === 0;
        });
        const ruleInfo = ruleTypeInfo(savedRule, sortStore, newExportRegistry(sortStore), {
            reserveParam: true,
            includePremises: hasConclusion
        });
        const ruleParam = ruleInfo.paramName ?? ruleNames.ruleParam;
        if (!ruleParam) {
            throw new Error(`Consistency Check Failed: Rule '${savedRuleName}' has no exported rule parameter.`);
        }

        // Build the rule argument list in the exported type's binder order
        // (artefacts and equalities interleaved topologically).
        const tupleValues: string[] = [];
        for (const el of ruleInfo.rootElements) {
            if (el.kind === "equation") {
                // After the header's `subst_all ().` the matched host arguments are
                // definitionally equal, so the constraint is satisfied by `eq_refl`.
                tupleValues.push("eq_refl");
                continue;
            }
            const artefactId = el.artefactId;
            if (!artefactId) {
                throw new Error(`Consistency Check Failed: Rule element '${el.name}' in '${savedRuleName}' has no artefact id.`);
            }
            const matchedHostId = matchMap.get(artefactId);
            if (!matchedHostId) {
                throw new Error(`Consistency Check Failed: Pattern artefact '${artefactId}' was not matched in rule application.`);
            }
            const hostFieldName = hostNames.fieldNames.get(matchedHostId);
            if (!hostFieldName) {
                throw new Error(`Consistency Check Failed: No field name assigned for matched host artefact '${matchedHostId}'.`);
            }
            tupleValues.push(hostFieldName);
        }

        const argsStr = tupleValues.join(" ");

        // Names for the conclusion binders, in the exported conclusion's
        // (dependency-ordered) order, always sourced from the host layer:
        // created host copies for artefacts/equalities.
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

        const assertName = conclusionHostNames[0] ?? "h";
        const conclusionArity = ruleInfo.conclusionElements.length;

        // Second-order rules: assert each premise as an inline proof whose body
        // is the recorded proof of the derived drawing. The derived drawing is
        // registered as its own recorded statement (a subgoal) whose real proof
        // can be supplied later by loading and proving that drawing; when the
        // subgoal stays unproved its inline proof degrades to `admit`. and the
        // enclosing lemma ends with `Admitted.`.
        const rootNameToHost = new Map<string, string>();
        ruleInfo.rootElements.forEach((el, i) => rootNameToHost.set(el.name, tupleValues[i]));

        // The premise layers in the same order as ruleInfo.premiseLayers: the
        // root's children that have a child layer of their own.
        const premiseLayerDefs = rootChildren.filter(child => {
            const childrenOfChild = savedRule.layers.filter(l => l.parentId === child.id);
            return childrenOfChild.length > 0;
        });
        if (premiseLayerDefs.length !== ruleInfo.premiseLayers.length) {
            throw new Error(`Consistency Check Failed: Premise layer mismatch in rule '${savedRuleName}'.`);
        }

        const premiseProofNames: string[] = [];
        for (let k = 0; k < ruleInfo.premiseLayers.length; k++) {
            const premise = ruleInfo.premiseLayers[k];
            const proofName = `Hpremise${k + 1}`;
            const derivedName = `${hostActiveName} > ${savedRuleName} > ${premiseLayerDefs[k].name}`;
            const derivedDrawingName = (applicationResult.derivedNames && applicationResult.derivedNames[k]) || derivedName;
            const lemmaName = `${sanitizeIdent(derivedDrawingName)}_rule`;
            const derivedDrawing = applicationResult.derived?.[k];

            let premiseType: string;
            let lemmaType: string;
            if (derivedDrawing) {
                const derivedSaved = DrawingStore.drawingToSavedDrawing(derivedDrawingName, derivedDrawing.drawing);
                lemmaType = ruleTypeInfo(derivedSaved, sortStore, newExportRegistry(sortStore), {
                    reserveParam: false,
                    includePremises: false
                }).type;

                if (derivedDrawing.created) {
                    const derivedExport = drawingExportNames(derivedSaved, sortStore);
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
                    premiseType = renderForallChain(mappedPremiseElements, renderSigma(mappedChildElements));
                } else {
                    premiseType = renderPremiseType(premise.premiseElements, premise.childElements, rootNameToHost);
                }
            } else {
                premiseType = renderPremiseType(premise.premiseElements, premise.childElements, rootNameToHost);
                lemmaType = renderPremiseLemmaType(ruleInfo.rootElements, premise.premiseElements, premise.childElements, rootNameToHost);
            }
            this.registerSubgoal(derivedDrawingName, lemmaName, lemmaType);
            stmt.bodyLines.push(`assert (${proofName} : ${premiseType}).`);
            stmt.inlineSubgoals.push({ index: stmt.bodyLines.length - 1, lemmaName, proofName, premiseType });
            premiseProofNames.push(proofName);
        }

        if (premiseProofNames.length > 0) {
            const fullArgsStr = [...tupleValues, ...premiseProofNames].join(" ");
            if (conclusionArity === 0) {
                stmt.bodyLines.push(`assert (${assertName} := @${ruleParam} ${fullArgsStr}).`);
            } else if (conclusionArity === 1) {
                stmt.bodyLines.push(`destruct_sigma (@${ruleParam} ${fullArgsStr}) as ${conclusionHostNames.join(" ")}.`);
            } else {
                stmt.bodyLines.push(`assert (${assertName} := @${ruleParam} ${fullArgsStr}); destruct_sigma ${assertName} as ${conclusionHostNames.join(" ")}.`);
            }
            return;
        }

        if (conclusionArity === 0) {
            stmt.bodyLines.push(`assert (${assertName} := @${ruleParam} ${argsStr}).`);
        } else {
            stmt.bodyLines.push(`destruct_sigma (@${ruleParam} ${argsStr}) as ${conclusionHostNames.join(" ")}.`);
        }
    }

    public recordRename(oldFieldName: string, newFieldName: string, hostActiveName: string): void {
        const stmt = this.statementFor(hostActiveName);
        if (!stmt) {
            return;
        }
        this.revertProof(stmt);
        if (oldFieldName !== newFieldName) {
            stmt.bodyLines.push(`rename ${oldFieldName} into ${newFieldName}.`);
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

        const savedHost = DrawingStore.drawingToSavedDrawing(hostActiveName, hostDrawing);
        const hostNames = drawingExportNames(savedHost, sortStore);

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

        const typeStr = depFieldNames.length === 0 ? created.sortName : `${created.sortName} ${depFieldNames.join(" ")}`;
        stmt.bodyLines.push(`set (${createdField} := ${originalField} : ${typeStr}).`);
    }

    public recordProveSuccess(hostDrawing: Drawing, layerId: string | null, match: Map<Artefact, Artefact> | null, hostActiveName: string): void {
        const stmt = this.statementFor(hostActiveName);
        if (!stmt) {
            return;
        }
        if (stmt.proved) {
            return;
        }

        // Subgoal statements are registered before their goal layer is known;
        // resolve it lazily from the live drawing before deciding whether the
        // statement has a provable conclusion layer at all.
        if (!stmt.ruleInfo) {
            if (!this.sortStore) {
                throw new Error("Consistency Check Failed: No sort store available; start a recording before proving a layer.");
            }
            const savedHost = DrawingStore.drawingToSavedDrawing(hostActiveName, hostDrawing);
            const info = ruleTypeInfo(savedHost, this.sortStore, newExportRegistry(this.sortStore), {
                reserveParam: false,
                includePremises: false
            });
            stmt.ruleInfo = info;
            stmt.conclusionLayerId = info.conclusionLayerId;
        }

        if (stmt.conclusionLayerId === null) {
            stmt.bodyLines.push("exact I.");
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
        const hostNames = drawingExportNames(DrawingStore.drawingToSavedDrawing(hostActiveName, hostDrawing), this.sortStore!);

        const idToLiveArt = new Map<string, Artefact>();
        for (const art of hostDrawing.getArtefacts()) {
            idToLiveArt.set(art.id, art);
        }

        const witnessFor = (el: LayerElement): string => {
            switch (el.kind) {
                case "artefact": {
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
                    return hostFieldName;
                }
                case "equation":
                    return "eq_refl";
            }
        };

        stmt.bodyLines.push(`exact ${renderExactTerm(info.conclusionElements, witnessFor)}.`);
        stmt.proved = true;
        stmt.proofClosedAt = stmt.bodyLines.length - 1;
    }

    public stop(): string {
        if (!this.active) {
            throw new Error("Consistency Check Failed: Rocq recording is not active.");
        }
        this.active = false;

        const byLemmaName = new Map<string, RecordedStatement>();
        for (const s of this.statements.values()) {
            byLemmaName.set(s.lemmaName, s);
        }

        // A statement's proof is closed when its final `exact` was recorded, or
        // when an unproved main drawing has no conclusion layer and is trivially
        // finished by `exact I.`.
        const isClosed = (stmt: RecordedStatement): boolean => {
            const lastLine = stmt.bodyLines[stmt.bodyLines.length - 1] ?? "";
            const autoCloseMain = !stmt.proved && stmt.isMain && stmt.conclusionLayerId === null && !lastLine.startsWith("exact ");
            return (stmt.proved && lastLine.startsWith("exact ")) || autoCloseMain;
        };

        // Render a statement's proof, expanding inline subgoals recursively.
        // `unproved` is true whenever the statement's own goal is left open or
        // any inlined subgoal proof was admitted, in which case the enclosing
        // lemma must be closed with `Admitted.` rather than `Qed.`.
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
                const subRepr = renderProof(sub, indent + "  ");
                lines.push(indent + `assert (${inline.proofName} : ${inline.premiseType}). {`);
                lines.push(...subRepr.lines);
                if (subRepr.unproved) {
                    lines.push(indent + "  admit.");
                    unproved = true;
                }
                lines.push(indent + "}");
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
            script.push("Admitted.");
        } else {
            const lastLine = main.bodyLines[main.bodyLines.length - 1] ?? "";
            const autoCloseMain = !main.proved && main.conclusionLayerId === null && !lastLine.startsWith("exact ");
            if (autoCloseMain) {
                script.push("exact I.");
            }
            script.push("Qed.");
        }
        this.statements = new Map();
        this.mainName = null;
        this.sortStore = null;
        return `Lemma ${main.lemmaName} : ${main.lemmaType}.\n${script.join("\n")}\n`;
    }
}