import { mount } from 'svelte';
import './demo';
import { setActiveDrawing } from './ui/store.svelte.ts';
import App from './ui/App.svelte';
import './ui/app.css';

// Open the simple mono drawing as the active drawing (it was added during the
// demo initialization in demo.ts) so the canvas starts with its content.
setActiveDrawing('SimpleMono');

mount(App, { target: document.body });