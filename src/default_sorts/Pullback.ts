import type { D3Context } from '../types';

export function draw(data: any, context: D3Context) {
    // Assume p1 and p2 share the pullback source vertex
    const V = data.p1.source.position;
    const T1 = data.p1.target.position;
    const T2 = data.p2.target.position;

    // Calculate normalized direction vectors
    const dx1 = T1[0] - V[0];
    const dy1 = T1[1] - V[1];
    const len1 = Math.sqrt(dx1*dx1 + dy1*dy1);
    const ux1 = len1 > 0 ? dx1 / len1 : 0;
    const uy1 = len1 > 0 ? dy1 / len1 : 0;

    const dx2 = T2[0] - V[0];
    const dy2 = T2[1] - V[1];
    const len2 = Math.sqrt(dx2*dx2 + dy2*dy2);
    const ux2 = len2 > 0 ? dx2 / len2 : 0;
    const uy2 = len2 > 0 ? dy2 / len2 : 0;

    // distance from the center of the vertex
    const offset = 25; 
    // size of the pullback corner legs
    const size = 15; 

    // Re-calculate points strictly using the unit vectors for arbitrary angles
    const p1x = V[0] + ux1 * offset + ux2 * (offset + size);
    const p1y = V[1] + uy1 * offset + uy2 * (offset + size);

    const p2x = V[0] + ux1 * (offset + size) + ux2 * (offset + size);
    const p2y = V[1] + uy1 * (offset + size) + uy2 * (offset + size); // The innermost corner

    const p3x = V[0] + ux1 * (offset + size) + ux2 * offset;
    const p3y = V[1] + uy1 * (offset + size) + uy2 * offset;

    return (context.append("path")
        .attr("d", `M ${p1x},${p1y} L ${p2x},${p2y} L ${p3x},${p3y}`)
        .attr("fill", "none")
        .attr("stroke", "#333")
        .attr("stroke-width", 2)
        .attr("stroke-linejoin", "miter")) as unknown as D3Context;
}
