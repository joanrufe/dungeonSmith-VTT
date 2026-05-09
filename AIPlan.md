# SceneSmith VTT Python/Flask Migration Plan

Goal: convert the current Node/Express/Socket.IO backend to Python/Flask while keeping the existing browser UI, scene files, media folders, and gameplay behavior intact.

Status: initial Flask migration is implemented in `app.py`. The batch scripts now run/build the Python app, and the browser loads a local Socket.IO client from `public/lib/socket.io/socket.io.min.js`.

Note: this migration should be treated as a backend/platform preference, not a slimming requirement. The current custom JavaScript is already small; the biggest size targets are media, uploads, music, dice assets, and dependency packaging.

## Target Stack

- Flask for HTTP routes and static file hosting
- Flask-SocketIO for real-time sync
- Werkzeug sessions or Flask-Login-style session checks
- Python standard `json`, `pathlib`, and `shutil` for scene/media storage
- Keep existing `public/` frontend JavaScript/CSS/HTML as much as possible

## Keep As-Is

- `public/` frontend files
- `public/js/` client behavior
- `public/css/` styling
- `public/lib/dice-box-threejs/`
- `public/media/`, `public/music/`, `public/uploads/`
- `data/scenes/` JSON format if possible
- `data/private/secrets.txt` password format

## Backend Files To Replace

These Node files have Python equivalents now and are no longer used by the run/build scripts:

- `server.js`
- `app.js`
- `routes.js`
- `socketHandler.js`
- `controllers/`
- `middlewares/`
- `models/`

Suggested Python layout:

```txt
app.py
config.py
requirements.txt
controllers/
  scenes.py
  media.py
  music.py
  sticky_notes.py
services/
  scene_store.py
  password_store.py
  media_store.py
socket_events.py
data/
  private/
  scenes/
public/
```

## Migration Steps

1. Create Flask app shell
   - Serve `public/` as static files.
   - Keep routes `/`, `/dm`, `/files`, `/player-login`, and `/dm-login`.
   - Disable default static index behavior so protected routes still apply.

2. Port authentication
   - Read passwords from `data/private/secrets.txt`.
   - Keep `DM_PASSWORD=` and `PLAYER_PASSWORD=` format.
   - Implement player and DM sessions.
   - Protect `/`, `/dm`, `/files`, uploads, media edits, scene edits, and password APIs the same way Node does.

3. Port scene storage
   - Preserve existing scene JSON schema.
   - Implement endpoints:
     - `GET /scenes`
     - `POST /createScene`
     - `POST /duplicateScene`
     - `POST /updateScene`
     - `POST /deleteScene`
     - `POST /updateSceneOrder`
   - Match current response shapes exactly so frontend JS does not need changes.

4. Port Socket.IO events
   - Use Flask-SocketIO event names matching `socketHandler.js`.
   - Required events include:
     - scene load/active scene sync
     - token add/update/remove
     - ping scene
     - dice roll/result/clear
     - music add/play/pause/delete/volume
     - grid toggle
     - snap view
   - Preserve event payload shapes.

5. Port uploads
   - Replace Multer with Flask file upload handling.
   - Keep media routes:
     - `POST /upload`
     - `POST /mediaUpload`
     - `GET /mediaList`
     - `POST /mediaFolder`
     - `PATCH /mediaFolder`
     - `DELETE /mediaFolder`
     - `DELETE /mediaFile`
   - Save files to the same folders.

6. Port music
   - Keep `public/music/` storage.
   - Preserve music upload/list/delete responses.
   - Keep Socket.IO music playback events unchanged.

7. Port sticky notes
   - Keep DM sticky notes in `data/sticky-notes.json`.
   - Implement:
     - `GET /sticky-notes`
     - `POST /sticky-notes`
   - Player notes remain browser `localStorage`; no backend needed.

8. Port password API
   - Implement:
     - `GET /passwords`
     - `PUT /passwords`
   - Keep plain text values because the current UI intentionally displays them.
   - Update in-memory password values immediately after change.

9. Port dice roller server logic
   - Recreate the current dice parsing from `socketHandler.js`.
   - Preserve result text format and color handling.
   - Broadcast `diceRolled`, `diceResult`, and `diceCleared`.

10. Add run/build scripts
   - Use:
     - `Run_DND_VTT.bat`
     - `Build_DND_VTT.bat`
   - Run script should use a script-set port variable, not prompt interactively.
   - Build script should create/use `.venv`, install `requirements.txt`, and syntax-check Python files.
   - Build script should create a slim runtime folder and exclude repo-only notes, source archives, and development-only files.

## Compatibility Checklist

- Existing scenes load without conversion.
- Existing media library folders appear correctly.
- DM can create, duplicate, delete, reorder, and switch scenes.
- Player sees active scene after login.
- Token visibility and movable-by-player rules still work.
- Dice rolls animate and clear on DM/player clients.
- Music playback syncs to players.
- Paint, effects, notes, ruler, pings, snap view, and initiative still work.
- Password tab reads/writes `data/private/secrets.txt`.

## Suggested Requirements

```txt
Flask
Flask-SocketIO
python-socketio
eventlet
Werkzeug
```

Use `eventlet` or another supported async mode for WebSocket support. If eventlet causes trouble on Windows, test `threading` mode first, then switch once the app is stable.

## Risk Areas

- Socket.IO protocol compatibility between browser client and Flask-SocketIO.
- Exact scene JSON shape expected by frontend code.
- File upload body parsing differences between Express/Multer and Flask.
- Session behavior for socket connections.
- Windows path handling for media folders.
- Accidentally changing frontend behavior while trying to optimize. Keep `public/js` mostly unchanged unless a specific bug or parity issue requires it.

## Recommended Strategy

Do this in phases, not as one rewrite:

1. Flask serves login pages and static frontend.
2. Flask sessions and password login work.
3. Scene HTTP routes work.
4. Socket.IO scene/token sync works.
5. Media/music upload routes work.
6. Dice/music/grid/snap/ping events work.
7. Remove old Node files only after browser parity testing.

Keep the old Node source files available as reference until the Flask version passes the compatibility checklist in a real browser session.
