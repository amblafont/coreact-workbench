export interface GeometryApi {
    hookStartOffset(width: number): number;
    edgeMidpoint(
        srcPos: number[],
        tgtPos: number[],
        bend: number,
        width: number,
        isMono: boolean
    ): [number, number];
    offsetQuadratic(
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
    ): { startX: number; startY: number; cx: number; cy: number; endX: number; endY: number };
}

export interface SortApi {
    geometry: GeometryApi;
}
