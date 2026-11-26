import type { D3Context } from '../types';

export function draw(data: any, context: D3Context) {
    // Draw a vertex (circle) at data.position
    const group = context.append("g")
        .attr("transform", `translate(${data.position[0]}, ${data.position[1]})`);

    group.append("circle")
        .attr("r", 20)
        .attr("fill", "#69b3a2")
        .attr("stroke", "#333")
        .attr("stroke-width", 2);

    if (data.label) {
        group.append("text")
            .attr("text-anchor", "middle")
            .attr("dy", ".3em") // Vertically center text
            .attr("fill", "white")
            .attr("font-family", "sans-serif")
            .attr("font-size", "14px")
            .text(data.label);
    }

    return group; // Return the group to store in Artefact
}
