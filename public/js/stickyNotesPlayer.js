// public/js/stickyNotesPlayer.js
// Player sticky notes tool. Notes are private and stored in localStorage.

/** @typedef {import('./sceneManager.js').StickyNoteDict} StickyNoteDict */

(function () {
  const COLORS    = { yellow: '#FFE57F', orange: '#FFB347', cyan: '#B2EBF2' };
  const BASE_FONT = 30;
  const NOTE_W    = 220;
  const NOTE_H    = 160;
  const LS_KEY    = 'vtt-player-notes';

  let notes       = [];
  let notesLayer  = null;
  let activeColor = 'yellow';
  let editingId   = null;
  let toolActive  = false;

  // ── Helpers ────────────────────────────────────────────────────

  function getRenderer() {
    return window.VTT_PLAYER && window.VTT_PLAYER.sceneRenderer;
  }

  function ensureLayer() {
    if (!notesLayer) {
      notesLayer = document.createElement('div');
      notesLayer.id = 'sn-player-layer';
      notesLayer.style.cssText = 'position:absolute;top:0;left:0;width:0;height:0;pointer-events:none;z-index:300;';
    }
    const sc = document.getElementById('scene-container');
    if (sc && !notesLayer.parentNode) sc.appendChild(notesLayer);
  }

  /**
   * Syncs an existing note DOM element's position and size to current renderer state.
   * @param {HTMLElement}    el
   * @param {StickyNoteDict} note
   * @param {object}         r  - SceneRenderer instance
   */
  function syncEl(el, note, r) {
    el.style.left   = `${(note.x + r.offsetX) * r.scale}px`;
    el.style.top    = `${(note.y + r.offsetY) * r.scale}px`;
    el.style.width  = `${note.w * r.scale}px`;
    el.style.height = `${note.h * r.scale}px`;
    const body = el.querySelector('.sn-body');
    if (body) body.style.fontSize = `${Math.max(10, Math.round(BASE_FONT * r.scale))}px`;
  }

  // ── RAF position sync ──────────────────────────────────────────

  let _lastScale = null, _lastOffX = null, _lastOffY = null;

  function rafSync() {
    ensureLayer();
    requestAnimationFrame(rafSync);
    if (!notes.length) return;
    const r = getRenderer();
    if (!r || !notesLayer) return;
    if (r.scale === _lastScale && r.offsetX === _lastOffX && r.offsetY === _lastOffY) return;
    _lastScale = r.scale; _lastOffX = r.offsetX; _lastOffY = r.offsetY;
    notes.forEach(note => { if (note.el) syncEl(note.el, note, r); });
  }

  // ── Element creation ───────────────────────────────────────────

  /**
   * Creates a DOM element for the given note and attaches it to note.el.
   * @param {StickyNoteDict} note
   * @returns {HTMLElement}
   */
  function makeElement(note) {
    const el = document.createElement('div');
    el.className = 'sticky-note';
    el.dataset.noteId = note.id;
    el.style.background = COLORS[note.color] || COLORS.yellow;
    el.style.pointerEvents = 'auto';

    const head = document.createElement('div');
    head.className = 'sn-head';
    head.addEventListener('mousedown', () => { if (editingId === note.id) exitEdit(); });

    const del = document.createElement('button');
    del.className = 'sn-del';
    del.textContent = '×';
    del.title = 'Delete note';
    del.addEventListener('click', e => { e.stopPropagation(); deleteNote(note.id); });
    head.appendChild(del);
    el.appendChild(head);

    const body = document.createElement('div');
    body.className = 'sn-body';
    body.textContent = note.text || '';
    body.contentEditable = 'false';
    el.appendChild(body);

    el.addEventListener('dblclick', e => {
      e.stopPropagation();
      enterEdit(note.id);
    });

    note.el = el;
    return el;
  }

  /**
   * Attaches interact.js drag and resize handlers to a note's DOM element.
   * Mutates note.x, note.y, note.w, note.h during drag/resize.
   * @param {StickyNoteDict} note
   * @param {HTMLElement}    el
   */
  function setupInteract(note, el) {
    interact(el)
      .draggable({
        ignoreFrom: '.sn-del',
        listeners: {
          start(event) {
            if (editingId === note.id) event.interaction.stop();
          },
          move(event) {
            if (editingId === note.id) return;
            const r = getRenderer();
            if (!r) return;
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
            const r = getRenderer();
            if (!r) return;
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

  /**
   * Renders all notes from scratch into notesLayer.
   */
  function renderAll() {
    ensureLayer();
    if (!notesLayer) return;
    notesLayer.innerHTML = '';
    const r = getRenderer();
    notes.forEach(note => {
      const el = makeElement(note);
      if (r) syncEl(el, note, r);
      notesLayer.appendChild(el);
      setupInteract(note, el);
    });
  }

  /**
   * Appends a single note element to the layer and wires up interactions.
   * @param {StickyNoteDict} note
   */
  function addElement(note) {
    ensureLayer();
    const r = getRenderer();
    const el = makeElement(note);
    if (r) syncEl(el, note, r);
    notesLayer.appendChild(el);
    setupInteract(note, el);
  }

  // ── Editing ────────────────────────────────────────────────────

  function enterEdit(id) {
    if (editingId && editingId !== id) exitEdit();
    editingId = id;
    const note = notes.find(n => n.id === id);
    const el = note && note.el;
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
    const note = notes.find(n => n.id === editingId);
    const el = note && note.el;
    if (el) {
      const body = el.querySelector('.sn-body');
      body.contentEditable = 'false';
      if (note.text !== body.textContent) {
        note.text = body.textContent;
        saveNotes();
      }
    }
    editingId = null;
  }

  // ── CRUD ───────────────────────────────────────────────────────

  /**
   * Creates a new note at the given world coordinates and persists it.
   * @param {number} worldX
   * @param {number} worldY
   * @returns {StickyNoteDict}
   */
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
    const note = notes.find(n => n.id === id);
    if (note && note.el) note.el.remove();
    notes = notes.filter(n => n.id !== id);
    saveNotes();
  }

  // ── Persistence (localStorage) ─────────────────────────────────

  /**
   * Persists the in-memory notes array to localStorage.
   */
  function saveNotes() {
    try { localStorage.setItem(LS_KEY, JSON.stringify(notes)); } catch (e) {}
  }

  /**
   * Loads notes from localStorage and renders them. Populates the module-level `notes` array.
   */
  function loadNotes() {
    try {
      const data = localStorage.getItem(LS_KEY);
      notes = data ? JSON.parse(data) : [];
    } catch { notes = []; }
    renderAll();
  }

  // ── Tool activation (controls CREATE mode only) ────────────────

  function activateTool() {
    toolActive = true;
    const btn = document.getElementById('player-notes-toggle-btn');
    if (btn) btn.classList.add('pn-active');
    const panel = document.getElementById('player-notes-panel');
    if (panel) panel.classList.remove('panel-hidden');
  }

  function deactivateTool() {
    exitEdit();
    toolActive = false;
    const btn = document.getElementById('player-notes-toggle-btn');
    if (btn) btn.classList.remove('pn-active');
    const panel = document.getElementById('player-notes-panel');
    if (panel) panel.classList.add('panel-hidden');
  }

  // ── Make panel draggable ───────────────────────────────────────

  function makeDraggable(el) {
    if (!el) return;
    const handle = el.querySelector('.panel-drag-handle');
    if (!handle) return;
    let ox = 0, oy = 0, sx = 0, sy = 0;
    handle.addEventListener('mousedown', e => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      sx = e.clientX; sy = e.clientY;
      ox = rect.left;  oy = rect.top;
      el.style.right = 'auto';
      el.style.left  = ox + 'px';
      el.style.top   = oy + 'px';
      el.style.position = 'fixed';
      function onMove(e) {
        el.style.left = (ox + e.clientX - sx) + 'px';
        el.style.top  = (oy + e.clientY - sy) + 'px';
      }
      function onUp() {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup',   onUp);
      }
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup',   onUp);
    });
  }

  // ── Init ───────────────────────────────────────────────────────

  document.addEventListener('DOMContentLoaded', () => {

    // Toggle button
    const toggleBtn = document.getElementById('player-notes-toggle-btn');
    if (toggleBtn) {
      toggleBtn.addEventListener('click', () => {
        if (toolActive) deactivateTool(); else activateTool();
      });
    }

    // Color swatches
    document.querySelectorAll('.sn-player-swatch').forEach(sw => {
      sw.addEventListener('click', () => {
        activeColor = sw.dataset.color;
        document.querySelectorAll('.sn-player-swatch').forEach(s => s.classList.remove('active'));
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
        const r = getRenderer();
        if (!r) return;
        const rect = sc.getBoundingClientRect();
        const wx = (e.clientX - rect.left)  / r.scale - r.offsetX;
        const wy = (e.clientY - rect.top)   / r.scale - r.offsetY;
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

    makeDraggable(document.getElementById('player-notes-panel'));

    requestAnimationFrame(rafSync);

    // Load once the renderer is ready
    (function tryLoad() {
      if (window.VTT_PLAYER && window.VTT_PLAYER.sceneRenderer) {
        loadNotes();
      } else {
        setTimeout(tryLoad, 200);
      }
    })();
  });
})();
