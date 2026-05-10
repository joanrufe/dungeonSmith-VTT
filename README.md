# SceneSmith VTT

A heavily expanded fork of [MiniVTT](https://github.com/SamsterJam/MiniVTT) for running lightweight tabletop RPG sessions with a faster DM workflow, richer scene tools, and real-time player sync.

SceneSmith VTT keeps the original "everything is a token" simplicity while adding a larger DM toolset: media organization, paint tools, initiative announcements, 3D dice, ruler mode, player-facing sync, music controls, sticky notes, and quality-of-life updates for running sessions quickly.

Original project:  
https://github.com/SamsterJam/MiniVTT

This project remains licensed under GPL-3.0.

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

### Added In SceneSmith VTT

These are the major additions and expansions in this fork:

**Expanded DM toolbar and floating panels** - DM tools live in draggable panels with a right-side tray for Initiative, Paint, Effects, Dice, Music, and Notes.

**Media Library** - Organize reusable media in folders from `/files`. Upload images, videos, PDFs, and text documents. Images preview as thumbnails; videos/documents show file icons. Shift-click downloads files, and double-clicking images/videos adds them to the active scene.

**Main-area media drag upload** - Drop files directly into the media library grid area, not only the sidebar drop zone.

**Password management tab** - Change DM and player passwords from the Media Library password tab or by editing `data/private/secrets.txt`.

**Improved token controls** - Duplicate, rotate, fine-rotate, change layer order, multi-select, and improved token drag behavior.

**Grid upgrades** - Square/hex grid toggle, adjustable grid size, player grid sync, show/hide controls, and snap-to-grid.

**Ruler mode** - Toggleable ruler mode with a visible active indicator. It works over tokens without selecting or dragging them. Measures distance at 5 ft per grid cell.

**Paint system** - Paint terrain tiles directly onto the scene with adjustable brush size, custom colors, eraser, and layer controls.

**Initiative tracker** - Track turn order, edit names/values inline, advance rounds, and announce active turns with readable center-screen callouts visible to all players.

**3D dice roller** - Roll common dice or custom expressions with shared results, color themes, silent roll mode, callout results, and auto-clear. Available to both DM and players.

**Snap View** - DM can push their current camera position and zoom to connected players.

**Scene ping** - Double-click the scene to place a temporary blue ping indicator visible to all connected clients. Works on the background and on tokens.

**DM sticky notes** - Private draggable notes pinned to the scene in world space. Pan and zoom with the scene. Three color options (yellow, orange, cyan). Persistent across sessions. Only visible to the DM. Double-click to edit, drag to reposition, resize from the bottom-right corner. Keyboard shortcuts are disabled while typing in a note.

**Player sticky notes** - Players have their own private draggable notes that work the same way. Stored in browser localStorage; never sent to the server. Toggle from the player toolbar.

**Player-side controls** - Player help modal, collapsible initiative sidebar, ruler, dice panel, sticky notes panel, and independent pan/zoom behavior.

**Scene dropdown and pinned scenes** - Scenes are accessed through a dropdown menu rather than a horizontal scrollbar. Pin up to 5 frequently used scenes to the toolbar for one-click access. Pins are persisted in localStorage and can be toggled from inside the dropdown.

**Empty state screens** - When no scene is loaded the DM sees the SceneSmith logo and "Pick a Scene". Players see the logo and "Please Wait" until the DM loads a scene.

**Effects tool** - Spawn transparent area-effect overlays directly on the canvas as standard tokens. Choose from Square, Circle, Cone, or Line shapes. Twelve quick-select damage-type colors (Fire, Ice, Lightning, Acid, Poison, Thunder, Necrotic, Radiant, Force, Psychic, Fog, Darkness) plus a custom color picker. Size slider runs from 5 ft to 100 ft in 5 ft steps. Enable Breathing to animate the fill opacity in a slow pulse using SVG SMIL animation. Effects spawn centered on the viewport at a z-index above all other tokens and can be moved, scaled, and rotated like any token. Clicking an effect that sits over an interactive token selects the token beneath instead.

**Token lock** - Press `L` to lock a selected token. Locked tokens show a red outline, cannot be moved or resized by anyone, but remain selectable and deletable. Press `L` again to unlock. Lock state persists with the scene.

**Player Files** - A player-accessible media library at `/player-files`. Players can browse and double-click any file to download it. A **DM Mode** toggle (requires DM password) unlocks upload, file deletion, and folder creation — without needing the full DM view. DM password is validated once per session and stored only in memory.

---

## Installation

### Requirements

- Python 3.8 or newer

### Setup

Double-click `Run_DND_VTT.bat` — it creates a virtual environment and installs dependencies automatically on first run.

To install manually:

```sh
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
```

### Start

Double-click:

```bat
Run_DND_VTT.bat
```

Or run directly:

```sh
python app.py
```

The server starts on port `3000` by default.

Default URLs:

- Player view: `http://localhost:3000`
- Player Files: `http://localhost:3000/player-files`
- DM view: `http://localhost:3000/dm`
- Media library: `http://localhost:3000/files`

---

## Usage

### Quick Role Summary

**DMs can:**
- Create and manage scenes, tokens, maps, media, and music
- Control visibility, movement permissions, grid, snap view, and initiative
- Use paint, ruler, effects, dice, pings, and private sticky notes
- Organize uploads and change DM/player passwords from the media library

**Players can:**
- View the active scene, visible tokens, grid, music, initiative, and callouts
- Move allowed tokens, pan/zoom, ping the scene, and use ruler mode
- Roll dice, place private sticky notes, and use private local effects
- Collapse initiative and use the player help controls
- Browse and download files from the Player Files library (`/player-files`)

### DM View

Open `/dm` to manage scenes, tokens, music, initiative, dice, paint tools, area effects, sticky notes, grid controls, and player view syncing. Scenes are selected from the dropdown in the toolbar; pin frequently used scenes for quick access.

### Player View

Players open `/` and see the active scene, visible tokens, initiative callouts, dice rolls, music, pings, and their own private sticky notes. A "Please Wait" screen is shown until the DM loads a scene.

### Media Library

Open `/files` to upload and organize files.

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
│   ├── media/
│   ├── music/
│   └── uploads/
├── Run_DND_VTT.bat
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

SceneSmith VTT is intended for trusted local games and private networks.

It has not been security audited. File uploads, password handling, and WebSocket access are designed for convenience, not hardened public hosting. If you expose it to the internet, put it behind proper authentication, HTTPS/WSS, and a trusted reverse proxy.

Use at your own risk.

---

## License

SceneSmith VTT is a fork of MiniVTT by SamsterJam:

https://github.com/SamsterJam/MiniVTT

This project remains licensed under GPL-3.0.
