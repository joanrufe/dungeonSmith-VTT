# AGENTS.md

Guidance for AI agents (OpenCode/otherwise) working in DungeonSmith-VTT, a fork of
SamsterJam's MiniVTT. D&D virtual tabletop for trusted local/LAN games.

## The one thing you must know first

**The live server is `app.py` only.** Flask + Flask-SocketIO, single ~950-line file,
port 3000. Everything else Node-shaped in this repo is **dead reference code**.

- `app.py` — the only entrypoint. Run it.
- `server.js`, `app.js`, `routes.js`, `socketHandler.js`, `controllers/`,
  `middlewares/`, `models/` — the **deprecated Express backend** kept as reference.
  Editing these has **zero runtime effect**. Do not reach for them to fix a route,
  socket event, or model. `app.py` reimplements all of it inline.
- This is a Node→Python migration (now complete) that left the Node files in tree
  as reference. The migration plan that produced `app.py` has been removed; the
  surviving constraints from it are documented in "Frontend parity constraints"
  below.

## Run

```sh
python -m venv .venv && .venv/bin/activate  # Windows: .venv\Scripts\activate
pip install -r requirements.txt
python app.py
```

- Port: `3000` default. Override with env `VTT_PORT`.
- Files auto-created at startup (no manual setup): `data/private/secrets.txt`,
  `data/scenes/`, `data/sticky-notes.json`, `public/{uploads,media,music,player-media}`.
- `SESSION_SECRET` env is optional (random per restart if unset → sessions don't
  survive restart).
- Windows launchers (developer-facing, not needed on Linux):
  `Run_DND_VTT.bat` (everyday), `runEmbedded.bat` (no-Python, embeddable 3.12.10),
  `runVirtualEnv.bat` (**build**, not run — produces `dist/DungeonSmithVTT/`). All
  three just launch `app.py` after setting up `.venv`.

## Stack / env

- **Python 3.8+** (embedded launcher pins 3.12.10). `requirements.txt`:
  `Flask>=3,<4`, `Flask-SocketIO>=5.3,<6`, `python-socketio>=5.11,<6`,
  `Werkzeug>=3,<4`.
- `async_mode="threading"` (`app.py:245`). **Eventlet was proposed during the
  Node→Python migration but deliberately NOT adopted.** Do not add it "to fix
  WebSockets".
- No `package.json`. The Node files need npm deps (`express`, `socket.io`, `multer`,
  `express-session`) that are NOT declared — confirming the Node stack is not
  runnable. Don't try.
- Frontend is framework-less vanilla JS/HTML/CSS in `public/`, served statically by
  Flask (`static_url_path=""`). Pages: `/`, `/player-files`, `/dm`, `/dmadmin`,
  `/dm-login`, `/player-login`. Vendored libs in `public/lib/` (incl. 3D dice:
  `public/lib/dice-box-threejs/`, and a vendored `socket.io.min.js`).

## Defaults an agent gets wrong

- **DM password default is `DMCODE`** (Python `app.py:28`). The `CODE` value in
  `server.js`/`routes.js` is **stale Node-only**. Player default: `PLAY`.
- Passwords are **plaintext by design** — the UI intentionally reveals them. Do not
  "fix" this into hashing without asking.
- `runEmbedded.bat`'s `PORT` var is **cosmetic** — it doesn't set `VTT_PORT`, so it
  only affects printed/URL-open lines, not the bind. Default case is fine.

## Frontend parity constraints

Surviving constraints from the (now-removed) Node→Python migration plan. Honor
these when touching `app.py` backend behavior:
- **Match current HTTP response shapes exactly** so `public/js/*` doesn't need
  changes.
- **Preserve Socket.IO event payload shapes**.
- **Keep `public/js` mostly unchanged** unless fixing a specific parity bug. Don't
  rewrite the frontend.
- A split into `controllers/*.py`, `services/`, `socket_events.py`, `config.py` was
  once proposed but **never done.** `app.py` stayed monolithic. Don't assume the
  `controllers/` dir is Python; it's JS.

## Data

- `data/scenes/{sceneId}.json` — live scenes, schema
  `{sceneId, sceneName, order, tokens:[...]}`. Dir is versioned (`.gitkeep` + negated
  ignore), contents are gitignored runtime state.
- `data/private/secrets.txt` — `DM_PASSWORD=` / `PLAYER_PASSWORD=` lines, gitignored,
  auto-created. Legacy `secret.txt` is auto-migrated to here.
- `data/scenea.json` — **legacy MiniVTT format** (not the current `SceneStore`
  schema), a leftover seed, **not loaded** by `app.py` (which globs
  `data/scenes/*.json`). Don't treat it as a live scene.

## Tests / lint / CI

**None exist.** No `tests/`, no pytest/unittest, no `pyproject.toml`/`.flake8`/
`ruff`/`mypy`, no `.github/`, no pre-commit, no `package.json` scripts. The only
quality gate is `python -m py_compile app.py` inside `runVirtualEnv.bat`. Don't
assume config exists for `pytest`/`ruff`; don't expect CI to gate anything.

## Known tech debt (from AIOptimizations.md, NOT yet applied)

`AIOptimizations.md` is a client-side perf notes about `public/js/*`:
- sticky-notes `rafSync` runs `querySelector` per note per frame at 60fps; RAF loop
  runs even with zero notes.
- grid canvases are 6000×6000 (~144MB GPU); suggested ~3000×2000.
- dead import `extractDominantColor` in `sceneManager.js`; `utils.js` unused.
- duplicate `buildSVG()` across two files — candidate shared `effectsUtils.js`.
Treat as a known map, not a spec to execute blindly.

## Other docs

- `README.md` — authoritative user docs (run cmd, default passwords, DM keyboard
  shortcuts, gitignored runtime folders). DM shortcuts: `Delete`, `H` hide, `I`
  movable, `L` lock, `[`/`]` layer, `Ctrl+D` dup, `Ctrl+Click` group, `Q`/`E` rotate,
  `Shift+Q`/`Shift+E` fine rotate, `T` toolbar, `Shift+D` delete scene, dbl-click ping.
  Shortcuts disable while editing a sticky note. DM notes persist server-side to
  `data/sticky-notes.json`; player notes live in browser `localStorage` only.
- `Plan.md` — original pre-Node vision, **partially outdated**; don't treat as
  current spec.
- Security stance: intended for trusted local games, **not security audited**
  (`README.md:243-249`).

## Repo conventions

- Conventional-ish commit messages, no enforcement tooling.
- `.atl/` is OpenCode skill-registry tooling state, **not app code** — ignore for
  app work.
- `.gitignore` keeps runtime dirs versioned via `.gitkeep` + negated ignores
  (`data/scenes/`, `public/{uploads,music,media,player-media}/`). Follow that
  pattern if you add a runtime dir.
- Fork of MiniVTT, GPL-3.0 (`LICENSE`).