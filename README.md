# DungeonSmith VTT

A fork of [SceneSmith-VTT](https://github.com/Echoshard/SceneSmith-VTT), itself an expanded fork of [MiniVTT](https://github.com/SamsterJam/MiniVTT). DungeonSmith VTT keeps the original "everything is a token" simplicity while adding a larger DM toolset: media organization, paint tools, initiative announcements, 3D dice, ruler mode, player-facing sync, music controls, sticky notes, fog of war, and quality-of-life updates for running sessions quickly.

Original upstream project:  
https://github.com/Echoshard/SceneSmith-VTT

---

## Features

### Original MiniVTT Foundation

These are the core ideas and baseline capabilities inherited from MiniVTT:

**Real-time DM/player sync** - Connected DM and player clients stay synchronized through Socket.IO.

**Everything is a token** - Maps, characters, monsters, props, and videos can be placed on the canvas as movable scene objects.

**Scene management** - Create and switch between scenes during play.

**Drag-and-drop canvas uploads** - Drop image or video files onto the VTT canvas to create scene tokens.

**Token visibility and movement control** - Hide tokens from players and control whether players can interact with tokens.

**Pan and zoom** - Navigate the scene with mouse controls.

**Music support** - Upload and play music for connected clients.

### Added In SceneSmith-VTT

These features were introduced by the upstream SceneSmith-VTT fork before the DungeonSmith split:

**Expanded DM toolbar and floating panels** - DM tools live in draggable panels with a right-side tray for Initiative, Paint, Effects, Dice, Music, and Notes.

**DM Admin** - Organize reusable media in folders from `/dmadmin`. Upload images, videos, PDFs, and text documents. Shift-click downloads files, and double-clicking images/videos adds them to the active scene. Passwords can also be viewed.

**Password management tab** - Change DM and player passwords from the Media Library password tab or by editing `data/private/secrets.txt`.

**Improved token controls** - Duplicate, rotate, fine-rotate, change layer order, multi-select, and improved token drag behavior.

**Grid upgrades** - Square/hex grid toggle, adjustable grid size.

**Ruler mode** - Measures distance at 5 ft per grid cell.

**Paint system** - Paint terrain tiles directly onto the scene with adjustable brush size, custom colors, eraser, and layer controls.

**Initiative tracker** - Track turn order, edit names/values inline, advance rounds, and announce active turns with readable center-screen callouts visible to all players.

**3D dice roller** - Roll common dice or expressions like `2d6+12`. Synced across the network. Silent rolls only happen for you.

**Snap View** - DM can push their current camera position and zoom to connected players.

**Scene ping** - Double-click the scene to place a temporary blue ping indicator visible to all connected clients. Works on the background and on tokens.

**Sticky notes** - Private draggable notes pinned to the scene in world space. Persistent across sessions for the DM, not players.

**Player-side controls** - Player help modal, collapsible initiative sidebar, ruler, dice panel, sticky notes panel, and independent pan/zoom behavior.

**Scene dropdown and pinned scenes** - Scenes are accessed through a dropdown menu rather than a horizontal scrollbar. Pin up to 5 frequently used scenes to the toolbar for one-click access; pins persist.

**Effects tool** - Spawn transparent area-effect overlays directly on the canvas as standard tokens and animate them.

**Token lock** - Press `L` to lock a selected token. Locked tokens show a red outline, cannot be moved or resized by anyone, but remain selectable and deletable.

**Player Files** - A player-accessible media library at `/player-files`. Players can browse and double-click any file to download it. A **DM Mode** toggle (requires DM password) unlocks upload, file deletion, and folder management.

### Added In DungeonSmith VTT

These features were added after the DungeonSmith fork split from SceneSmith-VTT commit `532b5317db9ab9f650af7c96a37c9d85a09a3e44`:

**Token visibility toggle** - The DM can hide tokens from players with a simple checkbox in the token status popup. Hidden tokens are filtered out of player views and shown ghosted to the DM, making it easy to keep surprises off the player screen.

**Fog of war / line-of-sight** - Draw closed-polygon walls on the DM view to block player vision. Players see a canvas fog overlay with transparent visibility holes centered on non-hidden tokens that have a configured vision radius. Includes WarFog opacity control and map-token support so background maps do not act as vision sources.

**Arrow key nudge movement** - Nudge selected tokens one grid cell at a time with the arrow keys.

**Undo/redo for scene mutations** - DM-only undo and redo (Ctrl+Z / Ctrl+Shift+Z plus tool-tray buttons) for token-property and wall changes. Initiative, grid settings, sticky notes, music, and scene CRUD are not tracked by history.

---

## Installation

### Easy Install (no Python required)

Double-click `runEmbedded.bat`.

On first run it downloads a self-contained Python runtime (~30 MB), installs dependencies, and launches the server automatically. Nothing needs to be installed on your machine beforehand. Subsequent runs start instantly using the cached runtime.

> Internet access is required on the first run only.

### Virtual Environment (Python already installed)

**Requirements:** Python 3.8 or newer

On Windows, double-click `runVirtualEnv.bat` to create a slim runtime build, or run manually:

```sh
python -m venv .venv
# Windows:
.venv\Scripts\activate
# Linux / macOS:
source .venv/bin/activate

pip install -r requirements.txt
```

Then start the server:

```sh
python app.py
```

The server starts on port `3000` by default. Override with the `VTT_PORT` environment variable.

Default URLs:

- Player view: `http://localhost:3000`
- Player Files: `http://localhost:3000/player-files`
- DM view: `http://localhost:3000/dm`
- DM Admin/Files: `http://localhost:3000/dmadmin`

Default passwords:

- DM password: `DMCODE`
- Player password: `PLAY`

Passwords can be changed in the DM Admin area or by editing `data/private/secrets.txt`.

---

## Usage

### Quick Role Summary

**DMs can:**
- Create and manage scenes, tokens, maps, media, and music
- Control visibility, movement permissions, grid, snap view, and initiative
- Use paint, ruler, effects, dice, pings, fog of war, walls, and private sticky notes
- Organize uploads and change DM/player passwords from the media library

**Players can:**
- View the active scene, visible tokens, grid, music, initiative, and callouts
- Move allowed tokens, pan/zoom, ping the scene, and use ruler mode
- Roll dice, place private sticky notes, and use private local effects
- Collapse initiative and use the player help controls
- Browse and download files from the Player Files library (`/player-files`)

### DM View

Open `/dm` to manage scenes, tokens, music, initiative, dice, paint tools, area effects, sticky notes, grid controls, walls, fog of war, and player view syncing. Scenes are selected from the dropdown in the toolbar; pin frequently used scenes for quick access.

### Player View

Players open `/` and see the active scene, visible tokens, initiative callouts, dice rolls, music, pings, fog of war, and their own private sticky notes. A "Please Wait" screen is shown until the DM loads a scene.

### DM Admin

Open `/dmadmin` to upload and organize files and change passwords.

- Double-click an image or video to add it to the active scene.
- Shift-click any file to download it.
- PDFs and text documents display as icons.
- Use the Passwords tab to update DM/player passwords.

### Player Files

Open `/player-files` for the player-facing media library.

- Double-click any file to download it.
- Click **DM Mode** and enter the DM password to unlock upload, delete, and folder management.
- DM Mode stays active until you toggle it off or refresh the page.
- Shift-click a file card (in DM Mode) to delete it.

### Common DM Shortcuts

- `Delete` - Delete selected token
- `H` - Hide/show selected token from players
- `I` - Toggle whether players can move selected token
- `L` - Lock/unlock selected token (red outline, blocks movement and resize)
- `[` / `]` - Move selected token down/up in layer order
- `Ctrl+D` - Duplicate selected token
- `Ctrl+Click` - Add token to selection (group select)
- `Q` / `E` - Rotate selected token
- `Shift+Q` / `Shift+E` - Fine rotate selected token
- `T` - Toggle DM toolbar
- `Shift+D` - Delete current scene
- `Double-click` canvas or token - Ping location
- `Arrow keys` - Nudge selected token one grid cell
- `Ctrl+Z` / `Ctrl+Shift+Z` - Undo / redo token or wall changes

> Keyboard shortcuts are automatically disabled while typing in a sticky note.

### Sticky Notes

**DM notes** are accessible from the Notes button in the DM tool tray. They are pinned to world space (pan and zoom with the scene), persist to disk, and are never visible to players.

**Player notes** are accessible from the Notes button in the player toolbar. They are stored in browser localStorage and are completely private.

For both:
- Enable the tool, then double-click empty scene area to place a note
- Drag to reposition at any time
- Resize from the bottom-right corner handle
- Double-click note text to enter edit mode; click elsewhere to save
- `Escape` exits edit mode or closes the notes panel
- Choose a color (yellow, orange, cyan) from the Notes panel

---

## Project Structure

```txt
.
├── app.py
├── requirements.txt
├── data/
│   └── scenes/
├── public/
│   ├── css/
│   ├── js/
│   ├── lib/
│   │   └── dice-box-threejs/
│   ├── dm.html
│   ├── index.html
│   ├── files.html
│   ├── player-files.html
│   ├── DungeonSmith.png
│   ├── media/
│   ├── music/
│   └── uploads/
├── Run_DND_VTT.bat
├── runEmbedded.bat
├── runVirtualEnv.bat
├── run_dev.sh
└── data/private/secrets.txt
```

Runtime/user data folders are ignored by git:

- `public/media/`
- `public/music/`
- `public/uploads/`
- `data/scenes/`
- `data/private/`

---

## Built With

- Python 3
- Flask
- Flask-SocketIO
- Werkzeug
- Socket.IO (client)
- Interact.js
- Font Awesome
- Dice Box (Three.js renderer)

---

## Security Disclaimer

DungeonSmith VTT is intended for trusted local games and private networks.

It has not been security audited. File uploads, password handling, and WebSocket access are designed for convenience, not hardened public hosting. If you expose it to the internet, put it behind proper authentication, HTTPS/WSS, and a trusted reverse proxy.

Use at your own risk.

---

## License

DungeonSmith VTT is a fork of SceneSmith-VTT by [Echoshard](https://github.com/Echoshard), which is itself a fork of MiniVTT by [SamsterJam](https://github.com/SamsterJam).

- SceneSmith-VTT: https://github.com/Echoshard/SceneSmith-VTT
- MiniVTT: https://github.com/SamsterJam/MiniVTT

This project preserves the original GPL-3.0 license.
