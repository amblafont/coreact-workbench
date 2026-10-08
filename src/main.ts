import { mount } from 'svelte';
import { initialDrawingName } from './demo';
import { setActiveDrawing } from './ui/store.svelte.ts';
import App from './ui/App.svelte';
import './ui/app.css';

// Open the first drawing from examples/mono-short.json (loaded during startup
// in demo.ts) so the canvas starts with its content.
if (initialDrawingName) {
    setActiveDrawing(initialDrawingName);
}

mount(App, { target: document.body });