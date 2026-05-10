import json
import mimetypes
import os
import random
import re
import shutil
import time
from pathlib import Path

from flask import Flask, jsonify, redirect, request, send_from_directory, session
from flask_socketio import SocketIO, emit, join_room
from werkzeug.utils import secure_filename


BASE_DIR = Path(__file__).resolve().parent
PUBLIC_DIR = BASE_DIR / "public"
DATA_DIR = BASE_DIR / "data"
SCENES_DIR = DATA_DIR / "scenes"
SECRET_DIR = DATA_DIR / "private"
SECRET_FILE = SECRET_DIR / "secrets.txt"
LEGACY_SECRET_FILE = BASE_DIR / "secret.txt"
UPLOADS_DIR = PUBLIC_DIR / "uploads"
MEDIA_DIR = PUBLIC_DIR / "media"
PLAYER_MEDIA_DIR = PUBLIC_DIR / "player-media"
MUSIC_DIR = PUBLIC_DIR / "music"
NOTES_FILE = DATA_DIR / "sticky-notes.json"

DEFAULT_SECRETS = {
    "DM_PASSWORD": "CODE",
    "PLAYER_PASSWORD": "PLAY",
}

IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg"}
VIDEO_EXTS = {".mp4", ".webm", ".ogv", ".mov"}
PDF_EXTS = {".pdf"}
TEXT_EXTS = {".txt", ".md", ".json", ".csv", ".log"}
DOC_EXTS = PDF_EXTS | TEXT_EXTS
MEDIA_EXTS = IMAGE_EXTS | VIDEO_EXTS | DOC_EXTS
MUSIC_EXTS = {".mp3", ".wav", ".ogg", ".m4a", ".flac"}


def now_ms():
    return str(int(time.time() * 1000))


def parse_secrets(raw):
    trimmed = raw.strip()
    if "=" not in trimmed:
        secrets = dict(DEFAULT_SECRETS)
        secrets["DM_PASSWORD"] = trimmed or DEFAULT_SECRETS["DM_PASSWORD"]
        return secrets

    secrets = dict(DEFAULT_SECRETS)
    for line in raw.splitlines():
        clean = line.strip()
        if not clean or clean.startswith("#") or "=" not in clean:
            continue
        key, value = clean.split("=", 1)
        key = key.strip()
        if key:
            secrets[key] = value.strip()
    return secrets


def format_secrets(secrets):
    return "\n".join([
        "# Passwords can be edited here or from the Media Library password tab.",
        "# These values stay server-side and are never sent to browser JavaScript.",
        f"DM_PASSWORD={secrets.get('DM_PASSWORD') or DEFAULT_SECRETS['DM_PASSWORD']}",
        f"PLAYER_PASSWORD={secrets.get('PLAYER_PASSWORD') or DEFAULT_SECRETS['PLAYER_PASSWORD']}",
        "",
    ])


def ensure_secret_storage():
    SECRET_DIR.mkdir(parents=True, exist_ok=True)
    if not SECRET_FILE.exists() and LEGACY_SECRET_FILE.exists():
        try:
            LEGACY_SECRET_FILE.replace(SECRET_FILE)
        except OSError:
            shutil.copyfile(LEGACY_SECRET_FILE, SECRET_FILE)
            LEGACY_SECRET_FILE.unlink(missing_ok=True)


def read_secrets():
    ensure_secret_storage()
    try:
        return parse_secrets(SECRET_FILE.read_text(encoding="utf-8"))
    except OSError:
        secrets = dict(DEFAULT_SECRETS)
        SECRET_FILE.write_text(format_secrets(secrets), encoding="utf-8")
        return secrets


def safe_folder_name(value):
    return re.sub(r"[^a-zA-Z0-9_\- ]", "", value or "").strip()


def safe_relative_media_path(url):
    rel = re.sub(r"^/media/", "", url or "")
    if not rel or ".." in rel or rel.startswith(("/", "\\")):
        return None
    return rel


def safe_relative_player_media_path(url):
    rel = re.sub(r"^/player-media/", "", url or "")
    if not rel or ".." in rel or rel.startswith(("/", "\\")):
        return None
    return rel


def get_media_type(name):
    ext = Path(name).suffix.lower()
    if ext in IMAGE_EXTS:
        return "image"
    if ext in VIDEO_EXTS:
        return "video"
    if ext in PDF_EXTS:
        return "pdf"
    if ext in TEXT_EXTS:
        return "text"
    return None


class SceneStore:
    def __init__(self):
        self.active_scene_id = None
        self.scenes = {}
        SCENES_DIR.mkdir(parents=True, exist_ok=True)

    def path_for(self, scene_id):
        return SCENES_DIR / f"{scene_id}.json"

    def add_scene(self, scene):
        self.scenes[scene["sceneId"]] = scene

    def load_scene(self, scene_id):
        if scene_id in self.scenes:
            return self.scenes[scene_id]
        path = self.path_for(scene_id)
        scene = json.loads(path.read_text(encoding="utf-8"))
        self.scenes[scene_id] = scene
        return scene

    def save_scene(self, scene):
        SCENES_DIR.mkdir(parents=True, exist_ok=True)
        self.path_for(scene["sceneId"]).write_text(json.dumps(scene, indent=2), encoding="utf-8")

    def get_all_scenes(self):
        scenes = []
        for path in SCENES_DIR.glob("*.json"):
            try:
                scene = json.loads(path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                continue
            scenes.append({
                "sceneId": scene.get("sceneId"),
                "sceneName": scene.get("sceneName"),
                "order": scene.get("order", 0),
            })
        scenes.sort(key=lambda item: item.get("order", 0))
        return scenes

    def update_scene(self, scene):
        self.scenes[scene["sceneId"]] = scene
        self.save_scene(scene)

    def change_active_scene(self, scene_id):
        self.active_scene_id = scene_id

    def delete_scene(self, scene_id):
        scene = self.scenes.get(scene_id) or self.load_scene(scene_id)
        self.path_for(scene_id).unlink(missing_ok=True)
        self.scenes.pop(scene_id, None)
        for token in scene.get("tokens", []):
            image_url = token.get("imageUrl")
            self.delete_upload_if_unused(image_url)

    def update_scene_order(self, scene_order):
        for index, scene_id in enumerate(scene_order):
            scene = self.load_scene(scene_id)
            scene["order"] = index
            self.save_scene(scene)

    def is_image_used_elsewhere(self, image_url):
        if not image_url:
            return False
        for path in SCENES_DIR.glob("*.json"):
            try:
                scene = json.loads(path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                continue
            for token in scene.get("tokens", []):
                if token.get("imageUrl") == image_url:
                    return True
        return False

    def delete_upload_if_unused(self, image_url):
        if not image_url or image_url.startswith("data:") or image_url.startswith("/media/"):
            return
        if self.is_image_used_elsewhere(image_url):
            return
        rel = image_url.lstrip("/")
        path = PUBLIC_DIR / rel
        try:
            path.unlink()
        except OSError:
            pass

    def update_token(self, scene_id, token_id, properties):
        scene = self.scenes.get(scene_id) or self.load_scene(scene_id)
        for token in scene.get("tokens", []):
            if token.get("tokenId") == token_id:
                was_hidden = bool(token.get("hidden"))
                token.update(properties or {})
                self.save_scene(scene)
                return token, was_hidden, bool(token.get("hidden"))
        return None, False, False

    def add_token(self, scene_id, token):
        scene = self.scenes.get(scene_id) or self.load_scene(scene_id)
        scene.setdefault("tokens", []).append(token)
        self.save_scene(scene)

    def remove_token(self, scene_id, token_id):
        scene = self.scenes.get(scene_id) or self.load_scene(scene_id)
        tokens = scene.setdefault("tokens", [])
        for index, token in enumerate(tokens):
            if token.get("tokenId") == token_id:
                removed = tokens.pop(index)
                self.save_scene(scene)
                self.delete_upload_if_unused(removed.get("imageUrl"))
                return removed
        return None


scene_store = SceneStore()
secrets = read_secrets()

app = Flask(__name__, static_folder=str(PUBLIC_DIR), static_url_path="")
app.secret_key = os.environ.get("SESSION_SECRET") or os.urandom(32)
app.config["DM_PASSWORD"] = secrets.get("DM_PASSWORD") or DEFAULT_SECRETS["DM_PASSWORD"]
app.config["PLAYER_PASSWORD"] = secrets.get("PLAYER_PASSWORD") or DEFAULT_SECRETS["PLAYER_PASSWORD"]
socketio = SocketIO(app, async_mode="threading", cors_allowed_origins="*")

bg_color = None
grid_state = None
initiative_state = None


def require_dm():
    return bool(session.get("isDM"))


def require_player():
    return bool(session.get("isPlayer") or session.get("isDM"))


def json_body():
    return request.get_json(silent=True) or request.form.to_dict() or {}


@app.before_request
def redirect_static_html_names():
    if request.path == "/index.html":
        return redirect("/")
    if request.path == "/dm.html":
        return redirect("/dm")
    if request.path == "/files.html":
        return redirect("/files")
    if request.path == "/player-files.html":
        return redirect("/player-files")
    return None


@app.after_request
def cache_headers(response):
    if request.path.lower().endswith((".html", ".css", ".js")):
        response.headers["Cache-Control"] = "no-store"
    return response


@app.get("/")
def player_index():
    if not require_player():
        return redirect("/player-login")
    return send_from_directory(PUBLIC_DIR, "index.html")


@app.get("/player-login")
def player_login_page():
    return send_from_directory(PUBLIC_DIR, "player-login.html")


@app.post("/player-login")
def player_login():
    password = request.form.get("password") or json_body().get("password")
    if password == app.config["PLAYER_PASSWORD"]:
        session["isPlayer"] = True
        return redirect("/")
    return 'Incorrect password. <a href="/player-login">Try again</a>'


@app.get("/dm-login")
def dm_login_page():
    return send_from_directory(PUBLIC_DIR, "dm-login.html")


@app.post("/dm-login")
def dm_login():
    password = request.form.get("password") or json_body().get("password")
    if password == app.config["DM_PASSWORD"]:
        session["isDM"] = True
        return redirect("/dm")
    return 'Incorrect password. <a href="/dm-login">Try again</a>'


@app.get("/dm")
def dm_page():
    if not require_dm():
        return redirect("/dm-login")
    return send_from_directory(PUBLIC_DIR, "dm.html")


@app.get("/files")
def files_page():
    if not require_dm():
        return redirect("/dm-login")
    return send_from_directory(PUBLIC_DIR, "files.html")


@app.get("/player-files")
def player_files_page():
    if not require_player():
        return redirect("/player-login")
    return send_from_directory(PUBLIC_DIR, "player-files.html")


@app.post("/createScene")
def create_scene():
    if not require_dm():
        return redirect("/dm-login")
    data = json_body()
    scene_id = now_ms()
    scene = {"sceneId": scene_id, "sceneName": data.get("sceneName"), "tokens": []}
    scene_store.save_scene(scene)
    scene_store.add_scene(scene)
    return jsonify({"sceneId": scene_id})


@app.get("/scenes")
def get_scenes():
    return jsonify({"scenes": scene_store.get_all_scenes()})


@app.post("/updateScene")
def update_scene():
    if not require_dm():
        return redirect("/dm-login")
    try:
        scene_store.update_scene(json_body().get("scene"))
        return jsonify({"message": "Scene updated."})
    except Exception:
        return "Error updating scene.", 500


@app.post("/deleteScene")
def delete_scene():
    if not require_dm():
        return redirect("/dm-login")
    try:
        scene_id = json_body().get("sceneId")
        scene_store.delete_scene(scene_id)
        socketio.emit("sceneDeleted", {"sceneId": scene_id})
        return jsonify({"success": True})
    except Exception:
        return jsonify({"success": False, "message": "Error deleting scene."}), 500


@app.post("/duplicateScene")
def duplicate_scene():
    if not require_dm():
        return redirect("/dm-login")
    data = json_body()
    try:
        source = scene_store.load_scene(data.get("sceneId"))
        new_scene = json.loads(json.dumps(source))
        new_scene_id = now_ms()
        new_scene["sceneId"] = new_scene_id
        new_scene["sceneName"] = data.get("sceneName") or f"Copy of {source.get('sceneName')}"
        scene_store.save_scene(new_scene)
        scene_store.add_scene(new_scene)
        return jsonify({"sceneId": new_scene_id})
    except Exception:
        return jsonify({"error": "Error duplicating scene."}), 500


@app.post("/updateSceneOrder")
def update_scene_order():
    if not require_dm():
        return redirect("/dm-login")
    try:
        scene_store.update_scene_order(json_body().get("sceneOrder") or [])
        return jsonify({"success": True})
    except Exception:
        return jsonify({"success": False, "message": "Failed to update scene order"})


@app.post("/upload")
def upload_file():
    if not require_dm():
        return redirect("/dm-login")
    file = request.files.get("file")
    if not file:
        return "No file uploaded.", 400
    mime_type = file.mimetype or mimetypes.guess_type(file.filename)[0] or ""
    if mime_type.startswith("video/"):
        media_type = "video"
    elif mime_type.startswith("image/"):
        media_type = "image"
    else:
        return "Unsupported file type.", 400
    UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
    filename = f"{now_ms()}-{secure_filename(file.filename)}"
    file.save(UPLOADS_DIR / filename)
    return jsonify({"imageUrl": f"/uploads/{filename}", "mediaType": media_type})


@app.post("/uploadMusic")
def upload_music():
    if not require_dm():
        return redirect("/dm-login")
    file = request.files.get("music")
    if not file:
        return jsonify({"success": False, "message": "No music file uploaded."}), 400
    mime_type = file.mimetype or ""
    if not mime_type.startswith("audio/"):
        return jsonify({"success": False, "message": "Unsupported file type"}), 400
    MUSIC_DIR.mkdir(parents=True, exist_ok=True)
    filename = f"{now_ms()}-{secure_filename(file.filename)}"
    file.save(MUSIC_DIR / filename)
    return jsonify({"success": True, "musicUrl": f"/music/{filename}", "filename": filename})


@app.get("/musicList")
def music_list():
    MUSIC_DIR.mkdir(parents=True, exist_ok=True)
    tracks = []
    for path in MUSIC_DIR.iterdir():
        if path.is_file() and path.suffix.lower() in MUSIC_EXTS:
            tracks.append({
                "name": re.sub(r"^\d+\s*[-_]?\s*", "", path.name),
                "filename": path.name,
                "url": f"/music/{path.name}",
            })
    return jsonify({"success": True, "musicTracks": tracks})


@app.post("/deleteMusic")
def delete_music():
    if not require_dm():
        return redirect("/dm-login")
    filename = Path(json_body().get("filename") or "").name
    if not filename:
        return jsonify({"success": False, "message": "No filename provided."}), 400
    path = MUSIC_DIR / filename
    if not path.exists():
        return jsonify({"success": False, "message": "File not found."}), 404
    path.unlink()
    return jsonify({"success": True})


@app.get("/mediaList")
def media_list():
    if not require_player():
        return redirect("/player-login")
    MEDIA_DIR.mkdir(parents=True, exist_ok=True)
    folders = []
    root_files = []
    for entry in MEDIA_DIR.iterdir():
        if entry.name.startswith("."):
            continue
        if entry.is_dir():
            files = []
            for sub in entry.iterdir():
                media_type = get_media_type(sub.name)
                if sub.is_file() and not sub.name.startswith(".") and media_type:
                    files.append({"name": sub.name, "url": f"/media/{entry.name}/{sub.name}", "mediaType": media_type})
            folders.append({"name": entry.name, "files": files})
        elif entry.is_file():
            media_type = get_media_type(entry.name)
            if media_type:
                root_files.append({"name": entry.name, "url": f"/media/{entry.name}", "mediaType": media_type})
    return jsonify({"folders": folders, "rootFiles": root_files})


@app.post("/mediaFolder")
def media_folder_create():
    if not require_dm():
        return redirect("/dm-login")
    name = safe_folder_name(json_body().get("name"))
    if not name:
        return jsonify({"error": "Invalid folder name"}), 400
    (MEDIA_DIR / name).mkdir(parents=True, exist_ok=True)
    return jsonify({"ok": True})


@app.post("/mediaUpload")
def media_upload():
    if not require_dm():
        return redirect("/dm-login")
    folder = safe_folder_name(request.args.get("folder"))
    dest = MEDIA_DIR / folder if folder else MEDIA_DIR
    dest.mkdir(parents=True, exist_ok=True)
    files = request.files.getlist("files")
    for file in files:
        ext = Path(file.filename).suffix.lower()
        mime_type = file.mimetype or ""
        allowed = (
            mime_type.startswith("image/")
            or mime_type.startswith("video/")
            or mime_type == "application/pdf"
            or mime_type.startswith("text/")
            or ext in MEDIA_EXTS
        )
        if allowed:
            file.save(dest / secure_filename(file.filename))
    return jsonify({"ok": True, "count": len(files)})


@app.get("/playerMediaList")
def player_media_list():
    if not require_player():
        return redirect("/player-login")
    PLAYER_MEDIA_DIR.mkdir(parents=True, exist_ok=True)
    folders = []
    root_files = []
    for entry in PLAYER_MEDIA_DIR.iterdir():
        if entry.name.startswith("."):
            continue
        if entry.is_dir():
            files = []
            for sub in entry.iterdir():
                media_type = get_media_type(sub.name)
                if sub.is_file() and not sub.name.startswith(".") and media_type:
                    files.append({"name": sub.name, "url": f"/player-media/{entry.name}/{sub.name}", "mediaType": media_type})
            folders.append({"name": entry.name, "files": files})
        elif entry.is_file():
            media_type = get_media_type(entry.name)
            if media_type:
                root_files.append({"name": entry.name, "url": f"/player-media/{entry.name}", "mediaType": media_type})
    return jsonify({"folders": folders, "rootFiles": root_files})


@app.post("/playerMediaUpload")
def player_media_upload():
    if not require_player():
        return redirect("/player-login")
    provided = request.headers.get("X-DM-Password") or ""
    if provided != app.config["DM_PASSWORD"]:
        return jsonify({"error": "Invalid DM password."}), 403
    folder = safe_folder_name(request.args.get("folder"))
    dest = PLAYER_MEDIA_DIR / folder if folder else PLAYER_MEDIA_DIR
    dest.mkdir(parents=True, exist_ok=True)
    files = request.files.getlist("files")
    for file in files:
        ext = Path(file.filename).suffix.lower()
        mime_type = file.mimetype or ""
        allowed = (
            mime_type.startswith("image/")
            or mime_type.startswith("video/")
            or mime_type == "application/pdf"
            or mime_type.startswith("text/")
            or ext in MEDIA_EXTS
        )
        if allowed:
            file.save(dest / secure_filename(file.filename))
    return jsonify({"ok": True, "count": len(files)})


@app.post("/playerMediaFolder")
def player_media_folder_create():
    if not require_player():
        return redirect("/player-login")
    provided = request.headers.get("X-DM-Password") or ""
    if provided != app.config["DM_PASSWORD"]:
        return jsonify({"error": "Invalid DM password."}), 403
    name = safe_folder_name(json_body().get("name"))
    if not name:
        return jsonify({"error": "Invalid folder name"}), 400
    (PLAYER_MEDIA_DIR / name).mkdir(parents=True, exist_ok=True)
    return jsonify({"ok": True})


@app.delete("/playerMediaFolder")
def player_media_folder_delete():
    if not require_player():
        return redirect("/player-login")
    provided = request.headers.get("X-DM-Password") or ""
    if provided != app.config["DM_PASSWORD"]:
        return jsonify({"error": "Invalid DM password."}), 403
    name = safe_folder_name(json_body().get("name"))
    if not name:
        return jsonify({"error": "Invalid folder name"}), 400
    shutil.rmtree(PLAYER_MEDIA_DIR / name, ignore_errors=True)
    return jsonify({"ok": True})


@app.delete("/playerMediaFile")
def player_media_file_delete():
    if not require_player():
        return redirect("/player-login")
    provided = request.headers.get("X-DM-Password") or ""
    if provided != app.config["DM_PASSWORD"]:
        return jsonify({"error": "Invalid DM password."}), 403
    rel = safe_relative_player_media_path(json_body().get("url"))
    if not rel:
        return jsonify({"error": "Bad path"}), 400
    try:
        (PLAYER_MEDIA_DIR / rel).unlink()
    except OSError:
        return jsonify({"error": "File not found."}), 404
    return jsonify({"ok": True})


@app.delete("/mediaFolder")
def media_folder_delete():
    if not require_dm():
        return redirect("/dm-login")
    name = safe_folder_name(json_body().get("name"))
    if not name:
        return jsonify({"error": "Invalid folder name"}), 400
    shutil.rmtree(MEDIA_DIR / name, ignore_errors=True)
    return jsonify({"ok": True})


@app.patch("/mediaFolder")
def media_folder_rename():
    if not require_dm():
        return redirect("/dm-login")
    data = json_body()
    old_name = safe_folder_name(data.get("oldName"))
    new_name = safe_folder_name(data.get("newName"))
    if not old_name or not new_name:
        return jsonify({"error": "Invalid folder name"}), 400
    (MEDIA_DIR / old_name).rename(MEDIA_DIR / new_name)
    return jsonify({"ok": True})


@app.delete("/mediaFile")
def media_file_delete():
    if not require_dm():
        return redirect("/dm-login")
    rel = safe_relative_media_path(json_body().get("url"))
    if not rel:
        return jsonify({"error": "Bad path"}), 400
    (MEDIA_DIR / rel).unlink()
    return jsonify({"ok": True})


@app.get("/passwords")
def passwords_get():
    if not require_dm():
        return redirect("/dm-login")
    current = read_secrets()
    return jsonify({
        "dmPassword": current.get("DM_PASSWORD") or DEFAULT_SECRETS["DM_PASSWORD"],
        "playerPassword": current.get("PLAYER_PASSWORD") or DEFAULT_SECRETS["PLAYER_PASSWORD"],
    })


@app.put("/passwords")
def passwords_put():
    if not require_dm():
        return redirect("/dm-login")
    data = json_body()
    dm_password = str(data.get("dmPassword") or "").strip()
    player_password = str(data.get("playerPassword") or "").strip()
    if not dm_password or not player_password:
        return jsonify({"error": "Both passwords are required."}), 400
    updated = {"DM_PASSWORD": dm_password, "PLAYER_PASSWORD": player_password}
    ensure_secret_storage()
    SECRET_FILE.write_text(format_secrets(updated), encoding="utf-8")
    app.config["DM_PASSWORD"] = dm_password
    app.config["PLAYER_PASSWORD"] = player_password
    return jsonify({"ok": True})


@app.get("/sticky-notes")
def sticky_notes_get():
    if not require_dm():
        return redirect("/dm-login")
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    if not NOTES_FILE.exists():
        NOTES_FILE.write_text("[]", encoding="utf-8")
    return jsonify(json.loads(NOTES_FILE.read_text(encoding="utf-8")))


@app.post("/sticky-notes")
def sticky_notes_post():
    if not require_dm():
        return redirect("/dm-login")
    notes = request.get_json(silent=True)
    if not isinstance(notes, list):
        return jsonify({"error": "Expected array"}), 400
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    NOTES_FILE.write_text(json.dumps(notes), encoding="utf-8")
    return jsonify({"ok": True})


def server_roll(raw_notation):
    if not isinstance(raw_notation, str):
        return {"notation": "1d6", "text": "?", "color": "#4CAF50"}
    clean = raw_notation.strip()
    match = re.match(r"^(\d+)d(\d+)([+-]\d+)?$", clean, re.I)
    if not match:
        return {"notation": clean, "text": clean, "color": "#4CAF50"}
    qty = min(int(match.group(1)), 20)
    sides = int(match.group(2))
    modifier = int(match.group(3) or 0)
    rolls = [random.randint(1, sides) for _ in range(qty)]
    total = sum(rolls) + modifier
    mod_str = f"+{modifier}" if modifier > 0 else str(modifier) if modifier < 0 else ""
    return {
        "notation": f"{qty}d{sides}@{','.join(str(r) for r in rolls)}",
        "text": f"{qty}d{sides}{mod_str} = {total}",
        "color": "#4CAF50",
    }


def is_dm_socket():
    return getattr(request, "sid", None) and socket_roles.get(request.sid) == "dm"


socket_roles = {}


@socketio.on("connect")
def socket_connect():
    role = request.args.get("role") or "player"
    socket_roles[request.sid] = role
    join_room(role)
    emit("activeSceneId", scene_store.active_scene_id)
    if bg_color:
        emit("setBgColor", {"color": bg_color})
    if grid_state is not None:
        emit("toggleGrid", grid_state)
    if initiative_state:
        emit("updateInitiative", initiative_state)


@socketio.on("disconnect")
def socket_disconnect():
    socket_roles.pop(request.sid, None)


@socketio.on("loadScene")
def socket_load_scene(data):
    try:
        scene = scene_store.load_scene((data or {}).get("sceneId"))
        if socket_roles.get(request.sid) == "player":
            filtered = dict(scene)
            filtered["tokens"] = [token for token in scene.get("tokens", []) if not token.get("hidden")]
            emit("sceneData", filtered)
        else:
            emit("sceneData", scene)
    except Exception:
        emit("error", {"message": "Failed to load scene."})


@socketio.on("changeScene")
def socket_change_scene(data):
    if not is_dm_socket():
        return
    scene_store.change_active_scene((data or {}).get("sceneId"))
    socketio.emit("activeSceneId", scene_store.active_scene_id)


@socketio.on("updateToken")
def socket_update_token(data):
    scene_id = (data or {}).get("sceneId")
    token_id = (data or {}).get("tokenId")
    properties = (data or {}).get("properties") or {}
    if not scene_id or not token_id:
        return
    if not is_dm_socket():
        scene = scene_store.scenes.get(scene_id)
        token = next((t for t in (scene or {}).get("tokens", []) if t.get("tokenId") == token_id), None)
        allowed = all(key in {"x", "y"} for key in properties.keys())
        if not token or not token.get("movableByPlayers") or not allowed:
            return
    token, was_hidden, is_hidden = scene_store.update_token(scene_id, token_id, properties)
    if not token:
        return
    if was_hidden != is_hidden:
        if is_hidden:
            emit("removeToken", {"sceneId": scene_id, "tokenId": token_id}, to="player", include_self=False)
            emit("updateToken", {"sceneId": scene_id, "tokenId": token_id, "properties": properties}, to="dm", include_self=False)
        else:
            emit("addToken", {"sceneId": scene_id, "token": token}, to="player", include_self=False)
            emit("updateToken", {"sceneId": scene_id, "tokenId": token_id, "properties": properties}, to="dm", include_self=False)
    elif is_hidden:
        emit("updateToken", {"sceneId": scene_id, "tokenId": token_id, "properties": properties}, to="dm", include_self=False)
    else:
        emit("updateToken", {"sceneId": scene_id, "tokenId": token_id, "properties": properties}, broadcast=True, include_self=False)


@socketio.on("addToken")
def socket_add_token(data):
    if not is_dm_socket():
        return
    scene_id = (data or {}).get("sceneId")
    token = (data or {}).get("token")
    scene_store.add_token(scene_id, token)
    socketio.emit("addToken", {"sceneId": scene_id, "token": token})


@socketio.on("removeToken")
def socket_remove_token(data):
    if not is_dm_socket():
        return
    scene_id = (data or {}).get("sceneId")
    token_id = (data or {}).get("tokenId")
    if scene_store.remove_token(scene_id, token_id):
        socketio.emit("removeToken", {"sceneId": scene_id, "tokenId": token_id})


@socketio.on("playTrack")
def socket_play_track(data):
    if is_dm_socket():
        emit("playTrack", data, broadcast=True, include_self=False)


@socketio.on("pauseTrack")
def socket_pause_track(data):
    if is_dm_socket():
        emit("pauseTrack", data, broadcast=True, include_self=False)


@socketio.on("setTrackVolume")
def socket_track_volume(data):
    if is_dm_socket():
        emit("setTrackVolume", data, broadcast=True, include_self=False)


@socketio.on("deleteTrack")
def socket_delete_track(data):
    if is_dm_socket():
        emit("deleteTrack", data, broadcast=True, include_self=False)


@socketio.on("addTrack")
def socket_add_track(data):
    if is_dm_socket():
        emit("addTrack", data, broadcast=True, include_self=False)


@socketio.on("updateInitiative")
def socket_update_initiative(data):
    global initiative_state
    if not is_dm_socket():
        return
    initiative_state = data
    socketio.emit("updateInitiative", data)


@socketio.on("toggleGrid")
def socket_toggle_grid(data):
    global grid_state
    if not is_dm_socket():
        return
    grid_state = data
    emit("toggleGrid", data, to="player", include_self=False)


@socketio.on("snapView")
def socket_snap_view(data):
    if not is_dm_socket():
        return
    if data and data.get("sceneId"):
        scene_store.change_active_scene(data.get("sceneId"))
    emit("snapView", data, to="player", include_self=False)


@socketio.on("setBgColor")
def socket_set_bg_color(data):
    global bg_color
    if not is_dm_socket():
        return
    bg_color = (data or {}).get("color")
    emit("setBgColor", data, to="player", include_self=False)


@socketio.on("pingScene")
def socket_ping_scene(data):
    emit("pingScene", data, broadcast=True, include_self=False)


@socketio.on("rollDice")
def socket_roll_dice(payload):
    raw_notation = payload if isinstance(payload, str) else (payload or {}).get("notation")
    colorset = (payload or {}).get("colorset", "white") if isinstance(payload, dict) else "white"
    texture = (payload or {}).get("texture", "") if isinstance(payload, dict) else ""
    result = server_roll(raw_notation)
    socketio.emit("diceRolled", {"notation": result["notation"], "colorset": colorset, "texture": texture})
    socketio.emit("diceResult", {"text": result["text"], "color": result["color"]})


@socketio.on("clearDice")
def socket_clear_dice():
    socketio.emit("diceCleared")


@socketio.on("addTokenFromLibrary")
def socket_add_token_from_library(data):
    if not is_dm_socket() or not scene_store.active_scene_id:
        return
    scene = scene_store.scenes.get(scene_store.active_scene_id) or scene_store.load_scene(scene_store.active_scene_id)
    max_z = max([token.get("zIndex", 0) for token in scene.get("tokens", [])] or [0])
    token = {
        "tokenId": f"{now_ms()}-{random.random():.9f}".replace("0.", ""),
        "sceneId": scene_store.active_scene_id,
        "imageUrl": (data or {}).get("imageUrl"),
        "mediaType": (data or {}).get("mediaType") or "image",
        "x": 100,
        "y": 100,
        "width": (data or {}).get("width") or 100,
        "height": (data or {}).get("height") or 100,
        "rotation": 0,
        "zIndex": max_z + 1,
        "movableByPlayers": False,
        "hidden": False,
    }
    scene_store.add_token(scene_store.active_scene_id, token)
    socketio.emit("addToken", {"sceneId": scene_store.active_scene_id, "token": token})


def main():
    port = int(os.environ.get("VTT_PORT", "3000"))
    print(f"Passwords loaded from: {SECRET_FILE}")
    print(f"Project folder: {BASE_DIR}")
    print(f"Public folder: {PUBLIC_DIR}")
    print(f"DM Password: {app.config['DM_PASSWORD']}")
    print(f"Player Password: {app.config['PLAYER_PASSWORD']}")
    socketio.run(app, host="0.0.0.0", port=port, allow_unsafe_werkzeug=True)


if __name__ == "__main__":
    main()
