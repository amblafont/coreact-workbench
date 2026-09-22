<script lang="ts">
    let { min = 180, max = 640, reverse = false, getStartWidth = (): number => 270, onWidth = (_w: number): void => {} }: {
        min?: number;
        max?: number;
        reverse?: boolean;
        getStartWidth?: () => number;
        onWidth?: (width: number) => void;
    } = $props();

    const STEP = 10;

    let dragging = $state(false);

    function setWidth(raw: number): void {
        onWidth(Math.min(max, Math.max(min, Math.round(raw))));
    }

    function onPointerDown(event: PointerEvent): void {
        const handle = event.currentTarget as HTMLButtonElement;
        const startX = event.clientX;
        const startWidth = getStartWidth();
        dragging = true;
        handle.setPointerCapture(event.pointerId);
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';

        function onPointerMove(moveEvent: PointerEvent): void {
            const delta = moveEvent.clientX - startX;
            setWidth(startWidth + (reverse ? -delta : delta));
        }

        function onPointerUp(): void {
            dragging = false;
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
            window.removeEventListener('pointermove', onPointerMove);
            window.removeEventListener('pointerup', onPointerUp);
        }

        window.addEventListener('pointermove', onPointerMove);
        window.addEventListener('pointerup', onPointerUp);
    }

    function onKeyDown(event: KeyboardEvent): void {
        const current = getStartWidth();
        const dir = reverse ? -1 : 1;
        if (event.key === 'ArrowLeft') {
            event.preventDefault();
            setWidth(current - STEP * dir);
        } else if (event.key === 'ArrowRight') {
            event.preventDefault();
            setWidth(current + STEP * dir);
        } else if (event.key === 'Home') {
            event.preventDefault();
            setWidth(min);
        } else if (event.key === 'End') {
            event.preventDefault();
            setWidth(max);
        }
    }
</script>

<button
    type="button"
    class="splitter"
    class:dragging
    aria-label="Resize panel"
    onpointerdown={onPointerDown}
    onkeydown={onKeyDown}
></button>