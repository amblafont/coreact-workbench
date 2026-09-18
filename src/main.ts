import { mount } from 'svelte';
import './demo';
import { activeDrawingName, drawing, drawingStore } from './ui/store.svelte.ts';
import App from './ui/App.svelte';
import './ui/app.css';

// Load the simple mono drawing as the active drawing (it was saved during the
// demo initialization in demo.ts) so the canvas starts with its content.
drawingStore.loadDrawing('SimpleMono', drawing);
activeDrawingName.set('SimpleMono');

const target = document.getElementById('app')!;
target.innerHTML = '';
mount(App, { target });
