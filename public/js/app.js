// =========================================================
//  DND VTT - Core App Logic
// =========================================================

window.VTT = {
    canvas: null,
    gridSize: 50,
    showGrid: true,
    isPlayMode: false,
    currentFilter: null,
    scenes: { list: [], currentIndex: -1 },
    paint: { activeTool: null, isDrawing: false },
    tracker: { players: [], activePlayerIndex: -1 }
};

// ---------------------------------------------------------
//  INIT
// ---------------------------------------------------------
document.addEventListener('DOMContentLoaded', () => {
    initCanvas();
    setupEventListeners();
    window.addEventListener('resize', resizeCanvas);
    resizeCanvas();
});

function initCanvas() {
    const container = document.getElementById('canvas-container');
    const w = container.clientWidth;
    const h = container.clientHeight;

    window.VTT.canvas = new fabric.Canvas('vtt-canvas', {
        width: w,
        height: h,
        selection: true,
        preserveObjectStacking: true
    });

    fabric.Object.prototype.transparentCorners = false;
    fabric.Object.prototype.cornerColor = '#d32f2f';
    fabric.Object.prototype.cornerStyle = 'circle';
    fabric.Object.prototype.borderColor = '#d32f2f';

    // Draw the grid on canvas after every render using overlay context
    window.VTT.canvas.on('after:render', drawGrid);

    // Snap to grid on move
    window.VTT.canvas.on('object:moving', (opt) => {
        const obj = opt.target;
        if (obj._noSnap) return;
        const g = window.VTT.gridSize;
        obj.set({
            left: Math.round(obj.left / g) * g,
            top: Math.round(obj.top / g) * g
        });
    });
}

function resizeCanvas() {
    const container = document.getElementById('canvas-container');
    window.VTT.canvas.setWidth(container.clientWidth);
    window.VTT.canvas.setHeight(container.clientHeight);
    window.VTT.canvas.requestRenderAll();
}

// ---------------------------------------------------------
//  GRID (drawn on overlay, not as fabric objects)
// ---------------------------------------------------------
function drawGrid() {
    if (!window.VTT.showGrid || window.VTT.isPlayMode) return;

    const canvas = window.VTT.canvas;
    const ctx = canvas.getContext();
    const w = canvas.width;
    const h = canvas.height;
    const g = window.VTT.gridSize;

    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.lineWidth = 1;
    ctx.beginPath();

    for (let x = 0; x <= w; x += g) {
        ctx.moveTo(x + 0.5, 0);
        ctx.lineTo(x + 0.5, h);
    }
    for (let y = 0; y <= h; y += g) {
        ctx.moveTo(0, y + 0.5);
        ctx.lineTo(w, y + 0.5);
    }

    ctx.stroke();
    ctx.restore();
}

// ---------------------------------------------------------
//  EVENT LISTENERS
// ---------------------------------------------------------
function setupEventListeners() {
    // Mode Toggle
    document.getElementById('toggle-mode-btn').addEventListener('click', togglePlayMode);

    // Grid Controls
    document.getElementById('grid-toggle').addEventListener('change', (e) => {
        window.VTT.showGrid = e.target.checked;
        window.VTT.canvas.requestRenderAll();
    });

    document.getElementById('grid-size').addEventListener('change', (e) => {
        let sz = parseInt(e.target.value) || 50;
        if (sz < 10) sz = 10;
        window.VTT.gridSize = sz;
        window.VTT.canvas.requestRenderAll();
    });

    // Image / Background Upload
    document.getElementById('image-upload').addEventListener('change', (e) => handleFileUpload(e, false));
    document.getElementById('bg-upload').addEventListener('change', (e) => handleFileUpload(e, true));

    // Keyboard shortcuts
    window.addEventListener('keydown', handleKeys);
}

// ---------------------------------------------------------
//  PLAY MODE
// ---------------------------------------------------------
function togglePlayMode() {
    window.VTT.isPlayMode = !window.VTT.isPlayMode;
    const body = document.body;

    if (window.VTT.isPlayMode) {
        body.classList.add('play-mode');
        body.classList.remove('design-mode');
        // Deselect & lock objects
        window.VTT.canvas.discardActiveObject();
        window.VTT.canvas.getObjects().forEach(o => {
            o.selectable = false;
            o.evented = false;
        });
    } else {
        body.classList.remove('play-mode');
        body.classList.add('design-mode');
        // Re-enable selection
        window.VTT.canvas.getObjects().forEach(o => {
            o.selectable = true;
            o.evented = true;
        });
    }

    window.VTT.canvas.requestRenderAll();

    // Recalculate canvas size after sidebar animates in/out
    setTimeout(resizeCanvas, 350);
}

// ---------------------------------------------------------
//  IMAGE UPLOAD
// ---------------------------------------------------------
function handleFileUpload(e, isBackground) {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (ev) => {
        const url = ev.target.result;

        if (isBackground) {
            fabric.Image.fromURL(url, (img) => {
                window.VTT.canvas.setBackgroundImage(img,
                    window.VTT.canvas.renderAll.bind(window.VTT.canvas),
                    {
                        scaleX: window.VTT.canvas.width / img.width,
                        scaleY: window.VTT.canvas.height / img.height
                    }
                );
            });
        } else {
            fabric.Image.fromURL(url, (img) => {
                const g = window.VTT.gridSize;
                // Scale down if huge
                const maxW = window.VTT.canvas.width * 0.4;
                if (img.width > maxW) img.scaleToWidth(maxW);

                img.set({
                    left: Math.round((window.VTT.canvas.width / 2 - img.getScaledWidth() / 2) / g) * g,
                    top:  Math.round((window.VTT.canvas.height / 2 - img.getScaledHeight() / 2) / g) * g,
                });

                window.VTT.canvas.add(img);
                window.VTT.canvas.setActiveObject(img);
                window.VTT.canvas.requestRenderAll();
            });
        }
    };
    reader.readAsDataURL(file);
    e.target.value = '';
}

// ---------------------------------------------------------
//  KEYBOARD SHORTCUTS
// ---------------------------------------------------------
function handleKeys(e) {
    const tag = document.activeElement.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;

    // Delete selected objects
    if (e.key === 'Delete' && !window.VTT.isPlayMode) {
        window.VTT.canvas.getActiveObjects().forEach(o => window.VTT.canvas.remove(o));
        window.VTT.canvas.discardActiveObject();
        window.VTT.canvas.requestRenderAll();
    }

    // Scene switching - handled in scenes.js
    // Initiative switching - handled in initiavetracker.js
}
