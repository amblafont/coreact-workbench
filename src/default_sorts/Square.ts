import type { D3Context } from '../types';
import type { SortApi } from './api';

declare const api: SortApi;

export function draw(data: any, context: D3Context) {
        //!Require geometry
    // 2-cell between the midpoints of the opposite arrows p1 and q1.
    const a = api.geometry.edgeMidpoint(
        data.p1.source.position, data.p1.target.position,
        typeof data.p1.bend === "number" ? data.p1.bend : 0,
        typeof data.p1.width === "number" ? data.p1.width : 2,
        !!data.p1.isMono
    );
    const b = api.geometry.edgeMidpoint(
        data.q1.source.position, data.q1.target.position,
        typeof data.q1.bend === "number" ? data.q1.bend : 0,
        typeof data.q1.width === "number" ? data.q1.width : 2,
        !!data.q1.isMono
    );

    const bend = typeof data.bend === "number" ? data.bend : 0;

    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = Math.sqrt(dx * dx + dy * dy);

    // Perpendicular unit vector to the chord
    const nx = len > 0 ? -dy / len : 0;
    const ny = len > 0 ? dx / len : 0;

    const mx = (a[0] + b[0]) / 2;
    const my = (a[1] + b[1]) / 2;

    // Control point for the bent 2-cell
    const cx = mx + bend * nx;
    const cy = my + bend * ny;

    // Start tangent at t=0, for offsetting the two lines
    let ux0 = cx - a[0], uy0 = cy - a[1];
    const u0Len = Math.hypot(ux0, uy0);
    ux0 = u0Len > 0 ? ux0 / u0Len : (len > 0 ? dx / len : 1);
    uy0 = u0Len > 0 ? uy0 / u0Len : (len > 0 ? dy / len : 0);

    // End tangent at t=1, for orienting the chevron hat
    let ux = b[0] - cx, uy = b[1] - cy;
    const uLen = Math.hypot(ux, uy);
    ux = uLen > 0 ? ux / uLen : (len > 0 ? dx / len : 1);
    uy = uLen > 0 ? uy / uLen : (len > 0 ? dy / len : 0);

    // Perpendicular to the end tangent
    const px = -uy;
    const py = ux;

    const offset = 6;
    const hatWidth = 10;
    const hatLength = 10;

    // The two lines end on the hat's corner edges
    const lineEndOffset = hatLength * (offset / hatWidth);
    const lineEndX = b[0] - ux * lineEndOffset;
    const lineEndY = b[1] - uy * lineEndOffset;

    const w1X = b[0] - ux * hatLength - px * hatWidth;
    const w1Y = b[1] - uy * hatLength - py * hatWidth;
    const w2X = b[0] - ux * hatLength + px * hatWidth;
    const w2Y = b[1] - uy * hatLength + py * hatWidth;

    const group = context.append("g");

    for (const side of [-1, 1]) {
        // Offset sideways along the curve's own end normals, so
        // both lines start at equal distance from a and end
        // exactly on the hat's corner edges.
        const o = api.geometry.offsetQuadratic(
            a[0], a[1], cx, cy, lineEndX, lineEndY,
            ux0, uy0, ux, uy, offset * side
        );

        group.append("path")
            .attr("d", `M ${o.startX},${o.startY} Q ${o.cx},${o.cy} ${o.endX},${o.endY}`)
            .attr("fill", "none")
            .attr("stroke", "#8e44ad")
            .attr("stroke-width", 2);
    }

    group.append("path")
        .attr("d", `M ${w1X},${w1Y} L ${b[0]},${b[1]} L ${w2X},${w2Y}`)
        .attr("fill", "none")
        .attr("stroke", "#8e44ad")
        .attr("stroke-width", 2)
        .attr("stroke-linecap", "round")
        .attr("stroke-linejoin", "round");

    return group;
}
