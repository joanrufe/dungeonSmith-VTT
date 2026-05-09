# SceneSmith VTT

A heavily expanded fork of [MiniVTT](https://github.com/SamsterJam/MiniVTT) for running lightweight tabletop RPG sessions with a faster DM workflow, richer scene tools, and real-time player sync.

SceneSmith VTT keeps the original "everything is a token" simplicity while adding a larger DM toolset: media organization, paint tools, initiative announcements, 3D dice, ruler mode, player-facing sync, music controls, and quality-of-life updates for running sessions quickly.

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

**Expanded DM toolbar and floating panels** - DM tools live in draggable panels with a right-side tray for Initiative, Paint, Dice, and Music.

**Media Library** - Organize reusable media in folders from `/files`. Upload images, videos, PDFs, and text documents. Images preview as thumbnails; videos/documents show file icons. Shift-click downloads files, and double-clicking images/videos adds them to the active scene.

**Main-area media drag upload** - Drop files directly into the media library grid area, not only the sidebar drop zone.

**Password management tab** - Change DM and player passwords from the Media Library password tab or by editing `secret.txt`.

**Improved token controls** - Duplicate, rotate, fine-rotate, change layer order, multi-select, and improved token drag behavior.

**Grid upgrades** - Square/hex grid toggle, adjustable grid size, player grid sync, show/hide controls, and snap-to-grid.

**Cached grid rendering** - Square and hex grid drawing uses cached pattern tiles for faster redraws.

**Ruler mode** - Toggleable ruler mode with a visible active indicator. It works over tokens without selecting or dragging them.

**Paint system** - Paint terrain tiles directly onto the scene with adjustable brush size, custom colors, eraser, and layer controls.

**Initiative tracker** - Track turn order, edit names/values inline, advance rounds, and announce active turns with readable center-screen callouts.

**3D dice roller** - Roll common dice or custom expressions with shared results, color themes, silent roll mode, callout results, and auto-clear.

**Snap View** - DM can push their current camera position and zoom to connected players.

**Player-side controls** - Player help modal, initiative sidebar, ruler, dice panel, and independent pan/zoom behavior.

**Build and run scripts** - Windows batch files for validation/setup and starting the server.

**Git hygiene for local data** - Runtime media, uploads, music, scene data, secrets, and local tooling folders are ignored.

---

## Installation

### Requirements

- Node.js
- npm

### Setup

```sh
npm install
```

Or run:

```bat
Build_DND_VTT.bat
```

The build script validates the JavaScript and installs dependencies if needed. It does not copy or package your media folders.

### Start

```sh
npm start
```

Or double-click:

```bat
Run_DND_VTT.bat
```

Default URLs:

- Player view: `http://localhost:3000`
- DM view: `http://localhost:3000/dm`
- Media library: `http://localhost:3000/files`

---

## Usage

### DM View

Open `/dm` to manage scenes, tokens, music, initiative, dice, paint tools, grid controls, and player view syncing.

### Player View

Players open `/` and see the active scene, visible tokens, initiative callouts, dice rolls, music, and pings.

### Media Library

Open `/files` to upload and organize files.

- Double-click an image or video to add it to the active scene.
- Shift-click any file to download it.
- PDFs and text documents display as icons.
- Use the Passwords tab to update DM/player passwords.

### Common DM Shortcuts

- `Delete` - Delete selected token
- `H` - Hide/show selected token from players
- `I` - Toggle whether players can move selected token
- `[` / `]` - Move selected token down/up in layer order
- `Ctrl+D` - Duplicate selected token
- `Q` / `E` - Rotate selected token
- `Shift+Q` / `Shift+E` - Fine rotate selected token
- `T` - Toggle DM toolbar
- `Shift+D` - Delete current scene
- `Double-click` canvas - Ping location

---

## Project Structure

```txt
.
├── app.js
├── server.js
├── routes.js
├── socketHandler.js
├── controllers/
├── middlewares/
├── models/
├── data/
│   └── scenes/
├── public/
│   ├── css/
│   ├── js/
│   ├── dm.html
│   ├── index.html
│   ├── files.html
│   ├── media/
│   ├── music/
│   └── uploads/
├── Build_DND_VTT.bat
├── Run_DND_VTT.bat
└── secret.txt
```

Runtime/user data folders are ignored by git:

- `public/media/`
- `public/music/`
- `public/uploads/`
- `data/scenes/`
- `secret.txt`

---

## Built With

- Node.js
- Express
- Socket.IO
- Interact.js
- SortableJS
- Multer
- Font Awesome
- 3D Dice / Dice Box

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
