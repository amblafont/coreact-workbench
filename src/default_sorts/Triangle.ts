import type { D3Context } from '../types';
import type { SortApi } from './api';

declare const api: SortApi;

export function draw(data: any, context: D3Context) {
        //!Require geometry
    // A triangle is composed of three edges: "1", "2", and "o".
    // Draw it like a 2-cell: a double arrow from the target of edge
    // "1" to the middle of edge "o".
    const startPos = data["1"].target.position;

    // Compute the middle of edge "o" using the same quadratic Bézier
    // midpoint formula as the Edge sort.
    const oSrcPos = data["o"].source.position;
    const oTgtPos = data["o"].target.position;
    const oBend = typeof data["o"].bend === "number" ? data["o"].bend : 0;
    const oWidth = typeof data["o"].width === "number" ? data["o"].width : 2;
    const [midX, midY] = api.geometry.edgeMidpoint(oSrcPos, oTgtPos, oBend, oWidth, !!data["o"].isMono);

    const bend = typeof data.bend === "number" ? data.bend : 0;

    // Chord from the target of edge "1" to the middle of edge "o"
    const dx = midX - startPos[0];
    const dy = midY - startPos[1];
    const len = Math.sqrt(dx * dx + dy * dy);

    // Perpendicular unit vector to the chord
    const nx = len > 0 ? -dy / len : 0;
    const ny = len > 0 ? dx / len : 0;

    // Control point for the bent double arrow
    const cx = (startPos[0] + midX) / 2 + bend * nx;
    const cy = (startPos[1] + midY) / 2 + bend * ny;

    // Initial tangent at t=0, for clearing the source vertex
    let ux0 = cx - startPos[0], uy0 = cy - startPos[1];
    const u0Len = Math.hypot(ux0, uy0);
    ux0 = u0Len > 0 ? ux0 / u0Len : (len > 0 ? dx / len : 1);
    uy0 = u0Len > 0 ? uy0 / u0Len : (len > 0 ? dy / len : 0);

    // Final tangent at t=1, for orienting the chevron hat
    let ux = midX - cx, uy = midY - cy;
    const uLen = Math.hypot(ux, uy);
    ux = uLen > 0 ? ux / uLen : (len > 0 ? dx / len : 1);
    uy = uLen > 0 ? uy / uLen : (len > 0 ? dy / len : 0);

    // Perpendicular to the final tangent
    const px = -uy;
    const py = ux;

    const offset = 6;
    const startGap = 24; // Clear the r=20 vertex circle

    // Single open chevron (hat) at the tip
    const hatWidth = 10;
    const hatLength = 10;

    // The two lines end on the hat's corner edges
    const lineEndOffset = hatLength * (offset / hatWidth);
    const lineStartX = startPos[0] + ux0 * startGap;
    const lineStartY = startPos[1] + uy0 * startGap;
    const lineEndX = midX - ux * lineEndOffset;
    const lineEndY = midY - uy * lineEndOffset;

    const group = context.append("g");

    const w1X = midX - ux * hatLength - px * hatWidth;
    const w1Y = midY - uy * hatLength - py * hatWidth;
    const w2X = midX - ux * hatLength + px * hatWidth;
    const w2Y = midY - uy * hatLength + py * hatWidth;

    for (const side of [-1, 1]) {
        // Offset sideways along the curve's own end normals, so
        // both lines start at equal distance from the node and end
        // exactly on the hat's corner edges.
        const o = api.geometry.offsetQuadratic(
            lineStartX, lineStartY, cx, cy, lineEndX, lineEndY,
            ux0, uy0, ux, uy, offset * side
        );

        group.append("path")
            .attr("d", `M ${o.startX},${o.startY} Q ${o.cx},${o.cy} ${o.endX},${o.endY}`)
            .attr("fill", "none")
            .attr("stroke", "#8e44ad")
            .attr("stroke-width", 2);
    }

    group.append("path")
        .attr("d", `M ${w1X},${w1Y} L ${midX},${midY} L ${w2X},${w2Y}`)
        .attr("fill", "none")
        .attr("stroke", "#8e44ad")
        .attr("stroke-width", 2)
        .attr("stroke-linecap", "round")
        .attr("stroke-linejoin", "round");

    return group;
}
