const VERTEX_RADIUS = 20;
const HOOK_MARGIN = 4;
// Distance from the source vertex center to the beginning of the isMono
// semi-circle hook, measured along the initial edge tangent.
function hookStartOffset(width) {
    const r = Math.max(3, width * 2.5);
    return Math.sqrt(Math.pow(VERTEX_RADIUS + HOOK_MARGIN + r, 2) - r * r);
}
function drawArrow(srcPos, tgtPos, data, context) {
    const bend = typeof data.bend === "number" ? data.bend : 0;
    const dx = tgtPos[0] - srcPos[0];
    const dy = tgtPos[1] - srcPos[1];
    const len = Math.sqrt(dx * dx + dy * dy);
    const nx = len > 0 ? -dy / len : 0;
    const ny = len > 0 ? dx / len : 0;
    const mx = (srcPos[0] + tgtPos[0]) / 2;
    const my = (srcPos[1] + tgtPos[1]) / 2;
    const cx = mx + bend * nx;
    const cy = my + bend * ny;
    const midX = 0.25 * srcPos[0] + 0.5 * cx + 0.25 * tgtPos[0];
    const midY = 0.25 * srcPos[1] + 0.5 * cy + 0.25 * tgtPos[1];
    const R = 20;
    let ux0 = cx - srcPos[0], uy0 = cy - srcPos[1];
    const u0Len = Math.hypot(ux0, uy0);
    ux0 = u0Len > 0 ? ux0 / u0Len : (len > 0 ? dx / len : 1);
    uy0 = u0Len > 0 ? uy0 / u0Len : (len > 0 ? dy / len : 0);
    let ux1 = tgtPos[0] - cx, uy1 = tgtPos[1] - cy;
    const u1Len = Math.hypot(ux1, uy1);
    ux1 = u1Len > 0 ? ux1 / u1Len : (len > 0 ? dx / len : 1);
    uy1 = u1Len > 0 ? uy1 / u1Len : (len > 0 ? dy / len : 0);
    const width = typeof data.width === "number" ? data.width : 2;
    const startDist = data.isMono ? hookStartOffset(width) : R;
    const startX = srcPos[0] + ux0 * startDist;
    const startY = srcPos[1] + uy0 * startDist;
    const halfW = width * 2;
    const L = halfW * 2.5;
    const baseX = tgtPos[0] - ux1 * (R + L);
    const baseY = tgtPos[1] - uy1 * (R + L);
    const tipX = tgtPos[0] - ux1 * R;
    const tipY = tgtPos[1] - uy1 * R;
    const px = -uy1, py = ux1;
    const lineGroup = context.append("g");
    const linePath = lineGroup.append("path")
        .attr("d", `M ${startX},${startY} Q ${cx},${cy} ${baseX},${baseY}`)
        .attr("fill", "none")
        .attr("stroke", "#999")
        .attr("stroke-width", data.width);
    if (data.dashed) {
        linePath.attr("stroke-dasharray", "6,4");
    }
    lineGroup.append("path")
        .attr("d", `M ${baseX - px * halfW},${baseY - py * halfW} L ${tipX},${tipY} L ${baseX + px * halfW},${baseY + py * halfW} Z`)
        .attr("fill", "#999")
        .attr("stroke", "none");
    if (data.label) {
        context.append("text")
            .attr("x", midX)
            .attr("y", midY - 10)
            .attr("text-anchor", "middle")
            .attr("fill", "#333")
            .attr("font-family", "sans-serif")
            .attr("font-size", "12px")
            .text(data.label);
    }
    return lineGroup;
}
function unitVec(from, to) {
    const dx = to[0] - from[0];
    const dy = to[1] - from[1];
    const len = Math.hypot(dx, dy);
    return len > 0 ? [dx / len, dy / len] : [0, 0];
}
function bendMid(srcPos, tgtPos, bend) {
    const dx = tgtPos[0] - srcPos[0];
    const dy = tgtPos[1] - srcPos[1];
    const len = Math.sqrt(dx * dx + dy * dy);
    const nx = len > 0 ? -dy / len : 0;
    const ny = len > 0 ? dx / len : 0;
    const mx = (srcPos[0] + tgtPos[0]) / 2;
    const my = (srcPos[1] + tgtPos[1]) / 2;
    return { cx: mx + bend * nx, cy: my + bend * ny };
}
function drawDoubleArrow(srcPos, tgtPos, data, context) {
    const bend = typeof data.bend === "number" ? data.bend : 0;
    const dx = tgtPos[0] - srcPos[0];
    const dy = tgtPos[1] - srcPos[1];
    const len = Math.sqrt(dx * dx + dy * dy);
    const ux = len > 0 ? dx / len : 1;
    const uy = len > 0 ? dy / len : 0;
    const { cx, cy } = bendMid(srcPos, tgtPos, bend);
    const px = -uy, py = ux;
    const offset = 4;
    const group = context.append("g");
    for (const side of [-1, 1]) {
        const startX = srcPos[0] + ux * 20 + px * offset * side;
        const startY = srcPos[1] + uy * 20 + py * offset * side;
        const endX = tgtPos[0] - ux * 16 + px * offset * side;
        const endY = tgtPos[1] - uy * 16 + py * offset * side;
        group.append("path")
            .attr("d", `M ${startX},${startY} Q ${cx + px * offset * side},${cy + py * offset * side} ${endX},${endY}`)
            .attr("fill", "none")
            .attr("stroke", "#333")
            .attr("stroke-width", 2)
            .attr("marker-end", "url(#arrowhead-double)");
    }
    return group;
}
function drawArc(srcPos, tgtPos, data, context) {
    const bend = typeof data.bend === "number" ? data.bend : 0;
    const dx = tgtPos[0] - srcPos[0];
    const dy = tgtPos[1] - srcPos[1];
    const len = Math.sqrt(dx * dx + dy * dy);
    const nx = len > 0 ? -dy / len : 0;
    const ny = len > 0 ? dx / len : 0;
    const mx = (srcPos[0] + tgtPos[0]) / 2;
    const my = (srcPos[1] + tgtPos[1]) / 2;
    const cx = mx + bend * nx;
    const cy = my + bend * ny;
    const chord = Math.hypot(dx, dy);
    const group = context.append("g");
    if (chord < 1e-6) {
        return group;
    }
    // Center-controlled point: chord midpoint offset perpendicular by bend
    const p = [cx, cy];
    // Circumcircle through srcPos, p and tgtPos
    const ax = srcPos[0] - tgtPos[0];
    const ay = srcPos[1] - tgtPos[1];
    const bx = p[0] - tgtPos[0];
    const by = p[1] - tgtPos[1];
    const det = 2 * (ax * by - ay * bx);
    if (Math.abs(det) < 1e-6) {
        // Collinear points (e.g. bend === 0): draw a straight line
        group.append("path")
            .attr("d", `M ${srcPos[0]},${srcPos[1]} L ${tgtPos[0]},${tgtPos[1]}`)
            .attr("fill", "none")
            .attr("stroke", "#333")
            .attr("stroke-width", 2);
        return group;
    }
    const centX = (by * (ax * ax + ay * ay) - ay * (bx * bx + by * by)) / det + tgtPos[0];
    const centY = (ax * (bx * bx + by * by) - bx * (ax * ax + ay * ay)) / det + tgtPos[1];
    const r = Math.hypot(centX - srcPos[0], centY - srcPos[1]);
    // Signed turn in (-PI, PI]
    const norm = (d) => ((d + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
    const a0 = Math.atan2(srcPos[1] - centY, srcPos[0] - centX);
    const ap = Math.atan2(p[1] - centY, p[0] - centX);
    const a2 = Math.atan2(tgtPos[1] - centY, tgtPos[0] - centX);
    // Turn from start to control and control to end. If they share a sign the
    // minor arc from start to end passes through the control point.
    const dPa = norm(ap - a0);
    const dAp = norm(a2 - ap);
    const sweep = dPa >= 0 ? 1 : 0;
    const largeArc = (dPa >= 0) !== (dAp >= 0) ? 1 : 0;
    group.append("path")
        .attr("d", `M ${srcPos[0]},${srcPos[1]} A ${r} ${r} 0 ${largeArc} ${sweep} ${tgtPos[0]},${tgtPos[1]}`)
        .attr("fill", "none")
        .attr("stroke", "#333")
        .attr("stroke-width", 2);
    return group;
}
{
    sortStore
        .newSort("Vertex", {}, { position: "position" }, (data, context) => {
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
    })
        .newSort("Edge", { source: "Vertex", target: "Vertex" },
    { width: "number", bend: { type: "slider", min: -500, max: 500, default: 0 } }, (data, context) => {
        return drawArrow(data.source.position, data.target.position, data, context);
    })
        .newSort("Pullback", { p1: "Edge", p2: "Edge", q1: "Edge", q2: "Edge" }, {}, (data, context) => {
        // Assume p1 and p2 share the pullback source vertex
        const V = data.p1.source.position;
        const T1 = data.p1.target.position;
        const T2 = data.p2.target.position;
        // Calculate normalized direction vectors
        const dx1 = T1[0] - V[0];
        const dy1 = T1[1] - V[1];
        const len1 = Math.sqrt(dx1 * dx1 + dy1 * dy1);
        const ux1 = len1 > 0 ? dx1 / len1 : 0;
        const uy1 = len1 > 0 ? dy1 / len1 : 0;
        const dx2 = T2[0] - V[0];
        const dy2 = T2[1] - V[1];
        const len2 = Math.sqrt(dx2 * dx2 + dy2 * dy2);
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
            .attr("stroke-linejoin", "miter"));
    })
        .newSort("Triangle", { "1": "Edge", "2": "Edge", o: "Edge" }, {}, (data, context) => {
        // A triangle is composed of three edges: "1", "2", and "o".
        // Draw it like a 2-cell: a double arrow from the target of edge
        // "1" to the middle of edge "o".
        const startPos = data["1"].target.position;
        // Compute the middle of edge "o" using the same quadratic Bézier
        // midpoint formula as the Edge sort's label placement.
        const srcPos = data["o"].source.position;
        const tgtPos = data["o"].target.position;
        const bend = typeof data["o"].bend === "number" ? data["o"].bend : 0;
        const dx = tgtPos[0] - srcPos[0];
        const dy = tgtPos[1] - srcPos[1];
        const len = Math.sqrt(dx * dx + dy * dy);
        const nx = len > 0 ? -dy / len : 0;
        const ny = len > 0 ? dx / len : 0;
        const mx = (srcPos[0] + tgtPos[0]) / 2;
        const my = (srcPos[1] + tgtPos[1]) / 2;
        const cx = mx + bend * nx;
        const cy = my + bend * ny;
        const midX = 0.25 * srcPos[0] + 0.5 * cx + 0.25 * tgtPos[0];
        const midY = 0.25 * srcPos[1] + 0.5 * cy + 0.25 * tgtPos[1];
        // Unit direction from the target of edge "1" to the middle of edge "o"
        const vx = midX - startPos[0];
        const vy = midY - startPos[1];
        const vLen = Math.sqrt(vx * vx + vy * vy);
        const ux = vLen > 0 ? vx / vLen : 1;
        const uy = vLen > 0 ? vy / vLen : 0;
        // Perpendicular unit vector for offsetting the two arrow lines
        const px = -uy;
        const py = ux;
        const offset = 6;
        const startGap = 24; // Clear the r=20 vertex circle
        const group = context.append("g");
        for (const side of [-1, 1]) {
            const startX = startPos[0] + ux * startGap + px * offset * side;
            const startY = startPos[1] + uy * startGap + py * offset * side;
            const endX = midX + px * offset * side;
            const endY = midY + py * offset * side;
            group.append("path")
                .attr("d", `M ${startX},${startY} L ${endX},${endY}`)
                .attr("fill", "none")
                .attr("stroke", "#8e44ad")
                .attr("stroke-width", 2)
                .attr("marker-end", "url(#arrowhead-2cell)");
        }
        return group;
    }, (context) => {
        // initContext: Set up SVG Defs for the 2-cell Arrowhead Marker
        let defs = context.select("defs");
        if (defs.empty()) {
            defs = context.append("defs");
        }
        defs.append("marker")
            .attr("id", "arrowhead-2cell")
            .attr("viewBox", "0 -5 10 10")
            .attr("refX", 9) // Tip of the arrow lands at the middle of edge "o"
            .attr("refY", 0)
            .attr("orient", "auto")
            .attr("markerWidth", 8)
            .attr("markerHeight", 8)
            .append("path")
            .attr("d", "M0,-5L10,0L0,5")
            .attr("fill", "#8e44ad");
    })
        .newSort("isMono", { arrow: "Edge" }, {}, (data, context) => {
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
        const offset = hookStartOffset(baseWidth);
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
    })
        .newSort("cone", {}, { position: "position" }, (data, context) => {
        const group = context.append("g")
            .attr("transform", `translate(${data.position[0]}, ${data.position[1]})`);
        group.append("circle")
            .attr("r", 20)
            .attr("fill", "none")
            .attr("stroke", "#e8a87c")
            .attr("stroke-width", 2);
        group.append("circle")
            .attr("r", 4)
            .attr("fill", "#e8a87c");
        if (data.label) {
            group.append("text")
                .attr("text-anchor", "middle")
                .attr("dy", ".3em")
                .attr("fill", "#333")
                .attr("font-family", "sans-serif")
                .attr("font-size", "14px")
                .text(data.label);
        }
        return group;
    })
        .newSort("cone_mor", { source: "cone", target: "cone" },
    { width: "number", bend: { type: "slider", min: -500, max: 500, default: 0 } }, (data, context) => {
        return drawArrow(data.source.position, data.target.position, data, context);
    })
        .newSort("element", { vertex: "Vertex", cone: "cone" }, { position: { type: "relativePosition", target: "vertex.position" } }, (data, context) => {
        const x = data.position[0], y = data.position[1];
        const s = 8;
        const group = context.append("g");
        group.append("line")
            .attr("x1", x - s).attr("y1", y - s)
            .attr("x2", x + s).attr("y2", y + s)
            .attr("stroke", "#c0392b").attr("stroke-width", 2);
        group.append("line")
            .attr("x1", x + s).attr("y1", y - s)
            .attr("x2", x - s).attr("y2", y + s)
            .attr("stroke", "#c0392b").attr("stroke-width", 2);
        return group;
    })
        .newSort("map", { source: "element", target: "element" },
    { width: "number", bend: { type: "slider", min: -500, max: 500, default: 0 } }, (data, context) => {
        return drawArrow(data.source.position, data.target.position, data, context);
    })
        .newSort("welldefined", { source: "element", target: "element" },
    { bend: { type: "slider", min: -500, max: 500, default: 0 } }, (data, context) => {
        return drawDoubleArrow(data.source.position, data.target.position, data, context);
    }, (context) => {
        let defs = context.select("defs");
        if (defs.empty()) {
            defs = context.append("defs");
        }
        defs.append("marker")
            .attr("id", "arrowhead-double")
            .attr("viewBox", "0 -5 10 10")
            .attr("refX", 9)
            .attr("refY", 0)
            .attr("orient", "auto")
            .attr("markerWidth", 8)
            .attr("markerHeight", 8)
            .append("path")
            .attr("d", "M0,-5L10,0L0,5")
            .attr("fill", "#333");
    })
        .newSort("instance", { source: "element", target: "element", cone_mor: "cone_mor" },
    { width: "number", bend: { type: "slider", min: -500, max: 500, default: 0 } }, (data, context) => {
        return drawArrow(data.source.position, data.target.position, { ...data, dashed: true }, context);
    })
        .newSort("zero_ob", { vertex: "Vertex" }, { position: { type: "relativePosition", target: "vertex.position" } }, (data, context) => {
        return context.append("text")
            .attr("x", data.position[0])
            .attr("y", data.position[1])
            .attr("text-anchor", "middle")
            .attr("dy", ".3em")
            .attr("fill", "#333")
            .attr("font-family", "sans-serif")
            .attr("font-size", "14px")
            .text("0");
    })
        .newSort("zero_elt", { element: "element" }, { position: { type: "relativePosition", target: "element.position" } }, (data, context) => {
        return context.append("text")
            .attr("x", data.position[0])
            .attr("y", data.position[1])
            .attr("text-anchor", "middle")
            .attr("dy", ".3em")
            .attr("fill", "#333")
            .attr("font-family", "sans-serif")
            .attr("font-size", "14px")
            .text("0");
    })
        .newSort("forall_elt", { element: "element" }, {}, (data, context) => {
        const x = data.element.position[0], y = data.element.position[1];
        const s = 6;
        return context.append("line")
            .attr("x1", x - s).attr("y1", y + 12)
            .attr("x2", x + s).attr("y2", y + 12)
            .attr("stroke", "#333")
            .attr("stroke-width", 2);
    })
        .newSort("exact_seq", { first: "Edge", second: "Edge" },
    { bend: { type: "slider", min: -500, max: 500, default: 0 }, offset: { type: "slider", min: 0, max: 500, default: 20 } }, (data, context) => {
        const offset = typeof data.offset === "number" ? data.offset : 20;
        const s1 = data.first.source.position, t1 = data.first.target.position;
        const c1 = bendMid(s1, t1, typeof data.first.bend === "number" ? data.first.bend : 0);
        const u1 = unitVec([c1.cx, c1.cy], t1);
        const s2 = data.second.source.position, t2 = data.second.target.position;
        const c2 = bendMid(s2, t2, typeof data.second.bend === "number" ? data.second.bend : 0);
        const u2 = unitVec(s2, [c2.cx, c2.cy]);
        const gap = VERTEX_RADIUS + offset;
        const start = [t1[0] - u1[0] * gap, t1[1] - u1[1] * gap];
        const end = [s2[0] + u2[0] * gap, s2[1] + u2[1] * gap];
        return drawArc(start, end, data, context);
    });
}
