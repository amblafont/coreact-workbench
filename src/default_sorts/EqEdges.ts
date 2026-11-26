import type { D3Context } from '../types';
import type { SortApi } from './api';

declare const api: SortApi;

export function draw(data: any, context: D3Context) {
        //!Require geometry
    // Anchor points: midpoints of the dependency edges
    const a = api.geometry.edgeMidpoint(
        data.source.source.position, data.source.target.position,
        typeof data.source.bend === "number" ? data.source.bend : 0,
        typeof data.source.width === "number" ? data.source.width : 2,
        !!data.source.isMono
    );
    const b = api.geometry.edgeMidpoint(
        data.target.source.position, data.target.target.position,
        typeof data.target.bend === "number" ? data.target.bend : 0,
        typeof data.target.width === "number" ? data.target.width : 2,
        !!data.target.isMono
    );

    const bend = typeof data.bend === "number" ? data.bend : 0;

    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = Math.hypot(dx, dy);

    // Perpendicular unit vector to the chord
    const nx = len > 0 ? -dy / len : 0;
    const ny = len > 0 ? dx / len : 0;

    const mx = (a[0] + b[0]) / 2;
    const my = (a[1] + b[1]) / 2;

    // Control point for the bent quadratic Bézier
    const cx = mx + bend * nx;
    const cy = my + bend * ny;

    // Final tangent at t=1, for orienting the arrowhead
    let ux = b[0] - cx, uy = b[1] - cy;
    const uLen = Math.hypot(ux, uy);
    ux = uLen > 0 ? ux / uLen : (len > 0 ? dx / len : 1);
    uy = uLen > 0 ? uy / uLen : (len > 0 ? dy / len : 0);

    const px = -uy;
    const py = ux;

    const width = 2;
    const amp = 4.5;

    // Arrowhead at the target end, width-scaled like the Edge sort.
    // The squiggle terminates at the base of the head (baseX/baseY),
    // L short of the tip, so it does not run to the arrow's middle.
    const halfW = width * 2;
    const L = halfW * 2.5;
    const baseX = b[0] - ux * L;
    const baseY = b[1] - uy * L;

    // Approximate the arc length of the Bézier so wave count
    // tracks the true curve length (which grows with the bend).
    const ARC_SAMPLES = 200;
    let arcLen = 0;
    let prevX = a[0], prevY = a[1];
    for (let i = 1; i <= ARC_SAMPLES; i++) {
        const t = i / ARC_SAMPLES;
        const b0 = (1 - t) * (1 - t);
        const b1 = 2 * t * (1 - t);
        const b2 = t * t;
        const x = b0 * a[0] + b1 * cx + b2 * baseX;
        const y = b0 * a[1] + b1 * cy + b2 * baseY;
        arcLen += Math.hypot(x - prevX, y - prevY);
        prevX = x;
        prevY = y;
    }

    // Number of squiggle waves scales with the length (~1 per 30px)
    const waves = Math.max(4, Math.round(arcLen / 30));
    const segments = Math.max(40, waves * 20);

    let d = "";
    for (let i = 0; i <= segments; i++) {
        const t = i / segments;
        const b0 = (1 - t) * (1 - t);
        const b1 = 2 * t * (1 - t);
        const b2 = t * t;

        const bx = b0 * a[0] + b1 * cx + b2 * baseX;
        const by = b0 * a[1] + b1 * cy + b2 * baseY;

        // Local tangent of the Bézier
        const tanX = 2 * (1 - t) * (cx - a[0]) + 2 * t * (baseX - cx);
        const tanY = 2 * (1 - t) * (cy - a[1]) + 2 * t * (baseY - cy);
        const tanLen = Math.hypot(tanX, tanY);
        const qx = tanLen > 0 ? -tanY / tanLen : (len > 0 ? -dy / len : 0);
        const qy = tanLen > 0 ? tanX / tanLen : (len > 0 ? dx / len : 0);

        const s = Math.sin(t * waves * 2 * Math.PI);
        const x = bx + qx * amp * s;
        const y = by + qy * amp * s;

        d += i === 0 ? `M ${x},${y}` : ` L ${x},${y}`;
    }

    const group = context.append("g");

    group.append("path")
        .attr("d", d)
        .attr("fill", "none")
        .attr("stroke", "#999")
        .attr("stroke-width", width);

    group.append("path")
        .attr("d", `M ${baseX - px * halfW},${baseY - py * halfW} L ${b[0]},${b[1]} L ${baseX + px * halfW},${baseY + py * halfW} Z`)
        .attr("fill", "#999")
        .attr("stroke", "none");

    return group;
}
