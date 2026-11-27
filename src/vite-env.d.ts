/// <reference types="vite/client" />
/// <reference types="svelte" />

declare module '*?raw' {
    const content: string;
    export default content;
}

declare module 'virtual:draw-body/*' {
    const content: string;
    export default content;
}
