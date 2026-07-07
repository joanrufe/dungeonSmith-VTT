from __future__ import annotations

import argparse
import datetime
import html
import json
import logging
import mimetypes
import os
import random
import re
import shutil
import sys
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple, Union, TypedDict

from flask import Flask, Response, jsonify, redirect, request, send_from_directory, session
from flask_socketio import SocketIO, emit, join_room
from werkzeug.utils import secure_filename


# ── Logging ───────────────────────────────────────────────────────────────────

logger = logging.getLogger(__name__)

# ── Domain types ──────────────────────────────────────────────────────────────

class _TokenDictRequired(TypedDict):
    tokenId: str
    sceneId: str
    imageUrl: str
    mediaType: str           # "image" | "video" | "pdf" | "text"
    x: float
    y: float
    width: float
    height: float
    rotation: float
    zIndex: int
    movableByPlayers: bool
    hidden: bool


class TokenDict(_TokenDictRequired, total=False):
    name: str
    locked: bool
    visibleToPlayers: bool
    isPaintTile: bool
    isAreaEffect: bool
    areaShape: str
    hpCurrent: Optional[int]
    hpMax: Optional[int]
    conditionText: Optional[str]
    conditionColor: Optional[str]
    conditionFontSize: Optional[int]
    isMap: bool
    visionRadius: float


class _SceneDictRequired(TypedDict):
    sceneId: str
    sceneName: str
    tokens: List[TokenDict]


class WallPointDict(TypedDict):
    x: float
    y: float


class WallDict(TypedDict):
    wallId: str
    points: List[WallPointDict]


class SceneDict(_SceneDictRequired, total=False):
    order: int
    walls: List[WallDict]
    fogOpacity: float


class _StickyNoteDictRequired(TypedDict):
    id: str
    x: float
    y: float
    w: float
    h: float
    color: str               # "yellow" | "pink" | "blue" | "green"
    text: str


StickyNoteDict = _StickyNoteDictRequired  # all fields present when persisted

# ── Type aliases ──────────────────────────────────────────────────────────────

SceneId = str
RouteReturn = Union[Response, str, Tuple[Any, int]]


BASE_DIR = Path(__file__).resolve().parent

# UI static assets stay in the original public/ tree.
UI_PUBLIC_DIR = BASE_DIR / "public"

# Password storage stays global (not campaign-scoped).
SECRET_DIR = BASE_DIR / "data" / "private"
SECRET_FILE = SECRET_DIR / "secrets.txt"
LEGACY_SECRET_FILE = BASE_DIR / "secret.txt"

DEFAULT_CAMPAIGN_NAME = "Sola en la oscuridad"
CAMPAIGNS_DIR = BASE_DIR / "campaigns"
CAMPAIGN_MARKER_FILE = BASE_DIR / ".campaign"

DEFAULT_SECRETS = {
    "DM_PASSWORD": "DMCODE",
    "PLAYER_PASSWORD": "PLAY",
}

BACKUP_EVERY_N_SAVES = 10
MAX_TOTAL_BACKUPS = 20

IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg"}
VIDEO_EXTS = {".mp4", ".webm", ".ogv", ".mov"}
PDF_EXTS = {".pdf"}
TEXT_EXTS = {".txt", ".md", ".json", ".csv", ".log"}
DOC_EXTS = PDF_EXTS | TEXT_EXTS
MEDIA_EXTS = IMAGE_EXTS | VIDEO_EXTS | DOC_EXTS
MUSIC_EXTS = {".mp3", ".wav", ".ogg", ".m4a", ".flac"}


@dataclass
class CampaignPaths:
    """All runtime I/O paths for a single campaign."""

    root_dir: Path
    data_dir: Path
    scenes_dir: Path
    backups_dir: Path
    notes_file: Path
    backup_state_file: Path
    public_dir: Path
    uploads_dir: Path
    media_dir: Path
    music_dir: Path
    player_media_dir: Path
    metadata_file: Path

    @classmethod
    def from_root(cls, root: Path) -> "CampaignPaths":
        data = root / "data"
        scenes = data / "scenes"
        public = root / "public"
        return cls(
            root_dir=root,
            data_dir=data,
            scenes_dir=scenes,
            backups_dir=scenes / "backups",
            notes_file=data / "sticky-notes.json",
            backup_state_file=data / "scenes-backup-state.json",
            public_dir=public,
            uploads_dir=public / "uploads",
            media_dir=public / "media",
            music_dir=public / "music",
            player_media_dir=public / "player-media",
            metadata_file=root / f"{root.name}.campaign",
        )

    def ensure_dirs(self) -> None:
        for directory in (
            self.scenes_dir,
            self.uploads_dir,
            self.media_dir,
            self.music_dir,
            self.player_media_dir,
        ):
            directory.mkdir(parents=True, exist_ok=True)


campaign_paths: Optional[CampaignPaths] = None
active_campaign_name: str = DEFAULT_CAMPAIGN_NAME


def resolve_campaign_name(
    cli: Optional[str] = None,
    env: Optional[str] = None,
    marker_path: Optional[Path] = None,
) -> str:
    """Resolve the active campaign name using CLI > env > marker > default."""
    if cli is not None:
        return cli.strip()
    if env is not None and env.strip():
        return env.strip()

    marker = marker_path or CAMPAIGN_MARKER_FILE
    if marker.exists():
        for line in marker.read_text(encoding="utf-8").splitlines():
            cleaned = line.strip()
            if cleaned:
                return cleaned
    return DEFAULT_CAMPAIGN_NAME


def is_valid_campaign_name(name: Optional[str]) -> bool:
    """Reject empty, whitespace-only, or path-unsafe campaign names."""
    if not isinstance(name, str):
        return False
    cleaned = name.strip()
    if not cleaned:
        return False
    if cleaned in (".", ".."):
        return False
    if cleaned.startswith("."):
        return False
    if any(char in cleaned for char in ("/", "\\", "\0")):
        return False
    if ".." in cleaned:
        return False
    return True


def validate_campaign_name(name: str) -> str:
    if not is_valid_campaign_name(name):
        raise ValueError(f"Invalid campaign name: {name!r}")
    return name.strip()


def ensure_campaign_metadata(
    paths: CampaignPaths,
    name: str,
    description: str = "",
) -> None:
    """Write a metadata file for the campaign if it does not already exist."""
    if paths.metadata_file.exists():
        return
    paths.root_dir.mkdir(parents=True, exist_ok=True)
    paths.metadata_file.write_text(
        json.dumps(
            {
                "name": name,
                "description": description,
                "createdAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
            },
            indent=2,
        ),
        encoding="utf-8",
    )


def discover_campaigns(campaigns_dir: Path = CAMPAIGNS_DIR) -> List[Dict[str, Any]]:
    """Scan campaigns_dir for metadata files and return sorted campaign dicts."""
    campaigns: List[Dict[str, Any]] = []
    for path in campaigns_dir.glob("*/*.campaign"):
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            logger.warning("Skipping unreadable campaign metadata %s: %s", path, exc)
            continue
        campaigns.append({
            "name": data.get("name", path.stem),
            "description": data.get("description", ""),
            "createdAt": data.get("createdAt", ""),
            "folder": path.parent.name,
        })
    campaigns.sort(key=lambda c: c["name"].lower())
    return campaigns


def create_campaign(name: str, description: str = "") -> CampaignPaths:
    """Create a new campaign folder with metadata and runtime directories."""
    validate_campaign_name(name)
    paths = CampaignPaths.from_root(CAMPAIGNS_DIR / name)
    paths.ensure_dirs()
    ensure_campaign_metadata(paths, name, description)
    return paths


def write_campaign_marker(name: str, marker_path: Path = CAMPAIGN_MARKER_FILE) -> None:
    """Write the active campaign name to the root marker file."""
    marker_path.write_text(name + "\n", encoding="utf-8")


def _copy_path(source: Path, target: Path) -> None:
    """Copy a file or directory tree from source to target."""
    if source.is_dir():
        shutil.copytree(str(source), str(target))
    else:
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(str(source), str(target))


def _verify_copy(source: Path, target: Path) -> bool:
    """Verify that a copied file or directory tree exists at target."""
    if not target.exists():
        return False
    if source.is_dir():
        if not target.is_dir():
            return False
        for item in source.rglob("*"):
            rel = item.relative_to(source)
            target_item = target / rel
            if item.is_dir():
                if not target_item.is_dir():
                    return False
            else:
                if not target_item.is_file():
                    return False
        return True
    return target.is_file()


def _remove_path(source: Path) -> None:
    """Remove a file or directory tree."""
    if source.is_dir():
        shutil.rmtree(str(source))
    else:
        source.unlink()


def migrate_legacy_runtime_data(
    paths: CampaignPaths,
    base_dir: Path = BASE_DIR,
) -> None:
    """
    Move legacy flat runtime data into the campaign tree safely.

    Only runtime state is moved: data/scenes/, data/sticky-notes.json,
    data/scenes-backup-state.json, and public/{uploads,media,music,player-media}/.
    UI assets, data/private/, and passwords stay untouched.

    Safety behavior:
    1. Create timestamped backup directories under data/ and public/.
    2. Copy legacy runtime data into the backup first.
    3. Copy legacy runtime data into the campaign tree.
    4. Verify every expected destination exists.
    5. Only then remove the original legacy files/directories.
    6. If any step fails, the originals are left untouched.
    """
    legacy_data = base_dir / "data"
    legacy_public = base_dir / "public"

    moves: List[Tuple[Path, Path]] = [
        (legacy_data / "scenes", paths.scenes_dir),
        (legacy_data / "sticky-notes.json", paths.notes_file),
        (legacy_data / "scenes-backup-state.json", paths.backup_state_file),
        (legacy_public / "uploads", paths.uploads_dir),
        (legacy_public / "media", paths.media_dir),
        (legacy_public / "music", paths.music_dir),
        (legacy_public / "player-media", paths.player_media_dir),
    ]

    paths.data_dir.mkdir(parents=True, exist_ok=True)
    paths.public_dir.mkdir(parents=True, exist_ok=True)

    timestamp = datetime.datetime.now(datetime.timezone.utc).strftime(
        "%Y%m%dT%H%M%S_%f"
    )
    backup_data_dir = legacy_data / f".migration-backup-{timestamp}"
    backup_public_dir = legacy_public / f".migration-backup-{timestamp}"

    planned: List[Tuple[Path, Path, Path]] = []
    for source, target in moves:
        if not source.exists():
            continue
        if target.exists():
            logger.warning(
                "Migration skipped %s because target %s already exists",
                source,
                target,
            )
            continue
        try:
            rel = source.relative_to(base_dir)
        except ValueError:
            rel = source.relative_to(legacy_data)
        if str(rel).startswith("public"):
            backup_target = backup_public_dir / Path(*rel.parts[1:])
        else:
            backup_target = backup_data_dir / Path(*rel.parts[1:])
        planned.append((source, target, backup_target))

    if not planned:
        paths.ensure_dirs()
        return

    # 1. Create backups before touching the campaign tree or the originals.
    try:
        backup_data_dir.mkdir(parents=True, exist_ok=True)
        backup_public_dir.mkdir(parents=True, exist_ok=True)
        for source, _target, backup_target in planned:
            _copy_path(source, backup_target)
    except OSError as exc:
        logger.error(
            "Migration backup failed; aborting and leaving legacy data untouched: %s",
            exc,
        )
        return

    # 2. Copy to the campaign tree, verify, and only then remove the original.
    any_migrated = False
    for source, target, backup_target in planned:
        try:
            _copy_path(source, target)
            if not _verify_copy(source, target):
                raise OSError(f"Verification failed after copying {source} to {target}")
        except OSError as exc:
            logger.error(
                "Failed to migrate %s to %s: %s; original left intact",
                source,
                target,
                exc,
            )
            continue

        try:
            _remove_path(source)
        except OSError as exc:
            logger.error(
                "Migrated %s -> %s but failed to remove the original: %s",
                source,
                target,
                exc,
            )
            continue

        any_migrated = True
        logger.info(
            "Migrated %s -> %s (backup: %s)",
            source,
            target,
            backup_target,
        )

    # Always ensure the campaign runtime directories exist, even when there is
    # no legacy data to migrate.
    paths.ensure_dirs()

    if any_migrated:
        logger.info(
            "Initial campaign '%s' created from existing flat runtime data",
            paths.root_dir.name,
        )


def reset_runtime_state() -> None:
    global bg_color, grid_state, initiative_state, socket_roles
    bg_color = None
    grid_state = None
    initiative_state = None
    socket_roles.clear()


def initialize_runtime(campaign_name: str) -> None:
    """Resolve paths and instantiate the in-memory store for a campaign."""
    global campaign_paths, scene_store, history, active_campaign_name

    default_root = CAMPAIGNS_DIR / DEFAULT_CAMPAIGN_NAME
    legacy_scenes_dir = BASE_DIR / "data" / "scenes"
    legacy_data_exists = (
        legacy_scenes_dir.exists() and any(legacy_scenes_dir.iterdir())
    )

    # If legacy flat data still exists and the default campaign has not been
    # created yet, force the default campaign so the existing data is migrated
    # exactly once. This protects users who changed the marker before the first
    # migrated launch from losing their scenes.
    if legacy_data_exists and not default_root.exists():
        requested_name = campaign_name
        campaign_name = DEFAULT_CAMPAIGN_NAME
        write_campaign_marker(campaign_name, marker_path=CAMPAIGN_MARKER_FILE)
        logger.warning(
            "OVERRIDE: --campaign / VTT_CAMPAIGN / .campaign selection %r is "
            "overridden; legacy runtime data found and will be migrated into the "
            "default campaign %r. Re-select the desired campaign after this launch.",
            requested_name,
            DEFAULT_CAMPAIGN_NAME,
        )

    active_campaign_name = campaign_name
    campaign_root = CAMPAIGNS_DIR / campaign_name

    if campaign_name == DEFAULT_CAMPAIGN_NAME and not campaign_root.exists():
        campaign_paths = CampaignPaths.from_root(campaign_root)
        migrate_legacy_runtime_data(campaign_paths, base_dir=BASE_DIR)
    else:
        campaign_paths = CampaignPaths.from_root(campaign_root)
        campaign_paths.ensure_dirs()

    ensure_campaign_metadata(campaign_paths, campaign_name)
    reset_runtime_state()
    scene_store = SceneStore(campaign_paths)
    history = SceneHistory(scene_store)


def initialize_for_test(root: Path) -> None:
    """Lightweight test entrypoint that scopes all runtime data under root."""
    global campaign_paths, scene_store, history, active_campaign_name
    active_campaign_name = root.name
    campaign_paths = CampaignPaths.from_root(root)
    campaign_paths.ensure_dirs()
    ensure_campaign_metadata(campaign_paths, root.name)
    reset_runtime_state()
    scene_store = SceneStore(campaign_paths)
    history = SceneHistory(scene_store)


def now_ms() -> str:
    return str(int(time.time() * 1000))


def parse_secrets(raw: str) -> Dict[str, str]:
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


def format_secrets(secrets: Dict[str, str]) -> str:
    return "\n".join([
        "# Passwords can be edited here or from the Media Library password tab.",
        "# These values stay server-side and are never sent to browser JavaScript.",
        f"DM_PASSWORD={secrets.get('DM_PASSWORD') or DEFAULT_SECRETS['DM_PASSWORD']}",
        f"PLAYER_PASSWORD={secrets.get('PLAYER_PASSWORD') or DEFAULT_SECRETS['PLAYER_PASSWORD']}",
        "",
    ])


def ensure_secret_storage() -> None:
    SECRET_DIR.mkdir(parents=True, exist_ok=True)
    if not SECRET_FILE.exists() and LEGACY_SECRET_FILE.exists():
        try:
            LEGACY_SECRET_FILE.replace(SECRET_FILE)
        except OSError:
            shutil.copyfile(LEGACY_SECRET_FILE, SECRET_FILE)
            LEGACY_SECRET_FILE.unlink(missing_ok=True)


def read_secrets() -> Dict[str, str]:
    ensure_secret_storage()
    try:
        return parse_secrets(SECRET_FILE.read_text(encoding="utf-8"))
    except OSError:
        secrets = dict(DEFAULT_SECRETS)
        SECRET_FILE.write_text(format_secrets(secrets), encoding="utf-8")
        return secrets


def safe_folder_name(value: Optional[str]) -> str:
    return re.sub(r"[^a-zA-Z0-9_\- ]", "", value or "").strip()


def safe_relative_media_path(url: Optional[str]) -> Optional[str]:
    rel = re.sub(r"^/media/", "", url or "")
    if not rel or ".." in rel or rel.startswith(("/", "\\")):
        return None
    return rel


def safe_relative_player_media_path(url: Optional[str]) -> Optional[str]:
    rel = re.sub(r"^/player-media/", "", url or "")
    if not rel or ".." in rel or rel.startswith(("/", "\\")):
        return None
    return rel


def get_media_type(name: str) -> Optional[str]:
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
    def __init__(self, paths: CampaignPaths) -> None:
        self.paths = paths
        self.active_scene_id: Optional[SceneId] = None
        self.scenes: Dict[SceneId, SceneDict] = {}
        self._backup_lock = threading.Lock()
        self.paths.scenes_dir.mkdir(parents=True, exist_ok=True)

    def _backup_state_file(self) -> Path:
        return self.paths.backup_state_file

    def _backup_timestamp(self) -> str:
        return datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%S_%f")

    def _backup_path(self, scene_id: SceneId, timestamp: Optional[str] = None) -> Path:
        return self.paths.scenes_dir / "backups" / f"{scene_id}-{timestamp or self._backup_timestamp()}.json"

    def _load_save_counts(self) -> Dict[SceneId, int]:
        path = self._backup_state_file()
        if not path.exists():
            return {}
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            logger.warning("Failed to read backup state file %s: %s", path, exc)
            return {}
        if not isinstance(data, dict):
            return {}
        return {
            str(k): int(v)
            for k, v in data.items()
            if isinstance(v, (int, float))
        }

    def _save_save_counts(self, counts: Dict[SceneId, int]) -> None:
        path = self._backup_state_file()
        path.parent.mkdir(parents=True, exist_ok=True)
        try:
            path.write_text(json.dumps(counts, indent=2, sort_keys=True), encoding="utf-8")
        except OSError as exc:
            logger.error("Failed to write backup state file %s: %s", path, exc)

    def _prune_old_backups(self) -> None:
        backups_dir = self.paths.scenes_dir / "backups"
        if not backups_dir.exists():
            return
        backups = sorted(backups_dir.glob("*.json"), key=lambda p: p.stat().st_mtime)
        while len(backups) > MAX_TOTAL_BACKUPS:
            oldest = backups.pop(0)
            try:
                oldest.unlink()
                logger.info(
                    "Removed oldest backup %s to keep global limit of %s",
                    oldest.name,
                    MAX_TOTAL_BACKUPS,
                )
            except OSError as exc:
                logger.error("Failed to remove old backup %s: %s", oldest, exc)

    def _create_backup(self, scene_id: SceneId) -> Optional[Path]:
        backups_dir = self.paths.scenes_dir / "backups"
        backups_dir.mkdir(parents=True, exist_ok=True)
        source = self.path_for(scene_id)
        if not source.exists():
            logger.warning("Cannot backup scene %s: source file missing", scene_id)
            return None
        backup_path = self._backup_path(scene_id)
        try:
            shutil.copyfile(source, backup_path)
            logger.info("Created backup for scene %s: %s", scene_id, backup_path.name)
            self._prune_old_backups()
            return backup_path
        except OSError as exc:
            logger.error("Failed to create backup for scene %s: %s", scene_id, exc)
            return None

    def _record_scene_save(self, scene_id: SceneId) -> None:
        with self._backup_lock:
            counts = self._load_save_counts()
            counts[scene_id] = counts.get(scene_id, 0) + 1
            if counts[scene_id] >= BACKUP_EVERY_N_SAVES:
                counts[scene_id] = 0
                self._create_backup(scene_id)
            self._save_save_counts(counts)

    def path_for(self, scene_id: SceneId) -> Path:
        return self.paths.scenes_dir / f"{scene_id}.json"

    def add_scene(self, scene: SceneDict) -> None:
        self.scenes[scene["sceneId"]] = scene

    def load_scene(self, scene_id: SceneId) -> SceneDict:
        if scene_id in self.scenes:
            scene = self.scenes[scene_id]
            scene.setdefault("walls", [])
            scene.setdefault("fogOpacity", 1.0)
            return scene
        path = self.path_for(scene_id)
        try:
            scene = json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as exc:
            logger.warning("Failed to parse scene %s at %s: %s", scene_id, path, exc)
            raise
        scene.setdefault("walls", [])
        scene.setdefault("fogOpacity", 1.0)
        self.scenes[scene_id] = scene
        return scene

    def save_scene(self, scene: SceneDict, count_save: bool = True) -> None:
        self.paths.scenes_dir.mkdir(parents=True, exist_ok=True)
        self.path_for(scene["sceneId"]).write_text(
            json.dumps(scene, indent=2), encoding="utf-8"
        )
        if count_save:
            self._record_scene_save(scene["sceneId"])

    def list_backups(self, scene_id: SceneId) -> List[Dict[str, Any]]:
        backups_dir = self.paths.scenes_dir / "backups"
        entries: List[Dict[str, Any]] = []
        if not backups_dir.exists():
            return entries
        prefix = f"{scene_id}-"
        for path in backups_dir.glob("*.json"):
            if not path.stem.startswith(prefix):
                continue
            try:
                stat = path.stat()
                entries.append({
                    "backupId": path.stem,
                    "createdAt": int(stat.st_mtime * 1000),
                })
            except OSError:
                continue
        entries.sort(key=lambda item: item["createdAt"], reverse=True)
        return entries

    def restore_backup(self, scene_id: SceneId, backup_id: str) -> None:
        backups_dir = self.paths.scenes_dir / "backups"
        backup_path = backups_dir / f"{backup_id}.json"
        if not backup_path.exists():
            raise FileNotFoundError(f"Backup {backup_id} not found")
        if not backup_path.stem.startswith(f"{scene_id}-"):
            raise ValueError(f"Backup {backup_id} does not belong to scene {scene_id}")
        scene_path = self.path_for(scene_id)
        if not scene_path.exists():
            raise FileNotFoundError(f"Scene {scene_id} not found")

        # Preserve the current state before overwriting it. The per-scene
        # save counter is intentionally not touched here.
        current_backup_path = self._backup_path(scene_id)
        try:
            shutil.copyfile(scene_path, current_backup_path)
            logger.info(
                "Pre-restore backup of current scene %s: %s",
                scene_id,
                current_backup_path.name,
            )
        except OSError as exc:
            logger.error("Failed to backup current scene before restore: %s", exc)
            raise

        try:
            shutil.copyfile(backup_path, scene_path)
        except OSError as exc:
            logger.error(
                "Failed to restore backup %s for scene %s: %s",
                backup_path.name,
                scene_id,
                exc,
            )
            raise

        self.scenes.pop(scene_id, None)
        logger.info("Restored scene %s from backup %s", scene_id, backup_id)

    def get_all_scenes(self) -> List[Dict[str, Any]]:
        scenes = []
        for path in self.paths.scenes_dir.glob("*.json"):
            try:
                scene = json.loads(path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError) as exc:
                logger.warning("Skipping unreadable scene file %s: %s", path, exc)
                continue
            scenes.append({
                "sceneId": scene.get("sceneId"),
                "sceneName": scene.get("sceneName"),
                "order": scene.get("order", 0),
                "folder": scene.get("folder", ""),
            })
        scenes.sort(key=lambda item: (item.get("order", 0), item.get("sceneName", "")))
        return scenes

    def update_scene(self, scene: SceneDict) -> None:
        self.scenes[scene["sceneId"]] = scene
        self.save_scene(scene)

    def change_active_scene(self, scene_id: Optional[SceneId]) -> None:
        self.active_scene_id = scene_id

    def delete_scene(self, scene_id: SceneId) -> None:
        scene = self.scenes.get(scene_id) or self.load_scene(scene_id)
        self.path_for(scene_id).unlink(missing_ok=True)
        self.scenes.pop(scene_id, None)
        for token in scene.get("tokens", []):
            image_url = token.get("imageUrl")
            self.delete_upload_if_unused(image_url)

    def update_scene_order(self, scene_order: List[SceneId]) -> None:
        for index, scene_id in enumerate(scene_order):
            scene = self.load_scene(scene_id)
            scene["order"] = index
            self.save_scene(scene, count_save=False)

    def rename_scene(self, scene_id: SceneId, scene_name: str) -> None:
        scene = self.load_scene(scene_id)
        scene["sceneName"] = scene_name
        self.save_scene(scene, count_save=False)
        if scene_id in self.scenes:
            self.scenes[scene_id]["sceneName"] = scene_name

    def set_scene_folder(self, scene_id: SceneId, folder: str) -> None:
        folder = (folder or "").strip()
        scene = self.load_scene(scene_id)
        scene["folder"] = folder
        self.save_scene(scene, count_save=False)
        if scene_id in self.scenes:
            self.scenes[scene_id]["folder"] = folder

    def list_scene_folders(self) -> List[str]:
        folders: set = set()
        for path in self.paths.scenes_dir.glob("*.json"):
            try:
                scene = json.loads(path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError) as exc:
                logger.warning("Skipping unreadable scene file %s: %s", path, exc)
                continue
            folder = scene.get("folder", "")
            if folder:
                folders.add(folder)
        return sorted(folders)

    def rename_scene_folder(self, old_name: str, new_name: str) -> None:
        old_name = (old_name or "").strip()
        new_name = (new_name or "").strip()
        if not old_name or not new_name or old_name == new_name:
            return
        for path in self.paths.scenes_dir.glob("*.json"):
            try:
                scene = json.loads(path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError) as exc:
                logger.warning("Skipping unreadable scene file while renaming folder: %s", exc)
                continue
            if scene.get("folder", "") == old_name:
                scene["folder"] = new_name
                path.write_text(json.dumps(scene, indent=2), encoding="utf-8")
                sid = scene.get("sceneId")
                if sid in self.scenes:
                    self.scenes[sid]["folder"] = new_name

    def delete_scene_folder(self, name: str) -> None:
        name = (name or "").strip()
        if not name:
            return
        for path in self.paths.scenes_dir.glob("*.json"):
            try:
                scene = json.loads(path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError) as exc:
                logger.warning("Skipping unreadable scene file while deleting folder: %s", exc)
                continue
            if scene.get("folder", "") == name:
                scene["folder"] = ""
                path.write_text(json.dumps(scene, indent=2), encoding="utf-8")
                sid = scene.get("sceneId")
                if sid in self.scenes:
                    self.scenes[sid]["folder"] = ""

    def is_image_used_elsewhere(self, image_url: Optional[str]) -> bool:
        if not image_url:
            return False
        for path in self.paths.scenes_dir.glob("*.json"):
            try:
                scene = json.loads(path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError) as exc:
                logger.warning("Skipping unreadable scene file %s while checking image reuse: %s", path, exc)
                continue
            for token in scene.get("tokens", []):
                if token.get("imageUrl") == image_url:
                    return True
        return False

    def delete_upload_if_unused(self, image_url: Optional[str]) -> None:
        if not image_url or image_url.startswith("data:") or image_url.startswith("/media/"):
            return
        if self.is_image_used_elsewhere(image_url):
            return
        rel = image_url.lstrip("/")
        path = self.paths.public_dir / rel
        try:
            path.unlink()
        except OSError:
            pass

    def update_token(self, scene_id: SceneId, token_id: str, properties: Dict[str, Any]) -> Tuple[Optional[TokenDict], bool, bool]:
        scene = self.scenes.get(scene_id) or self.load_scene(scene_id)
        for token in scene.get("tokens", []):
            if token.get("tokenId") == token_id:
                was_hidden = bool(token.get("hidden"))
                if "visionRadius" in properties:
                    properties["visionRadius"] = max(0.0, float(properties["visionRadius"]))
                if "isMap" in properties:
                    properties["isMap"] = bool(properties["isMap"])
                if "visibleToPlayers" in properties:
                    properties["visibleToPlayers"] = bool(properties["visibleToPlayers"])
                token.update(properties or {})
                self.save_scene(scene)
                return token, was_hidden, bool(token.get("hidden"))
        return None, False, False

    def add_token(self, scene_id: SceneId, token: TokenDict) -> None:
        scene = self.scenes.get(scene_id) or self.load_scene(scene_id)
        scene.setdefault("tokens", []).append(token)
        self.save_scene(scene)

    def remove_token(self, scene_id: SceneId, token_id: str) -> Optional[TokenDict]:
        scene = self.scenes.get(scene_id) or self.load_scene(scene_id)
        tokens = scene.setdefault("tokens", [])
        for index, token in enumerate(tokens):
            if token.get("tokenId") == token_id:
                removed = tokens.pop(index)
                self.save_scene(scene)
                return removed
        return None

    def add_wall(self, scene_id: SceneId, wall: WallDict) -> None:
        scene = self.scenes.get(scene_id) or self.load_scene(scene_id)
        scene.setdefault("walls", []).append(wall)
        self.save_scene(scene)

    def update_wall(
        self,
        scene_id: SceneId,
        wall_id: str,
        points: List[Dict[str, float]],
    ) -> bool:
        scene = self.scenes.get(scene_id) or self.load_scene(scene_id)
        for wall in scene.get("walls", []):
            if wall.get("wallId") == wall_id:
                wall["points"] = [dict(pt) for pt in (points or [])]
                self.save_scene(scene)
                return True
        return False

    def remove_wall(self, scene_id: SceneId, wall_id: str) -> Optional[WallDict]:
        scene = self.scenes.get(scene_id) or self.load_scene(scene_id)
        walls = scene.setdefault("walls", [])
        for index, wall in enumerate(walls):
            if wall.get("wallId") == wall_id:
                removed = walls.pop(index)
                self.save_scene(scene)
                return removed
        return None

    def clear_walls(self, scene_id: SceneId) -> None:
        scene = self.scenes.get(scene_id) or self.load_scene(scene_id)
        scene["walls"] = []
        self.save_scene(scene)

    def set_fog_opacity(self, scene_id: SceneId, fog_opacity: float) -> float:
        scene = self.scenes.get(scene_id) or self.load_scene(scene_id)
        clamped = max(0.0, min(1.0, float(fog_opacity)))
        scene["fogOpacity"] = clamped
        self.save_scene(scene)
        return clamped


class SceneHistory:
    """Server-side undo/redo of token-property mutations, per scene.

    In-memory only (lost on restart). One pending entry per scene coalesces
    bursts (e.g. a 60Hz drag) into a single undo step via a ~300ms inactivity
    window. Snapshot = deep copy of scene["tokens"] via json round-trip.
    All state is guarded by a single threading.Lock (async_mode="threading").
    """

    MAX_DEPTH = 50
    COALESCE_WINDOW_MS = 300

    def __init__(self, store: SceneStore) -> None:
        self._store = store
        self._lock = threading.Lock()
        self._scenes: Dict[SceneId, Dict[str, Any]] = {}

    def _ensure_scene(self, scene_id: SceneId) -> Dict[str, Any]:
        if scene_id not in self._scenes:
            self._scenes[scene_id] = {"undo": [], "redo": [], "pending": None}
        return self._scenes[scene_id]

    def before_mutation(self, scene_id: SceneId) -> None:
        now = time.time() * 1000
        with self._lock:
            self._ensure_scene(scene_id)
            self._sweep_all_locked()
            entry = self._scenes[scene_id]
            pending = entry["pending"]
            if pending is not None and (now - pending["last_touch_ms"]) < self.COALESCE_WINDOW_MS:
                pending["last_touch_ms"] = now
                return
            if pending is not None:
                self._finalize_pending_locked(scene_id)
            else:
                # No pending: a new mutation after undo/redo must clear the
                # redo stack (standard redo semantics). _finalize_pending_locked
                # already clears redo when finalizing an expired pending; this
                # covers the case where pending was None (e.g. right after undo).
                for redone in entry["redo"]:
                    for url in redone.get("deleted_image_urls", []):
                        self._store.delete_upload_if_unused(url)
                entry["redo"].clear()
            scene = self._store.scenes.get(scene_id) or self._store.load_scene(scene_id)
            entry["pending"] = {
                "before_tokens": json.loads(json.dumps(scene.get("tokens", []))),
                "before_walls": json.loads(json.dumps(scene.get("walls", []))),
                "last_touch_ms": now,
                "deleted_image_urls": [],
            }

    def record_pending_deletion(self, scene_id: SceneId, url: Optional[str]) -> None:
        if not url:
            return
        with self._lock:
            entry = self._ensure_scene(scene_id)
            pending = entry["pending"]
            if pending is not None:
                pending["deleted_image_urls"].append(url)

    def undo(self, scene_id: SceneId) -> Optional[Dict[str, Any]]:
        with self._lock:
            self._ensure_scene(scene_id)
            self._finalize_pending_locked(scene_id)
            entry = self._scenes[scene_id]
            if not entry["undo"]:
                return None
            scene = self._store.scenes.get(scene_id) or self._store.load_scene(scene_id)
            current_tokens = json.loads(json.dumps(scene.get("tokens", [])))
            current_walls = json.loads(json.dumps(scene.get("walls", [])))
            entry["redo"].append({"tokens": current_tokens, "walls": current_walls, "deleted_image_urls": []})
            return entry["undo"].pop()

    def redo(self, scene_id: SceneId) -> Optional[Dict[str, Any]]:
        with self._lock:
            self._ensure_scene(scene_id)
            self._finalize_pending_locked(scene_id)
            entry = self._scenes[scene_id]
            if not entry["redo"]:
                return None
            scene = self._store.scenes.get(scene_id) or self._store.load_scene(scene_id)
            current_tokens = json.loads(json.dumps(scene.get("tokens", [])))
            current_walls = json.loads(json.dumps(scene.get("walls", [])))
            entry["undo"].append({"tokens": current_tokens, "walls": current_walls, "deleted_image_urls": []})
            if len(entry["undo"]) > self.MAX_DEPTH:
                self._evict_oldest_locked(scene_id)
            return entry["redo"].pop()

    def state(self, scene_id: SceneId) -> Tuple[bool, bool]:
        with self._lock:
            self._ensure_scene(scene_id)
            self._sweep_all_locked()
            entry = self._scenes[scene_id]
            return (len(entry["undo"]) > 0, len(entry["redo"]) > 0)

    def _finalize_pending_locked(self, scene_id: SceneId) -> None:
        entry = self._scenes[scene_id]
        pending = entry["pending"]
        if pending is None:
            return
        entry["pending"] = None
        for redone in entry["redo"]:
            for url in redone.get("deleted_image_urls", []):
                self._store.delete_upload_if_unused(url)
        entry["redo"].clear()
        entry["undo"].append({
            "tokens": pending["before_tokens"],
            "walls": pending["before_walls"],
            "deleted_image_urls": pending["deleted_image_urls"],
        })
        if len(entry["undo"]) > self.MAX_DEPTH:
            self._evict_oldest_locked(scene_id)

    def _evict_oldest_locked(self, scene_id: SceneId) -> None:
        entry = self._scenes[scene_id]
        if not entry["undo"]:
            return
        evicted = entry["undo"].pop(0)
        for url in evicted.get("deleted_image_urls", []):
            self._store.delete_upload_if_unused(url)

    def _sweep_all_locked(self) -> None:
        now = time.time() * 1000
        for scene_id, entry in self._scenes.items():
            pending = entry["pending"]
            if pending is not None and (now - pending["last_touch_ms"]) >= self.COALESCE_WINDOW_MS:
                self._finalize_pending_locked(scene_id)


scene_store: Optional[SceneStore] = None
history: Optional[SceneHistory] = None

app = Flask(__name__, static_folder=str(UI_PUBLIC_DIR), static_url_path="")
app.secret_key = os.environ.get("SESSION_SECRET") or os.urandom(32)
# Passwords are configured after campaign resolution in main().
app.config["DM_PASSWORD"] = DEFAULT_SECRETS["DM_PASSWORD"]
app.config["PLAYER_PASSWORD"] = DEFAULT_SECRETS["PLAYER_PASSWORD"]
socketio = SocketIO(app, async_mode="threading", cors_allowed_origins="*")

bg_color: Optional[str] = None
grid_state: Optional[Any] = None
initiative_state: Optional[Any] = None
socket_roles: Dict[str, str] = {}


def require_dm() -> bool:
    return bool(session.get("isDM"))


def require_player() -> bool:
    return bool(session.get("isPlayer") or session.get("isDM"))


def json_body() -> Dict[str, Any]:
    return request.get_json(silent=True) or request.form.to_dict() or {}


@app.before_request
def redirect_static_html_names() -> Optional[Response]:
    if request.path == "/index.html":
        return redirect("/")
    if request.path == "/dm.html":
        return redirect("/dm")
    if request.path == "/files.html":
        return redirect("/dmadmin")
    if request.path == "/player-files.html":
        return redirect("/player-files")
    return None


@app.after_request
def cache_headers(response: Response) -> Response:
    if request.path.lower().endswith((".html", ".css", ".js")):
        response.headers["Cache-Control"] = "no-store"
    return response


@app.get("/")
def player_index() -> RouteReturn:
    if not require_player():
        return redirect("/player-login")
    return send_from_directory(UI_PUBLIC_DIR, "index.html")


@app.get("/player-login")
def player_login_page() -> RouteReturn:
    return send_from_directory(UI_PUBLIC_DIR, "player-login.html")


@app.post("/player-login")
def player_login() -> RouteReturn:
    password = request.form.get("password") or json_body().get("password")
    if password == app.config["PLAYER_PASSWORD"]:
        session["isPlayer"] = True
        return redirect("/")
    return 'Incorrect password. <a href="/player-login">Try again</a>'


@app.get("/dm-login")
def dm_login_page() -> RouteReturn:
    return send_from_directory(UI_PUBLIC_DIR, "dm-login.html")


@app.post("/dm-login")
def dm_login() -> RouteReturn:
    password = request.form.get("password") or json_body().get("password")
    if password == app.config["DM_PASSWORD"]:
        session["isDM"] = True
        return redirect("/dm")
    return 'Incorrect password. <a href="/dm-login">Try again</a>'


@app.get("/dm")
def dm_page() -> RouteReturn:
    if not require_dm():
        return redirect("/dm-login")
    dm_html = (UI_PUBLIC_DIR / "dm.html").read_text(encoding="utf-8")
    dm_html = dm_html.replace("{{CAMPAIGN_ACTIVE}}", html.escape(active_campaign_name))
    return Response(dm_html, mimetype="text/html")


@app.get("/dmadmin")
def files_page() -> RouteReturn:
    if not require_dm():
        return redirect("/dm-login")
    return send_from_directory(UI_PUBLIC_DIR, "files.html")


@app.get("/player-files")
def player_files_page() -> RouteReturn:
    if not require_player():
        return redirect("/player-login")
    return send_from_directory(UI_PUBLIC_DIR, "player-files.html")


@app.post("/createScene")
def create_scene() -> RouteReturn:
    if not require_dm():
        return redirect("/dm-login")
    data = json_body()
    scene_id = now_ms()
    scene = {
        "sceneId": scene_id,
        "sceneName": data.get("sceneName"),
        "tokens": [],
        "folder": "",
        "order": len(scene_store.get_all_scenes()),
    }
    scene_store.save_scene(scene, count_save=False)
    scene_store.add_scene(scene)
    return jsonify({"sceneId": scene_id})


@app.get("/scenes")
def get_scenes() -> RouteReturn:
    return jsonify({"scenes": scene_store.get_all_scenes()})


@app.post("/updateScene")
def update_scene() -> RouteReturn:
    if not require_dm():
        return redirect("/dm-login")
    try:
        scene_store.update_scene(json_body().get("scene"))
        return jsonify({"message": "Scene updated."})
    except Exception:
        return "Error updating scene.", 500


@app.post("/deleteScene")
def delete_scene() -> RouteReturn:
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
def duplicate_scene() -> RouteReturn:
    if not require_dm():
        return redirect("/dm-login")
    data = json_body()
    try:
        source = scene_store.load_scene(data.get("sceneId"))
        new_scene = json.loads(json.dumps(source))
        new_scene_id = now_ms()
        new_scene["sceneId"] = new_scene_id
        new_scene["sceneName"] = data.get("sceneName") or f"Copy of {source.get('sceneName')}"
        new_scene["folder"] = ""
        new_scene["order"] = len(scene_store.get_all_scenes())
        scene_store.save_scene(new_scene, count_save=False)
        scene_store.add_scene(new_scene)
        return jsonify({"sceneId": new_scene_id})
    except Exception:
        return jsonify({"error": "Error duplicating scene."}), 500


@app.post("/updateSceneOrder")
def update_scene_order() -> RouteReturn:
    if not require_dm():
        return redirect("/dm-login")
    try:
        scene_store.update_scene_order(json_body().get("sceneOrder") or [])
        return jsonify({"success": True})
    except Exception:
        return jsonify({"success": False, "message": "Failed to update scene order"})


@app.post("/api/scenes/<sceneId>/rename")
def rename_scene_name(sceneId: SceneId) -> RouteReturn:
    if not require_dm():
        return redirect("/dm-login")
    try:
        scene_name = str(json_body().get("sceneName") or "").strip()
        if not scene_name:
            return jsonify({"success": False, "message": "Scene name is required"}), 400
        scene_store.rename_scene(sceneId, scene_name)
        return jsonify({"success": True})
    except Exception as exc:
        logger.exception("Failed to rename scene %s", sceneId)
        return jsonify({"success": False, "message": str(exc)}), 500


@app.post("/api/scenes/<sceneId>/folder")
def set_scene_folder_endpoint(sceneId: SceneId) -> RouteReturn:
    if not require_dm():
        return redirect("/dm-login")
    try:
        folder = str(json_body().get("folder") or "").strip()
        scene_store.set_scene_folder(sceneId, folder)
        return jsonify({"success": True})
    except Exception as exc:
        logger.exception("Failed to set folder for scene %s", sceneId)
        return jsonify({"success": False, "message": str(exc)}), 500


@app.get("/api/scenes/folders")
def list_scene_folders_endpoint() -> RouteReturn:
    if not require_dm():
        return redirect("/dm-login")
    try:
        return jsonify({"folders": scene_store.list_scene_folders()})
    except Exception:
        return jsonify({"folders": []}), 500


@app.post("/api/scenes/folders/rename")
def rename_scene_folder_endpoint() -> RouteReturn:
    if not require_dm():
        return redirect("/dm-login")
    try:
        data = json_body()
        old_name = str(data.get("oldName") or "").strip()
        new_name = str(data.get("newName") or "").strip()
        if not old_name or not new_name:
            return jsonify({"success": False, "message": "Both old and new folder names are required"}), 400
        scene_store.rename_scene_folder(old_name, new_name)
        return jsonify({"success": True})
    except Exception as exc:
        logger.exception("Failed to rename scene folder")
        return jsonify({"success": False, "message": str(exc)}), 500


@app.post("/api/scenes/folders/delete")
def delete_scene_folder_endpoint() -> RouteReturn:
    if not require_dm():
        return redirect("/dm-login")
    try:
        name = str(json_body().get("name") or "").strip()
        if not name:
            return jsonify({"success": False, "message": "Folder name is required"}), 400
        scene_store.delete_scene_folder(name)
        return jsonify({"success": True})
    except Exception as exc:
        logger.exception("Failed to delete scene folder")
        return jsonify({"success": False, "message": str(exc)}), 500


@app.get("/api/scenes/<sceneId>/backups")
def list_scene_backups(sceneId: SceneId) -> RouteReturn:
    if not require_dm():
        return redirect("/dm-login")
    try:
        return jsonify({"backups": scene_store.list_backups(sceneId)})
    except Exception:
        return jsonify({"backups": []}), 500


@app.post("/api/scenes/<sceneId>/backups/<backupId>/restore")
def restore_scene_backup(sceneId: SceneId, backupId: str) -> RouteReturn:
    if not require_dm():
        return redirect("/dm-login")
    try:
        scene_store.restore_backup(sceneId, backupId)
        socketio.emit("sceneReloadRequested", {"sceneId": sceneId})
        return jsonify({"success": True})
    except Exception as exc:
        logger.exception("Failed to restore backup %s for scene %s", backupId, sceneId)
        return jsonify({"success": False, "message": str(exc)}), 500


@app.post("/upload")
def upload_file() -> RouteReturn:
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
    campaign_paths.uploads_dir.mkdir(parents=True, exist_ok=True)
    filename = f"{now_ms()}-{secure_filename(file.filename)}"
    file.save(campaign_paths.uploads_dir / filename)
    return jsonify({"imageUrl": f"/uploads/{filename}", "mediaType": media_type})


@app.post("/uploadMusic")
def upload_music() -> RouteReturn:
    if not require_dm():
        return redirect("/dm-login")
    file = request.files.get("music")
    if not file:
        return jsonify({"success": False, "message": "No music file uploaded."}), 400
    mime_type = file.mimetype or ""
    if not mime_type.startswith("audio/"):
        return jsonify({"success": False, "message": "Unsupported file type"}), 400
    campaign_paths.music_dir.mkdir(parents=True, exist_ok=True)
    filename = f"{now_ms()}-{secure_filename(file.filename)}"
    file.save(campaign_paths.music_dir / filename)
    return jsonify({"success": True, "musicUrl": f"/music/{filename}", "filename": filename})


@app.get("/musicList")
def music_list() -> RouteReturn:
    campaign_paths.music_dir.mkdir(parents=True, exist_ok=True)
    tracks = []
    for path in campaign_paths.music_dir.iterdir():
        if path.is_file() and path.suffix.lower() in MUSIC_EXTS:
            tracks.append({
                "name": re.sub(r"^\d+\s*[-_]?\s*", "", path.name),
                "filename": path.name,
                "url": f"/music/{path.name}",
            })
    return jsonify({"success": True, "musicTracks": tracks})


@app.post("/deleteMusic")
def delete_music() -> RouteReturn:
    if not require_dm():
        return redirect("/dm-login")
    filename = Path(json_body().get("filename") or "").name
    if not filename:
        return jsonify({"success": False, "message": "No filename provided."}), 400
    path = campaign_paths.music_dir / filename
    if not path.exists():
        return jsonify({"success": False, "message": "File not found."}), 404
    path.unlink()
    return jsonify({"success": True})


@app.get("/mediaList")
def media_list() -> RouteReturn:
    if not require_player():
        return redirect("/player-login")
    campaign_paths.media_dir.mkdir(parents=True, exist_ok=True)
    folders = []
    root_files = []
    for entry in campaign_paths.media_dir.iterdir():
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
def media_folder_create() -> RouteReturn:
    if not require_dm():
        return redirect("/dm-login")
    name = safe_folder_name(json_body().get("name"))
    if not name:
        return jsonify({"error": "Invalid folder name"}), 400
    (campaign_paths.media_dir / name).mkdir(parents=True, exist_ok=True)
    return jsonify({"ok": True})


@app.post("/mediaUpload")
def media_upload() -> RouteReturn:
    if not require_dm():
        return redirect("/dm-login")
    folder = safe_folder_name(request.args.get("folder"))
    dest = campaign_paths.media_dir / folder if folder else campaign_paths.media_dir
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
def player_media_list() -> RouteReturn:
    if not require_player():
        return redirect("/player-login")
    campaign_paths.player_media_dir.mkdir(parents=True, exist_ok=True)
    folders = []
    root_files = []
    for entry in campaign_paths.player_media_dir.iterdir():
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
def player_media_upload() -> RouteReturn:
    if not require_player():
        return redirect("/player-login")
    provided = request.headers.get("X-DM-Password") or ""
    if provided != app.config["DM_PASSWORD"]:
        return jsonify({"error": "Invalid DM password."}), 403
    folder = safe_folder_name(request.args.get("folder"))
    dest = campaign_paths.player_media_dir / folder if folder else campaign_paths.player_media_dir
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
def player_media_folder_create() -> RouteReturn:
    if not require_player():
        return redirect("/player-login")
    provided = request.headers.get("X-DM-Password") or ""
    if provided != app.config["DM_PASSWORD"]:
        return jsonify({"error": "Invalid DM password."}), 403
    name = safe_folder_name(json_body().get("name"))
    if not name:
        return jsonify({"error": "Invalid folder name"}), 400
    (campaign_paths.player_media_dir / name).mkdir(parents=True, exist_ok=True)
    return jsonify({"ok": True})


@app.delete("/playerMediaFolder")
def player_media_folder_delete() -> RouteReturn:
    if not require_player():
        return redirect("/player-login")
    provided = request.headers.get("X-DM-Password") or ""
    if provided != app.config["DM_PASSWORD"]:
        return jsonify({"error": "Invalid DM password."}), 403
    name = safe_folder_name(json_body().get("name"))
    if not name:
        return jsonify({"error": "Invalid folder name"}), 400
    shutil.rmtree(campaign_paths.player_media_dir / name, ignore_errors=True)
    return jsonify({"ok": True})


@app.delete("/playerMediaFile")
def player_media_file_delete() -> RouteReturn:
    if not require_player():
        return redirect("/player-login")
    provided = request.headers.get("X-DM-Password") or ""
    if provided != app.config["DM_PASSWORD"]:
        return jsonify({"error": "Invalid DM password."}), 403
    rel = safe_relative_player_media_path(json_body().get("url"))
    if not rel:
        return jsonify({"error": "Bad path"}), 400
    try:
        (campaign_paths.player_media_dir / rel).unlink()
    except OSError:
        return jsonify({"error": "File not found."}), 404
    return jsonify({"ok": True})


@app.delete("/mediaFolder")
def media_folder_delete() -> RouteReturn:
    if not require_dm():
        return redirect("/dm-login")
    name = safe_folder_name(json_body().get("name"))
    if not name:
        return jsonify({"error": "Invalid folder name"}), 400
    shutil.rmtree(campaign_paths.media_dir / name, ignore_errors=True)
    return jsonify({"ok": True})


@app.patch("/mediaFolder")
def media_folder_rename() -> RouteReturn:
    if not require_dm():
        return redirect("/dm-login")
    data = json_body()
    old_name = safe_folder_name(data.get("oldName"))
    new_name = safe_folder_name(data.get("newName"))
    if not old_name or not new_name:
        return jsonify({"error": "Invalid folder name"}), 400
    (campaign_paths.media_dir / old_name).rename(campaign_paths.media_dir / new_name)
    return jsonify({"ok": True})


@app.delete("/mediaFile")
def media_file_delete() -> RouteReturn:
    if not require_dm():
        return redirect("/dm-login")
    rel = safe_relative_media_path(json_body().get("url"))
    if not rel:
        return jsonify({"error": "Bad path"}), 400
    (campaign_paths.media_dir / rel).unlink()
    return jsonify({"ok": True})


@app.get("/passwords")
def passwords_get() -> RouteReturn:
    if not require_dm():
        return redirect("/dm-login")
    current = read_secrets()
    return jsonify({
        "dmPassword": current.get("DM_PASSWORD") or DEFAULT_SECRETS["DM_PASSWORD"],
        "playerPassword": current.get("PLAYER_PASSWORD") or DEFAULT_SECRETS["PLAYER_PASSWORD"],
    })


@app.put("/passwords")
def passwords_put() -> RouteReturn:
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
def sticky_notes_get() -> RouteReturn:
    if not require_dm():
        return redirect("/dm-login")
    campaign_paths.data_dir.mkdir(parents=True, exist_ok=True)
    if not campaign_paths.notes_file.exists():
        campaign_paths.notes_file.write_text("[]", encoding="utf-8")
    return jsonify(json.loads(campaign_paths.notes_file.read_text(encoding="utf-8")))


@app.post("/sticky-notes")
def sticky_notes_post() -> RouteReturn:
    if not require_dm():
        return redirect("/dm-login")
    notes = request.get_json(silent=True)
    if not isinstance(notes, list):
        return jsonify({"error": "Expected array"}), 400
    campaign_paths.data_dir.mkdir(parents=True, exist_ok=True)
    campaign_paths.notes_file.write_text(json.dumps(notes), encoding="utf-8")
    return jsonify({"ok": True})


# ── Campaign management endpoints ─────────────────────────────────────────────


@app.get("/campaigns")
def list_campaigns_endpoint() -> RouteReturn:
    if not require_dm():
        return jsonify({"error": "DM access required"}), 403
    return jsonify({
        "campaigns": discover_campaigns(CAMPAIGNS_DIR),
        "active": active_campaign_name,
    })


@app.post("/campaigns")
def create_campaign_endpoint() -> RouteReturn:
    if not require_dm():
        return jsonify({"error": "DM access required"}), 403
    data = json_body()
    name = str(data.get("name") or "").strip()
    description = str(data.get("description") or "").strip()
    if not is_valid_campaign_name(name):
        return jsonify({"error": "Invalid campaign name"}), 400
    metadata_path = CAMPAIGNS_DIR / name / f"{name}.campaign"
    if metadata_path.exists():
        return jsonify({"error": "Campaign already exists"}), 409
    create_campaign(name, description)
    return jsonify({"success": True, "name": name}), 201


@app.post("/campaigns/switch")
def switch_campaign_endpoint() -> RouteReturn:
    if not require_dm():
        return jsonify({"error": "DM access required"}), 403
    name = str(json_body().get("name") or "").strip()
    if not is_valid_campaign_name(name):
        return jsonify({"error": "Invalid campaign name"}), 400
    write_campaign_marker(name, CAMPAIGN_MARKER_FILE)
    return jsonify({"success": True, "restartRequired": True})


# ── Campaign-scoped static media routes ───────────────────────────────────────
# UI assets continue to be served from the root public/ tree via Flask's
# static handler. Runtime media is served from the active campaign directory.


@app.get("/media/<path:filename>")
def campaign_media_file(filename: str) -> RouteReturn:
    return send_from_directory(campaign_paths.media_dir, filename)


@app.get("/music/<path:filename>")
def campaign_music_file(filename: str) -> RouteReturn:
    return send_from_directory(campaign_paths.music_dir, filename)


@app.get("/uploads/<path:filename>")
def campaign_upload_file(filename: str) -> RouteReturn:
    return send_from_directory(campaign_paths.uploads_dir, filename)


@app.get("/player-media/<path:filename>")
def campaign_player_media_file(filename: str) -> RouteReturn:
    return send_from_directory(campaign_paths.player_media_dir, filename)


def server_roll(raw_notation: str) -> Dict[str, str]:
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


def is_dm_socket() -> bool:
    return getattr(request, "sid", None) and socket_roles.get(request.sid) == "dm"


def is_token_visible_to_players(token: Optional[Dict[str, Any]]) -> bool:
    """A token is shown to players only when it is not hidden and is marked visible."""
    if not token:
        return False
    return not token.get("hidden") and token.get("visibleToPlayers", True)


@socketio.on("connect")
def socket_connect() -> None:
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
def socket_disconnect() -> None:
    socket_roles.pop(request.sid, None)


@socketio.on("loadScene")
def socket_load_scene(data: Optional[Dict[str, Any]]) -> None:
    try:
        scene = scene_store.load_scene((data or {}).get("sceneId"))
        if socket_roles.get(request.sid) == "player":
            filtered = dict(scene)
            filtered["tokens"] = [token for token in scene.get("tokens", []) if is_token_visible_to_players(token)]
            filtered.pop("walls", None)
            emit("sceneData", filtered)
            emit("wallsData", {"sceneId": scene["sceneId"], "walls": scene.get("walls", [])})
        else:
            emit("sceneData", scene)
    except Exception:
        emit("error", {"message": "Failed to load scene."})


@socketio.on("changeScene")
def socket_change_scene(data: Optional[Dict[str, Any]]) -> None:
    if not is_dm_socket():
        return
    scene_store.change_active_scene((data or {}).get("sceneId"))
    socketio.emit("activeSceneId", scene_store.active_scene_id)


@socketio.on("updateToken")
def socket_update_token(data: Optional[Dict[str, Any]]) -> None:
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
    if is_dm_socket():
        history.before_mutation(scene_id)
    # Capture visibility before mutation so we can add/remove the token from players when it changes.
    pre_scene = scene_store.scenes.get(scene_id) or scene_store.load_scene(scene_id)
    pre_token = next((t for t in pre_scene.get("tokens", []) if t.get("tokenId") == token_id), None)
    was_visible = is_token_visible_to_players(pre_token)
    token, was_hidden, is_hidden = scene_store.update_token(scene_id, token_id, properties)
    if not token:
        return
    is_visible = is_token_visible_to_players(token)
    if was_visible != is_visible:
        if is_visible:
            emit("addToken", {"sceneId": scene_id, "token": token}, to="player", include_self=False)
            emit("updateToken", {"sceneId": scene_id, "tokenId": token_id, "properties": properties}, to="dm", include_self=False)
        else:
            emit("removeToken", {"sceneId": scene_id, "tokenId": token_id}, to="player", include_self=False)
            emit("updateToken", {"sceneId": scene_id, "tokenId": token_id, "properties": properties}, to="dm", include_self=False)
    elif is_visible:
        emit("updateToken", {"sceneId": scene_id, "tokenId": token_id, "properties": properties}, broadcast=True, include_self=False)
    else:
        emit("updateToken", {"sceneId": scene_id, "tokenId": token_id, "properties": properties}, to="dm", include_self=False)
    if is_dm_socket():
        can_undo, can_redo = history.state(scene_id)
        socketio.emit("undoRedoState", {"canUndo": can_undo, "canRedo": can_redo}, to="dm")


@socketio.on("addToken")
def socket_add_token(data: Optional[Dict[str, Any]]) -> None:
    if not is_dm_socket():
        return
    scene_id = (data or {}).get("sceneId")
    token = (data or {}).get("token") or {}
    token.setdefault("visibleToPlayers", True)
    history.before_mutation(scene_id)
    scene_store.add_token(scene_id, token)
    socketio.emit("addToken", {"sceneId": scene_id, "token": token}, to="dm")
    if is_token_visible_to_players(token):
        socketio.emit("addToken", {"sceneId": scene_id, "token": token}, to="player")
    can_undo, can_redo = history.state(scene_id)
    socketio.emit("undoRedoState", {"canUndo": can_undo, "canRedo": can_redo}, to="dm")


@socketio.on("removeToken")
def socket_remove_token(data: Optional[Dict[str, Any]]) -> None:
    if not is_dm_socket():
        return
    scene_id = (data or {}).get("sceneId")
    token_id = (data or {}).get("tokenId")
    history.before_mutation(scene_id)
    removed = scene_store.remove_token(scene_id, token_id)
    if removed is not None:
        history.record_pending_deletion(scene_id, removed.get("imageUrl"))
        socketio.emit("removeToken", {"sceneId": scene_id, "tokenId": token_id})
    can_undo, can_redo = history.state(scene_id)
    socketio.emit("undoRedoState", {"canUndo": can_undo, "canRedo": can_redo}, to="dm")


@socketio.on("addWall")
def socket_add_wall(data: Optional[Dict[str, Any]]) -> None:
    if not is_dm_socket():
        return
    scene_id = (data or {}).get("sceneId")
    wall = (data or {}).get("wall")
    if not scene_id or not wall or not wall.get("wallId") or not wall.get("points"):
        return
    wall["points"] = [dict(pt) for pt in wall.get("points", [])]
    history.before_mutation(scene_id)
    scene_store.add_wall(scene_id, wall)
    socketio.emit("addWall", {"sceneId": scene_id, "wall": wall}, to="dm")
    socketio.emit("wallsData", {"sceneId": scene_id, "walls": scene_store.load_scene(scene_id).get("walls", [])}, to="player")
    can_undo, can_redo = history.state(scene_id)
    socketio.emit("undoRedoState", {"canUndo": can_undo, "canRedo": can_redo}, to="dm")


@socketio.on("updateWall")
def socket_update_wall(data: Optional[Dict[str, Any]]) -> None:
    if not is_dm_socket():
        return
    scene_id = (data or {}).get("sceneId")
    wall_id = (data or {}).get("wallId")
    points = (data or {}).get("points")
    if not scene_id or not wall_id or not points:
        return
    history.before_mutation(scene_id)
    updated = scene_store.update_wall(scene_id, wall_id, points)
    if updated:
        scene = scene_store.load_scene(scene_id)
        updated_wall = next((w for w in scene.get("walls", []) if w.get("wallId") == wall_id), {})
        socketio.emit("updateWall", {"sceneId": scene_id, "wallId": wall_id, **updated_wall}, to="dm")
        socketio.emit("wallsData", {"sceneId": scene_id, "walls": scene.get("walls", [])}, to="player")
    can_undo, can_redo = history.state(scene_id)
    socketio.emit("undoRedoState", {"canUndo": can_undo, "canRedo": can_redo}, to="dm")


@socketio.on("removeWall")
def socket_remove_wall(data: Optional[Dict[str, Any]]) -> None:
    if not is_dm_socket():
        return
    scene_id = (data or {}).get("sceneId")
    wall_id = (data or {}).get("wallId")
    if not scene_id or not wall_id:
        return
    history.before_mutation(scene_id)
    removed = scene_store.remove_wall(scene_id, wall_id)
    if removed is not None:
        socketio.emit("removeWall", {"sceneId": scene_id, "wallId": wall_id}, to="dm")
        socketio.emit("wallsData", {"sceneId": scene_id, "walls": scene_store.load_scene(scene_id).get("walls", [])}, to="player")
    can_undo, can_redo = history.state(scene_id)
    socketio.emit("undoRedoState", {"canUndo": can_undo, "canRedo": can_redo}, to="dm")


@socketio.on("clearWalls")
def socket_clear_walls(data: Optional[Dict[str, Any]]) -> None:
    if not is_dm_socket():
        return
    scene_id = (data or {}).get("sceneId")
    if not scene_id:
        return
    history.before_mutation(scene_id)
    scene_store.clear_walls(scene_id)
    socketio.emit("clearWalls", {"sceneId": scene_id}, to="dm")
    socketio.emit("wallsData", {"sceneId": scene_id, "walls": []}, to="player")
    can_undo, can_redo = history.state(scene_id)
    socketio.emit("undoRedoState", {"canUndo": can_undo, "canRedo": can_redo}, to="dm")


@socketio.on("setFogOpacity")
def socket_set_fog_opacity(data: Optional[Dict[str, Any]]) -> None:
    if not is_dm_socket():
        return
    target_scene_id = (data or {}).get("sceneId") or scene_store.active_scene_id
    if not target_scene_id:
        return
    try:
        raw_value = float((data or {}).get("fogOpacity"))
    except (TypeError, ValueError):
        return
    clamped = scene_store.set_fog_opacity(target_scene_id, raw_value)
    socketio.emit("fogOpacity", {"sceneId": target_scene_id, "fogOpacity": clamped})


@socketio.on("playTrack")
def socket_play_track(data: Optional[Dict[str, Any]]) -> None:
    if is_dm_socket():
        emit("playTrack", data, broadcast=True, include_self=False)


@socketio.on("pauseTrack")
def socket_pause_track(data: Optional[Dict[str, Any]]) -> None:
    if is_dm_socket():
        emit("pauseTrack", data, broadcast=True, include_self=False)


@socketio.on("setTrackVolume")
def socket_track_volume(data: Optional[Dict[str, Any]]) -> None:
    if is_dm_socket():
        emit("setTrackVolume", data, broadcast=True, include_self=False)


@socketio.on("deleteTrack")
def socket_delete_track(data: Optional[Dict[str, Any]]) -> None:
    if is_dm_socket():
        emit("deleteTrack", data, broadcast=True, include_self=False)


@socketio.on("addTrack")
def socket_add_track(data: Optional[Dict[str, Any]]) -> None:
    if is_dm_socket():
        emit("addTrack", data, broadcast=True, include_self=False)


@socketio.on("updateInitiative")
def socket_update_initiative(data: Optional[Dict[str, Any]]) -> None:
    global initiative_state
    if not is_dm_socket():
        return
    initiative_state = data
    socketio.emit("updateInitiative", data)


@socketio.on("toggleGrid")
def socket_toggle_grid(data: Optional[Dict[str, Any]]) -> None:
    global grid_state
    if not is_dm_socket():
        return
    grid_state = data
    emit("toggleGrid", data, to="player", include_self=False)


@socketio.on("snapView")
def socket_snap_view(data: Optional[Dict[str, Any]]) -> None:
    if not is_dm_socket():
        return
    if data and data.get("sceneId"):
        scene_store.change_active_scene(data.get("sceneId"))
    emit("snapView", data, to="player", include_self=False)


@socketio.on("setBgColor")
def socket_set_bg_color(data: Optional[Dict[str, Any]]) -> None:
    global bg_color
    if not is_dm_socket():
        return
    bg_color = (data or {}).get("color")
    emit("setBgColor", data, to="player", include_self=False)


@socketio.on("pingScene")
def socket_ping_scene(data: Optional[Dict[str, Any]]) -> None:
    emit("pingScene", data, broadcast=True, include_self=False)


@socketio.on("rollDice")
def socket_roll_dice(payload: Optional[Any]) -> None:
    raw_notation = payload if isinstance(payload, str) else (payload or {}).get("notation")
    colorset = (payload or {}).get("colorset", "white") if isinstance(payload, dict) else "white"
    texture = (payload or {}).get("texture", "") if isinstance(payload, dict) else ""
    result = server_roll(raw_notation)
    socketio.emit("diceRolled", {"notation": result["notation"], "colorset": colorset, "texture": texture})
    socketio.emit("diceResult", {"text": result["text"], "color": result["color"]})


@socketio.on("clearDice")
def socket_clear_dice() -> None:
    socketio.emit("diceCleared")


@socketio.on("addTokenFromLibrary")
def socket_add_token_from_library(data: Optional[Dict[str, Any]]) -> None:
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
        "visibleToPlayers": True,
    }
    history.before_mutation(scene_store.active_scene_id)
    scene_store.add_token(scene_store.active_scene_id, token)
    socketio.emit("addToken", {"sceneId": scene_store.active_scene_id, "token": token}, to="dm")
    if is_token_visible_to_players(token):
        socketio.emit("addToken", {"sceneId": scene_store.active_scene_id, "token": token}, to="player")
    can_undo, can_redo = history.state(scene_store.active_scene_id)
    socketio.emit("undoRedoState", {"canUndo": can_undo, "canRedo": can_redo}, to="dm")


def _apply_snapshot_and_broadcast(scene_id: str, snapshot: Dict[str, Any]) -> None:
    scene = scene_store.scenes.get(scene_id) or scene_store.load_scene(scene_id)
    scene["tokens"] = snapshot["tokens"]
    scene["walls"] = snapshot.get("walls", [])
    scene_store.save_scene(scene)
    socketio.emit("sceneData", scene, to="dm")
    filtered = dict(scene)
    filtered["tokens"] = [t for t in scene.get("tokens", []) if is_token_visible_to_players(t)]
    filtered.pop("walls", None)
    socketio.emit("sceneData", filtered, to="player")
    socketio.emit("wallsData", {"sceneId": scene_id, "walls": scene.get("walls", [])}, to="player")
    can_undo, can_redo = history.state(scene_id)
    socketio.emit("undoRedoState", {"canUndo": can_undo, "canRedo": can_redo}, to="dm")


@socketio.on("undo")
def socket_undo(data: Optional[Dict[str, Any]]) -> None:
    if not is_dm_socket():
        return
    scene_id = scene_store.active_scene_id
    if not scene_id:
        return
    snapshot = history.undo(scene_id)
    if snapshot is None:
        return
    _apply_snapshot_and_broadcast(scene_id, snapshot)


@socketio.on("redo")
def socket_redo(data: Optional[Dict[str, Any]]) -> None:
    if not is_dm_socket():
        return
    scene_id = scene_store.active_scene_id
    if not scene_id:
        return
    snapshot = history.redo(scene_id)
    if snapshot is None:
        return
    _apply_snapshot_and_broadcast(scene_id, snapshot)


def main() -> None:
    parser = argparse.ArgumentParser(description="DungeonSmith VTT")
    parser.add_argument(
        "--campaign",
        default=None,
        help="Active campaign name (overrides VTT_CAMPAIGN and .campaign marker)",
    )
    args = parser.parse_args()

    campaign_name = resolve_campaign_name(
        cli=args.campaign,
        env=os.environ.get("VTT_CAMPAIGN"),
        marker_path=CAMPAIGN_MARKER_FILE,
    )
    if not is_valid_campaign_name(campaign_name):
        logger.error("Invalid campaign name: %r", campaign_name)
        sys.exit(1)

    initialize_runtime(campaign_name)

    secrets = read_secrets()
    app.config["DM_PASSWORD"] = secrets.get("DM_PASSWORD") or DEFAULT_SECRETS["DM_PASSWORD"]
    app.config["PLAYER_PASSWORD"] = secrets.get("PLAYER_PASSWORD") or DEFAULT_SECRETS["PLAYER_PASSWORD"]

    port = int(os.environ.get("VTT_PORT", "3000"))
    print(f"Passwords loaded from: {SECRET_FILE}")
    print(f"Project folder: {BASE_DIR}")
    print(f"Public folder: {UI_PUBLIC_DIR}")
    print(f"Campaign: {campaign_name} ({campaign_paths.root_dir})")
    print(f"DM Password: {app.config['DM_PASSWORD']}")
    print(f"Player Password: {app.config['PLAYER_PASSWORD']}")
    socketio.run(app, host="0.0.0.0", port=port, allow_unsafe_werkzeug=True)


if __name__ == "__main__":
    main()
