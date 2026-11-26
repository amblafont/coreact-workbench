/**
 * Minimal codec for the Human Readable Archive (.hrx) format.
 *
 * Only the subset needed by this app is supported: UTF-8 text, file sections,
 * and leading comments. The boundary may be any `<` + one or more `=` + `>`,
 * but it must be the same for every section in one archive.
 */

export interface HrxArchive {
    /** Boundary used by the archive, e.g. `<===>`. */
    boundary: string;
    /** File sections keyed by their path. */
    sections: Map<string, string>;
    /** Comment bodies, in archive order. */
    comments: string[];
}

function genericBoundary(line: string): string | null {
    const match = /^(<(=+)>)(?: (.*))?$/.exec(line);
    return match ? match[1] : null;
}

export function parseHrx(text: string): HrxArchive {
    const normalized = text.replace(/\r\n/g, '\n');
    const lines = normalized.split('\n');

    const sections = new Map<string, string>();
    const comments: string[] = [];
    let boundary: string | null = null;
    for (const line of lines) {
        const candidate = genericBoundary(line);
        if (candidate && /^<(=+)> /.test(line)) {
            boundary = candidate;
            break;
        }
    }
    if (boundary === null) {
        throw new Error('Consistency Check Failed: HRX file contains no sections.');
    }

    let currentPath: string | null = null;
    let currentBody: string[] = [];

    const finishCurrent = (): void => {
        if (currentPath === null) return;
        if (sections.has(currentPath)) {
            throw new Error(`Consistency Check Failed: Duplicate HRX section '${currentPath}'.`);
        }
        sections.set(currentPath, currentBody.join('\n'));
        currentPath = null;
        currentBody = [];
    };

    for (const line of lines) {
        const isBoundary = line === boundary || line.startsWith(`${boundary} `);
        if (isBoundary) {
            finishCurrent();
            if (line === boundary) {
                currentPath = null;
                continue;
            }
            const path = line.slice(boundary.length + 1).trim();
            if (!path) {
                throw new Error('Consistency Check Failed: HRX section has an empty path.');
            }
            currentPath = path;
            currentBody = [];
        } else if (currentPath !== null) {
            currentBody.push(line);
        } else {
            const trimmed = line.trim();
            if (trimmed) {
                comments.push(line);
            }
        }
    }
    finishCurrent();

    return { boundary, sections, comments };
}

function bodyHasBoundary(body: string, boundary: string): boolean {
    return body.split('\n').some(line => line.startsWith(boundary));
}

function chooseBoundary(sections: Map<string, string>): string {
    let length = 3;
    while (true) {
        const candidate = `<${'='.repeat(length)}>`;
        if (!Array.from(sections.values()).some(body => bodyHasBoundary(body, candidate))) {
            return candidate;
        }
        length++;
    }
}

/**
 * Serialize sections into an HRX archive. A boundary is chosen that does not
 * occur at the start of any body line.
 */
export function serializeHrx(sections: Map<string, string>): string {
    const boundary = chooseBoundary(sections);
    const parts: string[] = [];

    for (const [path, body] of sections) {
        const normalizedBody = body.replace(/\r\n/g, '\n').replace(/\n+$/, '');
        parts.push(`${boundary} ${path}\n${normalizedBody}`);
    }

    return parts.join('\n');
}
