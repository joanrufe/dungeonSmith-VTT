// public/js/stickyNotes.js
// DM-side sticky notes tool.
(function () {
  const COLORS    = { yellow: '#FFE57F', orange: '#FFB347', cyan: '#B2EBF2' };
  const BASE_FONT = 30;
  const NOTE_W    = 220;
  const NOTE_H    = 160;

  let notes       = [];
  let notesLayer  = null;
  let activeColor = 'yellow';
  let editingId   = null;
  let toolActive  = false;

  // ── Helpers ────────────────────────────────────────────────────

  function getCtx() {
    if (window.VTT_DM) return {
      renderer: window.VTT_DM.sceneManager.sceneRenderer,
      socket:   window.VTT_DM.socket,
    };
    return null;
  }

  function ensureLayer() {
    if (!notesLayer) {
      notesLayer = document.createElement('div');
      notesLayer.id = 'sn-layer';
      notesLayer.style.cssText = 'position:absolute;top:0;left:0;width:0;height:0;pointer-events:none;z-index:300;';
    }
    const sc = document.getElementById('scene-container');
    if (sc && !notesLayer.parentNode) sc.appendChild(notesLayer);
  }

  function syncEl(el, note, r) {
    el.style.left   = `${(note.x + r.offsetX) * r.scale}px`;
    el.style.top    = `${(note.y + r.offsetY) * r.scale}px`;
    el.style.width  = `${note.w * r.scale}px`;
    el.style.height = `${note.h * r.scale}px`;
    const body = el.querySelector('.sn-body');
    if (body) body.style.fontSize = `${Math.max(10, Math.round(BASE_FONT * r.scale))}px`;
  }

  // ── RAF position sync ──────────────────────────────────────────

  function rafSync() {
    ensureLayer();
    const ctx = getCtx();
    if (ctx && notesLayer) {
      const r = ctx.renderer;
      notes.forEach(note => {
        const el = notesLayer.querySelector(`[data-note-id="${note.id}"]`);
        if (el) syncEl(el, note, r);
      });
    }
    requestAnimationFrame(rafSync);
  }

  // ── Element creation ───────────────────────────────────────────

  function makeElement(note) {
    const el = document.createElement('div');
    el.className = 'sticky-note';
    el.dataset.noteId = note.id;
    el.style.background = COLORS[note.color] || COLORS.yellow;
    el.style.pointerEvents = 'auto'; // always interactive

    // Header (delete button only — not a drag restriction anymore)
    const head = document.createElement('div');
    head.className = 'sn-head';

    const del = document.createElement('button');
    del.className = 'sn-del';
    del.textContent = '×';
    del.title = 'Delete note';
    del.addEventListener('click', e => { e.stopPropagation(); deleteNote(note.id); });
    head.appendChild(del);
    el.appendChild(head);

    // Body text
    const body = document.createElement('div');
    body.className = 'sn-body';
    body.textContent = note.text || '';
    body.contentEditable = 'false';
    el.appendChild(body);

    // Double-click anywhere on the note → edit
    el.addEventListener('dblclick', e => {
      e.stopPropagation();
      enterEdit(note.id);
    });

    return el;
  }

  function setupInteract(note, el) {
    interact(el)
      .draggable({
        ignoreFrom: '.sn-del',
        listeners: {
          start(event) {
            // Block drag when editing this note or when paint tool is active
            if (editingId === note.id || window.VTT_ACTIVE_PAINT_TOOL) {
              event.interaction.stop();
            }
          },
          move(event) {
            if (editingId === note.id) return;
            const ctx = getCtx();
            if (!ctx) return;
            const r = ctx.renderer;
            note.x += event.dx / r.scale;
            note.y += event.dy / r.scale;
            el.style.left = `${(note.x + r.offsetX) * r.scale}px`;
            el.style.top  = `${(note.y + r.offsetY) * r.scale}px`;
          },
          end() { saveNotes(); },
        },
      })
      .resizable({
        edges: { bottom: true, right: true },
        modifiers: [interact.modifiers.restrictSize({ min: { width: 90, height: 70 } })],
        listeners: {
          move(event) {
            const ctx = getCtx();
            if (!ctx) return;
            const r = ctx.renderer;
            note.w = event.rect.width  / r.scale;
            note.h = event.rect.height / r.scale;
            el.style.width  = `${note.w * r.scale}px`;
            el.style.height = `${note.h * r.scale}px`;
          },
          end() { saveNotes(); },
        },
      });
  }

  // ── Render ─────────────────────────────────────────────────────

  function renderAll() {
    if (!notesLayer) return;
    notesLayer.innerHTML = '';
    const ctx = getCtx();
    notes.forEach(note => {
      const el = makeElement(note);
      if (ctx) syncEl(el, note, ctx.renderer);
      notesLayer.appendChild(el);
      setupInteract(note, el);
    });
  }

  function addElement(note) {
    ensureLayer();
    const ctx = getCtx();
    const el = makeElement(note);
    if (ctx) syncEl(el, note, ctx.renderer);
    notesLayer.appendChild(el);
    setupInteract(note, el);
  }

  // ── Editing ────────────────────────────────────────────────────

  function enterEdit(id) {
    if (editingId && editingId !== id) exitEdit();
    editingId = id;
    const el = notesLayer && notesLayer.querySelector(`[data-note-id="${id}"]`);
    if (!el) return;
    const body = el.querySelector('.sn-body');
    body.contentEditable = 'true';
    body.focus();
    try {
      const range = document.createRange();
      range.selectNodeContents(body);
      range.collapse(false);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    } catch (e) { /* ignore */ }
  }

  function exitEdit() {
    if (!editingId) return;
    const el = notesLayer && notesLayer.querySelector(`[data-note-id="${editingId}"]`);
    if (el) {
      const body = el.querySelector('.sn-body');
      body.contentEditable = 'false';
      const note = notes.find(n => n.id === editingId);
      if (note && note.text !== body.textContent) {
        note.text = body.textContent;
        saveNotes();
      }
    }
    editingId = null;
  }

  // ── CRUD ───────────────────────────────────────────────────────

  function createNote(worldX, worldY) {
    const note = {
      id:    Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      x:     worldX,
      y:     worldY,
      w:     NOTE_W,
      h:     NOTE_H,
      color: activeColor,
      text:  '',
    };
    notes.push(note);
    addElement(note);
    saveNotes();
    setTimeout(() => enterEdit(note.id), 30);
  }

  function deleteNote(id) {
    if (editingId === id) editingId = null;
    notes = notes.filter(n => n.id !== id);
    const el = notesLayer && notesLayer.querySelector(`[data-note-id="${id}"]`);
    if (el) el.remove();
    saveNotes();
  }

  // ── Persistence ────────────────────────────────────────────────

  async function saveNotes() {
    try {
      await fetch('/sticky-notes', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(notes),
      });
    } catch (e) { console.error('sticky-notes save error', e); }
  }

  async function loadNotes() {
    try {
      const r = await fetch('/sticky-notes');
      notes = await r.json();
    } catch { notes = []; }
    ensureLayer();
    renderAll();
  }

  // ── Tool activation (controls CREATE mode only) ────────────────

  function activateTool() {
    toolActive = true;
    window.VTT_ACTIVE_NOTES_TOOL = true;
    document.getElementById('notes-toggle-btn').classList.add('active-tool-btn');
    document.getElementById('notes-panel').classList.remove('panel-hidden');
  }

  function deactivateTool() {
    exitEdit();
    toolActive = false;
    window.VTT_ACTIVE_NOTES_TOOL = false;
    const btn = document.getElementById('notes-toggle-btn');
    if (btn) btn.classList.remove('active-tool-btn');
    const panel = document.getElementById('notes-panel');
    if (panel) panel.classList.add('panel-hidden');
  }

  // ── Init ───────────────────────────────────────────────────────

  document.addEventListener('DOMContentLoaded', () => {

    // Tray toggle button
    const toggleBtn = document.getElementById('notes-toggle-btn');
    if (toggleBtn) {
      toggleBtn.addEventListener('click', () => {
        if (toolActive) deactivateTool(); else activateTool();
      });
    }

    // Color swatches
    document.querySelectorAll('.sn-color-swatch').forEach(sw => {
      sw.addEventListener('click', () => {
        activeColor = sw.dataset.color;
        document.querySelectorAll('.sn-color-swatch').forEach(s => s.classList.remove('active'));
        sw.classList.add('active');
      });
    });

    // Double-click empty scene area → create note (when tool active)
    const sc = document.getElementById('scene-container');
    if (sc) {
      sc.addEventListener('dblclick', e => {
        if (!toolActive) return;
        if (e.target.closest('.sticky-note')) return;
        e.stopImmediatePropagation();
        const ctx = getCtx();
        if (!ctx) return;
        const rect = sc.getBoundingClientRect();
        const wx = (e.clientX - rect.left)  / ctx.renderer.scale - ctx.renderer.offsetX;
        const wy = (e.clientY - rect.top)   / ctx.renderer.scale - ctx.renderer.offsetY;
        createNote(wx, wy);
      });
    }

    // Click outside note → exit edit mode
    document.addEventListener('pointerdown', e => {
      if (!editingId) return;
      const editEl = notesLayer && notesLayer.querySelector(`[data-note-id="${editingId}"]`);
      if (editEl && !editEl.contains(e.target)) exitEdit();
    }, true);

    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        if (editingId) { exitEdit(); return; }
        if (toolActive) deactivateTool();
      }
    });

    requestAnimationFrame(rafSync);

    (function tryLoad() {
      if (window.VTT_DM && window.VTT_DM.socket) {
        loadNotes();
      } else {
        setTimeout(tryLoad, 200);
      }
    })();
  });
})();
