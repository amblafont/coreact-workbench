import { Artefact, Drawing, DrawingStore, SortStore } from "./index";
import { drawingExportNames, ruleTypeInfo, newExportRegistry, renderExactTerm, renderForallChain, renderSigma, sanitizeIdent } from "./rocq_export";
import type { LayerElement, RuleTypeInfo } from "./rocq_export";

function artefactToDataId(drawing: Drawing, art: Artefact): string {
    const idx = drawing.getArtefacts().indexOf(art);
    if (idx === -1) {
        throw new Error("Consistency Check Failed: Artefact does not belong to drawing.");
    }
    return `art_${idx}`;
}

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

interface RecordedStatement {
    drawingName: string;
    lemmaName: string;
    lemmaType: string;
    bodyLines: string[];
    proved: boolean;
    isMain: boolean;
    conclusionLayerId: string | null;
    ruleInfo: RuleTypeInfo | null;
    dependsOn: Set<string>;
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
            dependsOn: new Set(),
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
            dependsOn: new Set(),
            proofClosedAt: null
        });
    }

    public recordRuleApply(
        ruleDrawing: Drawing,
        savedRuleName: string,
        application: { matchedArtefacts: Map<Artefact, Artefact> },
        hostDrawing: Drawing,
        applicationResult: { artefacts: Artefact[]; created: Map<Artefact, Artefact>; derivedNames?: string[] },
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
            const pId = artefactToDataId(ruleDrawing, pArt);
            const hId = artefactToDataId(hostDrawing, hArt);
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
        const ruleParam = ruleNames.ruleParam;
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
            ruleArtById.set(artefactToDataId(ruleDrawing, ruleArt), ruleArt);
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
            const hostId = artefactToDataId(hostDrawing, hostCopy);
            const hostFieldName = el.kind === "equation"
                ? hostNames.equalityFieldNames.get(hostId) ?? hostNames.fieldNames.get(hostId)
                : hostNames.fieldNames.get(hostId);
            if (!hostFieldName) {
                throw new Error(`Consistency Check Failed: No field name assigned for created host artefact '${el.name}' in rule '${savedRuleName}'.`);
            }
            return hostFieldName;
        });

        const assertName = conclusionHostNames[0] ?? "h";
        const conclusionArity = ruleInfo.conclusionElements.length;

        // Second-order rules: assert each premise via `eauto using` the derived
        // drawing's rule. Each derived drawing is registered as its own recorded
        // statement (a subgoal) whose real proof can be supplied later by loading
        // and proving that drawing; unproved subgoals degrade to `Admitted.`.
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
            const premiseType = renderPremiseType(premise.premiseElements, premise.childElements, rootNameToHost);
            const proofName = `Hpremise${k + 1}`;
            const derivedName = `${hostActiveName} > ${savedRuleName} > ${premiseLayerDefs[k].name}`;
            const derivedDrawingName = (applicationResult.derivedNames && applicationResult.derivedNames[k]) || derivedName;
            const lemmaName = `${sanitizeIdent(derivedDrawingName)}_rule`;
            this.registerSubgoal(derivedDrawingName, lemmaName, renderPremiseLemmaType(ruleInfo.rootElements, premise.premiseElements, premise.childElements, rootNameToHost));
            stmt.dependsOn.add(derivedDrawingName);
            stmt.bodyLines.push(`assert (${proofName} : ${premiseType}) by eauto using ${lemmaName}.`);
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

        const originalId = artefactToDataId(hostDrawing, original);
        const originalField = hostNames.fieldNames.get(originalId);
        if (!originalField) {
            throw new Error(`Consistency Check Failed: No field name assigned for original artefact '${original.data.label || original.sortName}'.`);
        }

        const createdId = artefactToDataId(hostDrawing, created);
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
            const depId = artefactToDataId(hostDrawing, dep);
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
            idToLiveArt.set(artefactToDataId(hostDrawing, art), art);
        }

        const witnessFor = (el: LayerElement): string => {
            switch (el.kind) {
                case "artefact": {
                    const live = el.artefactId ? idToLiveArt.get(el.artefactId) : undefined;
                    const parent = live ? match.get(live) : undefined;
                    if (!parent) {
                        throw new Error(`Consistency Check Failed: No host parent matched for artefact '${el.artefactId}' in conclusion layer '${stmt.conclusionLayerId}'.`);
                    }
                    const parentDataId = artefactToDataId(hostDrawing, parent);
                    const hostFieldName = hostNames.fieldNames.get(parentDataId);
                    if (!hostFieldName) {
                        throw new Error(`Consistency Check Failed: Matched parent for '${el.artefactId}' has no assigned field name in '${hostActiveName}'.`);
                    }
                    return hostFieldName;
                }
                case "equation": {
                    const artData = el.artefactId ? info.model.artefactById.get(el.artefactId) : undefined;
                    const childCount = artData ? Object.values(artData.dependencies).filter(v => typeof v === "string").length : 2;
                    const eqCount = Math.max(1, childCount - 1);
                    let w = "eq_refl";
                    for (let i = 1; i < eqCount; i++) {
                        w = `conj eq_refl (${w})`;
                    }
                    return w;
                }
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

        const ordered: RecordedStatement[] = [];
        const visited = new Set<string>();
        const visit = (s: RecordedStatement): void => {
            if (visited.has(s.drawingName)) {
                return;
            }
            visited.add(s.drawingName);
            for (const dep of s.dependsOn) {
                const depStmt = this.statements.get(dep);
                if (depStmt) {
                    visit(depStmt);
                }
            }
            ordered.push(s);
        };
        for (const s of this.statements.values()) {
            visit(s);
        }

        const script: string[] = [];
        for (const s of ordered) {
            script.push(`Lemma ${s.lemmaName} : ${s.lemmaType}.`);
            const lastLine = s.bodyLines[s.bodyLines.length - 1] ?? "";
            // A statement is only emitted as a finished proof when its closing
            // `exact` is the final recorded step. An unproved main whose drawing
            // has no conclusion layer is trivially finished by `exact I.`.
            const autoCloseMain = !s.proved && s.isMain && s.conclusionLayerId === null && !lastLine.startsWith("exact ");
            const emitProof = (s.proved && lastLine.startsWith("exact ")) || autoCloseMain;
            if (emitProof) {
                if (autoCloseMain) {
                    script.push("exact I.");
                }
                script.push(...s.bodyLines);
                script.push("Qed.");
            } else {
                script.push("Admitted.");
            }
        }
        this.statements = new Map();
        this.mainName = null;
        this.sortStore = null;
        return script.join("\n") + "\n";
    }
}