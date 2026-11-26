/**
 * Runtime support for the small module convention used by `.hrx` archives.
 *
 * A module section is a JS function body whose final `return` produces its
 * exported value. `//!Require` directives name other modules; the resulting
 * values are exposed on an `api` object passed to draw functions.
 */

export interface HrxModuleSource {
    source: string;
    requires: string[];
}

const REQUIRE_DIRECTIVE = /^\s*\/\/!Require\s+(.+)$/gm;

export function parseRequires(source: string): string[] {
    const names = new Set<string>();
    for (const match of source.matchAll(REQUIRE_DIRECTIVE)) {
        for (const name of match[1].trim().split(/\s+/)) {
            if (name) names.add(name);
        }
    }
    return Array.from(names);
}

export function stripRequires(source: string): string {
    return source.replace(REQUIRE_DIRECTIVE, '');
}

/** Strip the wrapper from a compiled function to recover its JS body. */
export function functionBody(fn: Function): string {
    const text = fn.toString().trim();
    const open = text.indexOf('{');
    const close = text.lastIndexOf('}');
    if (open < 0 || close <= open) {
        throw new Error(`Consistency Check Failed: Cannot extract body from function '${text}'.`);
    }
    return text.slice(open + 1, close).trim();
}

/**
 * Order names so that every dependency appears before its dependents.
 * Missing dependencies and cycles are reported as consistency errors.
 */
export function topologicalOrder(names: Iterable<string>, dependenciesOf: (name: string) => Iterable<string>): string[] {
    const remaining = new Set(names);
    const ordered: string[] = [];

    while (remaining.size > 0) {
        const ready = Array.from(remaining).find(name =>
            Array.from(dependenciesOf(name)).every(dep => !remaining.has(dep))
        );
        if (!ready) {
            throw new Error(
                `Consistency Check Failed: Cyclic or unresolved HRX dependencies among: ${Array.from(remaining).join(', ')}.`
            );
        }
        remaining.delete(ready);
        ordered.push(ready);
    }

    return ordered;
}

export function collectModuleClosure(
    modules: Map<string, HrxModuleSource>,
    roots: Iterable<string>
): string[] {
    const needed = new Set<string>();
    const visit = (name: string): void => {
        if (needed.has(name)) return;
        const source = modules.get(name);
        if (!source) {
            throw new Error(`Consistency Check Failed: Required HRX module '${name}' is missing.`);
        }
        needed.add(name);
        for (const dep of source.requires) visit(dep);
    };
    for (const root of roots) visit(root);
    return topologicalOrder(needed, name => modules.get(name)?.requires ?? []);
}

/**
 * Compile module bodies into an `api` object.
 *
 * Simple top-level constants are hoisted into a shared scope so that a module
 * such as `hookStartOffset.js` can use constants declared in `arrow.js`, as in
 * examples/newformat.hrx. `ret` is deliberately not hoisted: each object-style
 * module needs its own value.
 */
export function buildModuleApi(
    modules: Map<string, HrxModuleSource>,
    roots: Iterable<string>
): Record<string, unknown> {
    const order = collectModuleClosure(modules, roots);
    const api: Record<string, unknown> = {};
    const hoisted: string[] = [];
    const hoistedNames = new Set<string>();
    const wrappers: string[] = [];

    for (const name of order) {
        const source = modules.get(name)!;
        const bodyLines: string[] = [];
        for (const line of stripRequires(source.source).split('\n')) {
            const constant = /^const\s+([A-Za-z_$][\w$]*)\s*=\s*([^;]+);\s*$/.exec(line);
            if (constant && constant[1] !== 'ret' && !hoistedNames.has(constant[1])) {
                hoistedNames.add(constant[1]);
                hoisted.push(line);
            } else if (!(constant && constant[1] !== 'ret')) {
                bodyLines.push(line);
            }
        }
        wrappers.push(`api[${JSON.stringify(name)}] = (function () {\n${bodyLines.join('\n')}\n})();`);
    }

    const code = [...hoisted, ...wrappers].join('\n');
    new Function('api', code)(api);
    return api;
}

export function compileDrawFunction(
    source: string,
    api: Record<string, unknown>
): (data: any, context: any) => any {
    const fn = new Function('api', 'data', 'context', stripRequires(source)) as
        (api: Record<string, unknown>, data: any, context: any) => any;
    return (data: any, context: any) => fn(api, data, context);
}
