import type { D3Context } from '../types';
import type { SortApi } from './api';

declare const api: SortApi;

export function draw(data: any, context: D3Context) {
        //!Require geometry
    const srcPos = data.arrow.source.position;
    const tgtPos = data.arrow.target.position;
    const bend = typeof data.arrow.bend === "number" ? data.arrow.bend : 0;
    const strokeColor = "#999";
    const baseWidth = typeof data.arrow.width === "number" ? data.arrow.width : 2;
    const strokeWidth = baseWidth;

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

    // Derivative at t=0 to find the initial tangent of the curve
    const tx = cx - srcPos[0];
    const ty = cy - srcPos[1];
    const tLen = Math.sqrt(tx * tx + ty * ty);
    const ux = tLen > 0 ? tx / tLen : 1;
    const uy = tLen > 0 ? ty / tLen : 0;

    // Perpendicular to the tangent (hook hangs on the right-hand side of travel)
    const px = -uy;
    const py = ux;

    // Semi-circle radius grows with the arrow width
    const r = Math.max(3, baseWidth * 2.5);
    // Offset the hook along the tail so the semi-circle clears the
    // source vertex boundary, matching the edge tail's start point
    const offset = api.geometry.hookStartOffset(baseWidth);
    const tailX = srcPos[0] + ux * offset;
    const tailY = srcPos[1] + uy * offset;

    // Center of the hook's circle, offset to the perpendicular side
    const cX = tailX + px * r;
    const cY = tailY + py * r;

    // End of the semi-circle, diametrically opposite the tail point so the path ends backwards
    const endX = cX + px * r;
    const endY = cY + py * r;

    const group = context.append("g");

    // Semi-circle starting at the end of the tail and ending backwards
    group.append("path")
        .attr("d", `M ${tailX},${tailY} A ${r} ${r} 0 0 0 ${endX},${endY}`)
        .attr("fill", "none")
        .attr("stroke", strokeColor)
        .attr("stroke-width", strokeWidth)
        .attr("stroke-linecap", "round");

    return group;
}
