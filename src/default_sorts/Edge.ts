import type { D3Context } from '../types';
import type { SortApi } from './api';

declare const api: SortApi;

export function draw(data: any, context: D3Context) {
        //!Require geometry
    const srcPos = data.source.position;
    const tgtPos = data.target.position;
    const bend = typeof data.bend === "number" ? data.bend : 0;

    const dx = tgtPos[0] - srcPos[0];
    const dy = tgtPos[1] - srcPos[1];
    const len = Math.sqrt(dx * dx + dy * dy);

    // Perpendicular unit vector (-dy/len, dx/len)
    const nx = len > 0 ? -dy / len : 0;
    const ny = len > 0 ? dx / len : 0;

    // Midpoint between source and target
    const mx = (srcPos[0] + tgtPos[0]) / 2;
    const my = (srcPos[1] + tgtPos[1]) / 2;

    // Control point for quadratic Bézier curve
    const cx = mx + bend * nx;
    const cy = my + bend * ny;

    const R = 20;

    // Initial tangent at t=0
    let ux0 = cx - srcPos[0], uy0 = cy - srcPos[1];
    const u0Len = Math.hypot(ux0, uy0);
    ux0 = u0Len > 0 ? ux0 / u0Len : (len > 0 ? dx / len : 1);
    uy0 = u0Len > 0 ? uy0 / u0Len : (len > 0 ? dy / len : 0);

    // Final tangent at t=1
    let ux1 = tgtPos[0] - cx, uy1 = tgtPos[1] - cy;
    const u1Len = Math.hypot(ux1, uy1);
    ux1 = u1Len > 0 ? ux1 / u1Len : (len > 0 ? dx / len : 1);
    uy1 = u1Len > 0 ? uy1 / u1Len : (len > 0 ? dy / len : 0);

    const width = typeof data.width === "number" ? data.width : 2;

    // When an isMono hook is drawn on this edge, shorten the tail so it
    // ends exactly at the beginning of the hook's semi-circle.
    const startDist = data.isMono ? api.geometry.hookStartOffset(width) : R;

    const startX = srcPos[0] + ux0 * startDist;
    const startY = srcPos[1] + uy0 * startDist;

    // Arrowhead size scales with the edge width
    const halfW = width * 2;
    const L = halfW * 2.5;
    const baseX = tgtPos[0] - ux1 * (R + L);
    const baseY = tgtPos[1] - uy1 * (R + L);

    // Midpoint of the drawn Bézier curve at t = 0.5
    const [midX, midY] = api.geometry.edgeMidpoint(srcPos, tgtPos, bend, width, !!data.isMono);

    const tipX = tgtPos[0] - ux1 * R;
    const tipY = tgtPos[1] - uy1 * R;

    // Perpendicular to the final tangent (for the arrow base half-width)
    const px = -uy1, py = ux1;

    const lineGroup = context.insert("g", ":first-child");

    if (data.isId) {
        const doubleOffset = 3;
        for (const side of [-1, 1]) {
            // Offset the tail-to-tip curve sideways along its own
            // end normals, so both lines stay square to the
            // vertex at the tail and to the arrow tip.
            const o = api.geometry.offsetQuadratic(
                startX, startY, cx, cy, tipX, tipY,
                ux0, uy0, ux1, uy1, doubleOffset * side
            );
            lineGroup.append("path")
                .attr("d", `M ${o.startX},${o.startY} Q ${o.cx},${o.cy} ${o.endX},${o.endY}`)
                .attr("fill", "none")
                .attr("stroke", "#999")
                .attr("stroke-width", data.width);
        }
    } else {
        lineGroup.append("path")
            .attr("d", `M ${startX},${startY} Q ${cx},${cy} ${baseX},${baseY}`)
            .attr("fill", "none")
            .attr("stroke", "#999")
            .attr("stroke-width", data.width);

        // Manual arrowhead polygon
        lineGroup.append("path")
            .attr("d", `M ${baseX - px * halfW},${baseY - py * halfW} L ${tipX},${tipY} L ${baseX + px * halfW},${baseY + py * halfW} Z`)
            .attr("fill", "#999")
            .attr("stroke", "none");
    }


    if (data.label) {
        context.append("text")
            .attr("x", midX)
            .attr("y", midY - 10) // slightly above the curve
            .attr("text-anchor", "middle")
            .attr("fill", "#333")
            .attr("font-family", "sans-serif")
            .attr("font-size", "12px")
            .text(data.label);
    }

    return lineGroup; // Return the line group
}
