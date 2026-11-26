export function module(_api: import('../api').SortApi) {
    const VERTEX_RADIUS = 20;
    const HOOK_MARGIN = 4;
    const ret: Record<string, unknown> = {};

    const hookStartOffset = function (width: number): number {
        const r = Math.max(3, width * 2.5);
        return Math.sqrt(Math.pow(VERTEX_RADIUS + HOOK_MARGIN + r, 2) - r * r);
    };
    ret.hookStartOffset = hookStartOffset;

    ret.edgeMidpoint = function (
        srcPos: number[],
        tgtPos: number[],
        bend: number,
        width: number,
        isMono: boolean
    ): [number, number] {
        const dx = tgtPos[0] - srcPos[0];
        const dy = tgtPos[1] - srcPos[1];
        const len = Math.sqrt(dx * dx + dy * dy);
        const nx = len > 0 ? -dy / len : 0;
        const ny = len > 0 ? dx / len : 0;
        const mx = (srcPos[0] + tgtPos[0]) / 2;
        const my = (srcPos[1] + tgtPos[1]) / 2;
        const cx = mx + bend * nx;
        const cy = my + bend * ny;

        let ux0 = cx - srcPos[0], uy0 = cy - srcPos[1];
        const u0Len = Math.hypot(ux0, uy0);
        ux0 = u0Len > 0 ? ux0 / u0Len : (len > 0 ? dx / len : 1);
        uy0 = u0Len > 0 ? uy0 / u0Len : (len > 0 ? dy / len : 0);

        let ux1 = tgtPos[0] - cx, uy1 = tgtPos[1] - cy;
        const u1Len = Math.hypot(ux1, uy1);
        ux1 = u1Len > 0 ? ux1 / u1Len : (len > 0 ? dx / len : 1);
        uy1 = u1Len > 0 ? uy1 / u1Len : (len > 0 ? dy / len : 0);

        const R = 20;
        const startDist = isMono ? hookStartOffset(width) : R;
        const startX = srcPos[0] + ux0 * startDist;
        const startY = srcPos[1] + uy0 * startDist;
        const halfW = width * 2;
        const L = halfW * 2.5;
        const baseX = tgtPos[0] - ux1 * (R + L);
        const baseY = tgtPos[1] - uy1 * (R + L);
        const midX = 0.25 * startX + 0.5 * cx + 0.25 * baseX;
        const midY = 0.25 * startY + 0.5 * cy + 0.25 * baseY;
        return [midX, midY];
    };

    ret.offsetQuadratic = function (
        startX: number,
        startY: number,
        cx: number,
        cy: number,
        endX: number,
        endY: number,
        u0x: number,
        u0y: number,
        u1x: number,
        u1y: number,
        d: number
    ) {
        const n0x = -u0y, n0y = u0x;
        const n1x = -u1y, n1y = u1x;
        const denom = 1 + n0x * n1x + n0y * n1y;
        const k = denom > 1e-3 ? d / denom : 0;
        const vx = k * (n0x + n1x);
        const vy = k * (n0y + n1y);
        return {
            startX: startX + n0x * d, startY: startY + n0y * d,
            cx: cx + vx, cy: cy + vy,
            endX: endX + n1x * d, endY: endY + n1y * d
        };
    };

    return ret;
}
