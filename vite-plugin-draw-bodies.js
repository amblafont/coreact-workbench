import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';

const VIRTUAL_PREFIX = 'virtual:draw-body/';

const BODIES = {
    geometry: { file: 'src/default_sorts/js/geometry.ts', fn: 'module' },
    Vertex: { file: 'src/default_sorts/Vertex.ts', fn: 'draw' },
    Edge: { file: 'src/default_sorts/Edge.ts', fn: 'draw' },
    Pullback: { file: 'src/default_sorts/Pullback.ts', fn: 'draw' },
    Triangle: { file: 'src/default_sorts/Triangle.ts', fn: 'draw' },
    Square: { file: 'src/default_sorts/Square.ts', fn: 'draw' },
    isMono: { file: 'src/default_sorts/isMono.ts', fn: 'draw' },
    isId: { file: 'src/default_sorts/isId.ts', fn: 'draw' },
    EqEdges: { file: 'src/default_sorts/EqEdges.ts', fn: 'draw' }
};

function functionBodyFromJs(js, fnName, fileName) {
    const sourceFile = ts.createSourceFile(fileName, js, ts.ScriptTarget.ESNext, true, ts.ScriptKind.JS);
    for (const statement of sourceFile.statements) {
        if (
            ts.isFunctionDeclaration(statement) &&
            statement.name?.text === fnName &&
            statement.body
        ) {
            return statement.body.getText(sourceFile).slice(1, -1).trim();
        }
    }
    throw new Error(`Cannot find function '${fnName}' in '${fileName}'.`);
}

/**
 * Expose the JS body of each TypeScript drawing function as a stable string.
 *
 * Deriving the body with fn.toString() at runtime breaks in production builds,
 * where the bundler renames `data`/`context`. Here the body is extracted from
 * the TypeScript source at build time (before minification) and imported as a
 * virtual string module. The .ts files remain the single source of truth and
 * continue to be type-checked by `npm run build:sorts`.
 */
export function drawBodies() {
    let root = process.cwd();

    return {
        name: 'draw-bodies',
        configResolved(config) {
            root = config.root;
        },
        resolveId(id) {
            if (!id.startsWith(VIRTUAL_PREFIX)) return null;
            const name = id.slice(VIRTUAL_PREFIX.length);
            return BODIES[name] ? `\0${VIRTUAL_PREFIX}${name}` : null;
        },
        load(id) {
            if (!id.startsWith(`\0${VIRTUAL_PREFIX}`)) return null;
            const name = id.slice(`\0${VIRTUAL_PREFIX}`.length);
            const { file, fn } = BODIES[name];
            const absolutePath = resolve(root, file);
            this.addWatchFile(absolutePath);

            const source = readFileSync(absolutePath, 'utf8');
            const js = ts.transpileModule(source, {
                fileName: absolutePath,
                compilerOptions: {
                    target: ts.ScriptTarget.ESNext,
                    module: ts.ModuleKind.ESNext,
                    removeComments: false
                }
            }).outputText;
            const body = functionBodyFromJs(js, fn, absolutePath);
            return `export default ${JSON.stringify(body)};`;
        }
    };
}
