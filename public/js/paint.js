// =========================================================
//  DND VTT – Paint Mode & Visual Filters
// =========================================================

// Tool configuration: what gets painted per tool
const TOOL_CONFIG = {
    stone:  { fill: '#6b6b6b', stroke: '#444', type: 'rect' },
    grass:  { fill: '#4CAF50', stroke: '#388e3c', type: 'rect' },
    dirt:   { fill: '#795548', stroke: '#5d4037', type: 'rect' },
    sand:   { fill: '#d4c281', stroke: '#bda95c', type: 'rect' },
    water:  { fill: '#1565c0', stroke: '#0d47a1', opacity: 0.7, type: 'rect' },
    lava:   { fill: '#e64a19', stroke: '#bf360c', type: 'rect' },
    pillar: { fill: '#9e9e9e', stroke: '#616161', type: 'circle' },
    door:   { fill: '#5D4037', stroke: '#3e2723', type: 'door' },
    table:  { fill: '#8D6E63', stroke: '#6d4c41', type: 'rect' },
    star:   { fill: '#FFD700', stroke: '#FFA000', type: 'circle' }
};

document.addEventListener('DOMContentLoaded', () => {
    setupPaintTools();
    setupFilters();
    setupPaintMouseEvents();
});

// ---------------------------------------------------------
//  Paint Tool Buttons
// ---------------------------------------------------------
function setupPaintTools() {
    document.querySelectorAll('.tool-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const tool = e.currentTarget.dataset.tool;

            if (window.VTT.paint.activeTool === tool) {
                // Click same tool again to deselect
                deactivatePaintTool();
            } else {
                document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
                e.currentTarget.classList.add('active');
                window.VTT.paint.activeTool = tool;
                // Switch canvas to non-selection mode while painting
                window.VTT.canvas.isDrawingMode = false;
                window.VTT.canvas.selection = false;
                window.VTT.canvas.discardActiveObject();
                window.VTT.canvas.defaultCursor = 'crosshair';
                window.VTT.canvas.requestRenderAll();
            }
        });
    });

    document.getElementById('clear-tool-btn').addEventListener('click', deactivatePaintTool);
}

function deactivatePaintTool() {
    document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
    window.VTT.paint.activeTool = null;
    window.VTT.canvas.selection = true;
    window.VTT.canvas.defaultCursor = 'default';
    window.VTT.canvas.requestRenderAll();
}

// ---------------------------------------------------------
//  Paint Mouse Events
// ---------------------------------------------------------
function setupPaintMouseEvents() {
    const getCanvas = () => window.VTT.canvas;

    getCanvas().on('mouse:down', (opt) => {
        if (window.VTT.isPlayMode) return;
        if (!window.VTT.paint.activeTool) return;
        window.VTT.paint.isDrawing = true;
        placeOnGrid(opt);
    });

    getCanvas().on('mouse:move', (opt) => {
        if (!window.VTT.paint.isDrawing) return;
        if (!window.VTT.paint.activeTool) return;
        placeOnGrid(opt);
    });

    getCanvas().on('mouse:up', () => {
        window.VTT.paint.isDrawing = false;
    });
}

function placeOnGrid(opt) {
    const canvas = window.VTT.canvas;
    const g = window.VTT.gridSize;
    const ptr = canvas.getPointer(opt.e);

    const col = Math.floor(ptr.x / g);
    const row = Math.floor(ptr.y / g);
    const x = col * g;
    const y = row * g;

    const tool = window.VTT.paint.activeTool;
    const cfg = TOOL_CONFIG[tool];
    if (!cfg) return;

    // Check if same tile already has this tool type — skip to avoid stacking
    const existingObj = canvas.getObjects().find(o =>
        o._tileCol === col && o._tileRow === row && o._toolType !== undefined
    );

    if (existingObj) {
        if (existingObj._toolType === tool) return; // same tile, same type
        canvas.remove(existingObj);                 // replace with new type
    }

    let obj;
    if (cfg.type === 'rect' || cfg.type === 'door') {
        obj = new fabric.Rect({
            left: x, top: y,
            width: g, height: cfg.type === 'door' ? g * 0.3 : g,
            fill: cfg.fill, stroke: cfg.stroke, strokeWidth: 1,
            opacity: cfg.opacity || 1
        });
    } else if (cfg.type === 'circle') {
        obj = new fabric.Circle({
            left: x, top: y,
            radius: g / 2,
            fill: cfg.fill, stroke: cfg.stroke, strokeWidth: 1
        });
    }

    obj.set({
        _tileCol: col,
        _tileRow: row,
        _toolType: tool,
        selectable: true,
        evented: true,
        _noSnap: false
    });

    canvas.add(obj);
    // Send tile behind images but above background
    canvas.sendToBack(obj);
    canvas.requestRenderAll();
}

// ---------------------------------------------------------
//  Visual Filters (DOM overlay)
// ---------------------------------------------------------
function setupFilters() {
    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            applyFilter(e.currentTarget.dataset.filter);
        });
    });

    document.getElementById('clear-filters-btn').addEventListener('click', () => {
        applyFilter(null);
    });
}

function applyFilter(type) {
    let overlay = document.getElementById('vtt-filter-overlay');

    if (!overlay) {
        overlay = document.createElement('canvas');
        overlay.id = 'vtt-filter-overlay';
        overlay.style.cssText = `
            position: absolute;
            top: 0; left: 0;
            width: 100%; height: 100%;
            pointer-events: none;
            z-index: 5;
        `;
        document.getElementById('canvas-container').appendChild(overlay);
        animateFilter(overlay);
    }

    window.VTT.currentFilter = type;
    window.VTT._filterOverlayEl = overlay;

    if (!type) {
        overlay.style.display = 'none';
    } else {
        overlay.style.display = 'block';
        overlay.width = overlay.offsetWidth;
        overlay.height = overlay.offsetHeight;
    }
}

function animateFilter(overlay) {
    let t = 0;

    function draw() {
        requestAnimationFrame(draw);
        const type = window.VTT.currentFilter;
        if (!type || overlay.style.display === 'none') return;

        overlay.width = overlay.offsetWidth;
        overlay.height = overlay.offsetHeight;

        const ctx = overlay.getContext('2d');
        const w = overlay.width;
        const h = overlay.height;
        t += 0.01;

        ctx.clearRect(0, 0, w, h);

        if (type === 'mist') drawMist(ctx, w, h, t);
        if (type === 'fog')  drawFog(ctx, w, h, t);
        if (type === 'fire') drawFire(ctx, w, h, t);
    }
    draw();
}

function drawMist(ctx, w, h, t) {
    // 3 layers of drifting soft cloudbanks, different speeds + colours
    const layers = [
        { count: 5, r: 150, speed: 0.25, yBand: 0.55, col: '210,225,255', alpha: 0.14 },
        { count: 4, r: 200, speed: 0.15, yBand: 0.45, col: '200,215,240', alpha: 0.10 },
        { count: 6, r: 100, speed: 0.40, yBand: 0.65, col: '230,240,255', alpha: 0.12 }
    ];
    layers.forEach((l, li) => {
        for (let i = 0; i < l.count; i++) {
            const seed = i * 2.3 + li * 7.1;
            const x   = ((w * (i / l.count) + t * l.speed * 40 + Math.sin(t * 0.3 + seed) * 50)) % (w + 200) - 100;
            const y   = h * l.yBand + Math.cos(t * 0.2 + seed) * h * 0.2;
            const r   = l.r + Math.sin(t * 0.5 + seed) * 30;
            const g   = ctx.createRadialGradient(x, y, 5, x, y, r);
            g.addColorStop(0, `rgba(${l.col},${l.alpha})`);
            g.addColorStop(1, `rgba(${l.col},0)`);
            ctx.beginPath();
            ctx.arc(x, y, r, 0, Math.PI * 2);
            ctx.fillStyle = g;
            ctx.fill();
        }
    });
}

function drawFog(ctx, w, h, t) {
    // Dense layered fog with twisting tendrils
    ctx.save();

    // Base atmospheric haze
    const baseGrad = ctx.createLinearGradient(0, 0, 0, h);
    baseGrad.addColorStop(0,   'rgba(80,85,95,0)');
    baseGrad.addColorStop(0.3, 'rgba(80,85,95,0.08)');
    baseGrad.addColorStop(0.6, 'rgba(90,95,108,0.3)');
    baseGrad.addColorStop(1,   'rgba(70,75,85,0.5)');
    ctx.fillStyle = baseGrad;
    ctx.fillRect(0, 0, w, h);

    // Thick slow rolling banks
    for (let i = 0; i < 7; i++) {
        const seed = i * 3.7;
        const x = ((w * 0.15 * i + t * 22 + Math.sin(t * 0.2 + seed) * 70)) % (w + 300) - 150;
        const y = h * 0.5 + Math.sin(t * 0.15 + seed * 1.3) * h * 0.3;
        const r = 200 + Math.cos(t * 0.3 + seed) * 60;
        const a = 0.28 + Math.sin(t * 0.4 + seed) * 0.08;
        const g = ctx.createRadialGradient(x, y, 10, x, y, r);
        g.addColorStop(0, `rgba(110,115,128,${a})`);
        g.addColorStop(0.5, `rgba(85,90,100,${a * 0.6})`);
        g.addColorStop(1,   'rgba(70,75,85,0)');
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fillStyle = g;
        ctx.fill();
    }

    // Fast wispy tendrils near the ground
    for (let i = 0; i < 5; i++) {
        const seed = i * 5.1;
        const x = ((w * 0.22 * i + t * 55 + Math.sin(t * 0.5 + seed) * 40)) % (w + 200) - 100;
        const y = h * 0.75 + Math.cos(t * 0.4 + seed) * h * 0.12;
        const rx = 180 + Math.sin(t + seed) * 40;
        const ry = 25 + Math.cos(t * 0.6 + seed) * 8;
        const a  = 0.22 + Math.sin(t * 0.7 + seed) * 0.07;

        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(Math.sin(t * 0.2 + seed) * 0.15);
        const eg = ctx.createRadialGradient(0, 0, 5, 0, 0, rx);
        eg.addColorStop(0, `rgba(140,145,160,${a})`);
        eg.addColorStop(1, 'rgba(100,105,115,0)');
        ctx.scale(1, ry / rx);
        ctx.beginPath();
        ctx.arc(0, 0, rx, 0, Math.PI * 2);
        ctx.fillStyle = eg;
        ctx.fill();
        ctx.restore();
    }

    ctx.restore();
}

function drawFire(ctx, w, h, t) {
    // Rising gradient from bottom
    const grad = ctx.createLinearGradient(0, h, 0, h * 0.3);
    const fl = 0.12 + Math.sin(t * 9) * 0.04 + Math.sin(t * 14.3) * 0.025;
    grad.addColorStop(0,   `rgba(255,50,0,${fl + 0.18})`);
    grad.addColorStop(0.35,`rgba(255,110,0,${fl + 0.08})`);
    grad.addColorStop(0.65,`rgba(255,170,0,${fl * 0.6})`);
    grad.addColorStop(1,   'rgba(255,200,0,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    // Bright inner glow columns
    for (let i = 0; i < 4; i++) {
        const cx = w * (0.15 + i * 0.22 + Math.sin(t * 0.7 + i) * 0.04);
        const cg = ctx.createLinearGradient(0, h, 0, h * 0.4);
        cg.addColorStop(0, `rgba(255,120,0,${0.18 + Math.sin(t * 5 + i) * 0.06})`);
        cg.addColorStop(1, 'rgba(255,200,0,0)');
        ctx.fillStyle = cg;
        ctx.fillRect(cx - 40, 0, 80, h);
    }

    // Ember particles
    for (let i = 0; i < 20; i++) {
        const seed = i * 1.87;
        const px = (Math.sin(t * 1.1 + seed) * 0.5 + 0.5) * w;
        const life = ((t * 70 * (0.4 + (i % 4) * 0.2) + seed * 50) % (h * 1.2));
        const py = h - life;
        const pr = 1.5 + Math.abs(Math.sin(t * 3 + seed)) * 3;
        const pa = Math.max(0, 1 - life / (h * 0.9));
        ctx.beginPath();
        ctx.arc(px + Math.sin(t * 2.5 + seed) * 15, py, pr, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255,${160 + Math.floor(Math.sin(t * 2 + seed) * 60)},0,${pa * 0.8})`;
        ctx.fill();
    }
}

