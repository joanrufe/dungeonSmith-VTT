// =========================================================
//  DND VTT – Scene Management
// =========================================================

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('save-scene-btn').addEventListener('click', saveScene);
    window.addEventListener('keydown', (e) => {
        if (document.activeElement.tagName === 'INPUT') return;
        if (e.ctrlKey && e.key === '[') { e.preventDefault(); switchScene(-1); }
        if (e.ctrlKey && e.key === ']') { e.preventDefault(); switchScene(1); }
    });
    fetchScenes();
});

async function fetchScenes() {
    try {
        const res = await fetch('/api/scenes');
        window.VTT.scenes.list = await res.json();
        renderSceneList();
    } catch (err) {
        console.error("Could not load scenes:", err);
    }
}

function renderSceneList() {
    const ul = document.getElementById('scene-list');
    ul.innerHTML = '';
    window.VTT.scenes.list.forEach((name, i) => {
        const li = document.createElement('li');
        li.textContent = name;
        if (i === window.VTT.scenes.currentIndex) {
            li.classList.add('active-scene');
        }
        li.addEventListener('click', () => loadScene(name));
        ul.appendChild(li);
    });
}

async function saveScene() {
    const input = document.getElementById('scene-name');
    const name = input.value.trim() || `Scene_${Date.now()}`;

    const json = window.VTT.canvas.toJSON(['_tileCol', '_tileRow', '_toolType', '_noSnap']);
    const payload = {
        name,
        data: {
            canvas: json,
            filter: window.VTT.currentFilter || null,
            gridSize: window.VTT.gridSize,
            showGrid: window.VTT.showGrid
        }
    };

    try {
        await fetch('/api/scenes', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        input.value = '';
        await fetchScenes();
    } catch (err) {
        alert('Failed to save scene.\n' + err);
    }
}

async function loadScene(name) {
    try {
        const res = await fetch(`/api/scenes/${name}`);
        if (!res.ok) throw new Error("Scene not found");
        const payload = await res.json();

        if (payload.gridSize) {
            window.VTT.gridSize = payload.gridSize;
            document.getElementById('grid-size').value = payload.gridSize;
        }
        if (payload.showGrid !== undefined) {
            window.VTT.showGrid = payload.showGrid;
            document.getElementById('grid-toggle').checked = payload.showGrid;
        }

        applyFilter(payload.filter || null);

        window.VTT.canvas.loadFromJSON(payload.canvas, () => {
            window.VTT.canvas.requestRenderAll();
            window.VTT.scenes.currentIndex = window.VTT.scenes.list.indexOf(name);
            renderSceneList();
        });
    } catch (err) {
        console.error("Could not load scene:", err);
    }
}

function switchScene(dir) {
    const list = window.VTT.scenes.list;
    if (!list.length) return;
    let idx = window.VTT.scenes.currentIndex + dir;
    if (idx < 0) idx = list.length - 1;
    if (idx >= list.length) idx = 0;
    loadScene(list[idx]);
}
