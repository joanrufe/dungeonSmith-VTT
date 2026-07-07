from __future__ import annotations

import io
import json
import shutil
from pathlib import Path

import app as app_module


DEFAULT_CAMPAIGN = "Sola en la oscuridad"


# ── Campaign name resolution ────────────────────────────────────────────────


def test_resolve_cli_overrides_env_and_marker(tmp_path, monkeypatch):
    """--campaign beats VTT_CAMPAIGN which beats .campaign marker."""
    marker = tmp_path / ".campaign"
    marker.write_text("Marker\n", encoding="utf-8")

    name = app_module.resolve_campaign_name(
        cli="Cli",
        env="Env",
        marker_path=marker,
    )
    assert name == "Cli"


def test_resolve_env_overrides_marker(tmp_path, monkeypatch):
    marker = tmp_path / ".campaign"
    marker.write_text("Marker\n", encoding="utf-8")

    name = app_module.resolve_campaign_name(
        cli=None,
        env="Env",
        marker_path=marker,
    )
    assert name == "Env"


def test_resolve_marker_used_when_no_env(tmp_path, monkeypatch):
    marker = tmp_path / ".campaign"
    marker.write_text("Curse-of-Strahd\n", encoding="utf-8")

    name = app_module.resolve_campaign_name(
        cli=None,
        env=None,
        marker_path=marker,
    )
    assert name == "Curse-of-Strahd"


def test_resolve_marker_trims_whitespace(tmp_path, monkeypatch):
    marker = tmp_path / ".campaign"
    marker.write_text("  Strahd  \n", encoding="utf-8")

    name = app_module.resolve_campaign_name(marker_path=marker)
    assert name == "Strahd"


def test_resolve_default_when_no_sources(tmp_path, monkeypatch):
    marker = tmp_path / ".does-not-exist"

    name = app_module.resolve_campaign_name(
        cli=None,
        env=None,
        marker_path=marker,
    )
    assert name == DEFAULT_CAMPAIGN


# ── Campaign name validation ────────────────────────────────────────────────


def test_is_valid_campaign_name_accepts_valid():
    assert app_module.is_valid_campaign_name("Curse-of-Strahd") is True
    assert app_module.is_valid_campaign_name("Sola en la oscuridad") is True
    assert app_module.is_valid_campaign_name("Waterdeep") is True


def test_is_valid_campaign_name_rejects_empty_or_whitespace():
    assert app_module.is_valid_campaign_name("") is False
    assert app_module.is_valid_campaign_name("   ") is False


def test_is_valid_campaign_name_rejects_path_unsafe_names():
    assert app_module.is_valid_campaign_name("../etc") is False
    assert app_module.is_valid_campaign_name("a/../b") is False
    assert app_module.is_valid_campaign_name("Strahd/secret") is False
    assert app_module.is_valid_campaign_name("Strahd\\secret") is False
    assert app_module.is_valid_campaign_name("..") is False
    assert app_module.is_valid_campaign_name(".hidden") is False


def test_validate_campaign_name_returns_stripped_name():
    assert app_module.validate_campaign_name("  Strahd  ") == "Strahd"


def test_validate_campaign_name_raises_on_invalid():
    try:
        app_module.validate_campaign_name("../bad")
    except ValueError as exc:
        assert "Invalid campaign name" in str(exc)
    else:
        raise AssertionError("Expected ValueError for path-unsafe campaign name")


# ── Campaign path building ──────────────────────────────────────────────────


def test_campaign_paths_from_root():
    root = Path("/x/campaigns/Curse-of-Strahd")
    paths = app_module.CampaignPaths.from_root(root)

    assert paths.root_dir == root
    assert paths.data_dir == root / "data"
    assert paths.scenes_dir == root / "data" / "scenes"
    assert paths.backups_dir == root / "data" / "scenes" / "backups"
    assert paths.notes_file == root / "data" / "sticky-notes.json"
    assert paths.backup_state_file == root / "data" / "scenes-backup-state.json"
    assert paths.public_dir == root / "public"
    assert paths.uploads_dir == root / "public" / "uploads"
    assert paths.media_dir == root / "public" / "media"
    assert paths.music_dir == root / "public" / "music"
    assert paths.player_media_dir == root / "public" / "player-media"


def test_campaign_paths_ensure_dirs(tmp_path):
    root = tmp_path / "new-campaign"
    paths = app_module.CampaignPaths.from_root(root)

    assert not paths.scenes_dir.exists()
    paths.ensure_dirs()
    assert paths.scenes_dir.is_dir()
    assert paths.uploads_dir.is_dir()
    assert paths.media_dir.is_dir()
    assert paths.music_dir.is_dir()
    assert paths.player_media_dir.is_dir()


def test_campaign_paths_metadata_file(tmp_path):
    root = tmp_path / "campaigns" / "Curse-of-Strahd"
    paths = app_module.CampaignPaths.from_root(root)
    assert paths.metadata_file == root / "Curse-of-Strahd.campaign"


def test_campaign_paths_metadata_file_preserves_spaces(tmp_path):
    root = tmp_path / "campaigns" / "Sola en la oscuridad"
    paths = app_module.CampaignPaths.from_root(root)
    assert paths.metadata_file == root / "Sola en la oscuridad.campaign"


# ── Campaign metadata helpers ───────────────────────────────────────────────


def test_ensure_campaign_metadata_creates_file(tmp_path):
    root = tmp_path / "campaigns" / "Test"
    paths = app_module.CampaignPaths.from_root(root)
    paths.root_dir.mkdir(parents=True)

    app_module.ensure_campaign_metadata(paths, "Test", "A test campaign")

    assert paths.metadata_file.exists()
    data = json.loads(paths.metadata_file.read_text(encoding="utf-8"))
    assert data["name"] == "Test"
    assert data["description"] == "A test campaign"
    assert "createdAt" in data


def test_ensure_campaign_metadata_does_not_overwrite(tmp_path):
    root = tmp_path / "campaigns" / "Test"
    paths = app_module.CampaignPaths.from_root(root)
    paths.root_dir.mkdir(parents=True)
    paths.metadata_file.write_text(
        json.dumps({
            "name": "Existing",
            "description": "Old",
            "createdAt": "2020-01-01T00:00:00+00:00",
        }),
        encoding="utf-8",
    )

    app_module.ensure_campaign_metadata(paths, "Test", "New")

    data = json.loads(paths.metadata_file.read_text(encoding="utf-8"))
    assert data["name"] == "Existing"
    assert data["description"] == "Old"
    assert data["createdAt"] == "2020-01-01T00:00:00+00:00"


def test_write_campaign_marker(tmp_path):
    marker = tmp_path / ".campaign"
    app_module.write_campaign_marker("Target-Campaign", marker_path=marker)
    assert marker.read_text(encoding="utf-8") == "Target-Campaign\n"


def test_discover_campaigns_sorted(tmp_path):
    for name in ["Beta", "Alpha"]:
        root = tmp_path / name
        root.mkdir(parents=True)
        (root / f"{name}.campaign").write_text(
            json.dumps({
                "name": name,
                "description": f"{name} desc",
                "createdAt": "2024-01-01T00:00:00+00:00",
            }),
            encoding="utf-8",
        )

    campaigns = app_module.discover_campaigns(campaigns_dir=tmp_path)

    assert len(campaigns) == 2
    assert campaigns[0]["name"] == "Alpha"
    assert campaigns[0]["description"] == "Alpha desc"
    assert campaigns[0]["folder"] == "Alpha"
    assert campaigns[0]["createdAt"] == "2024-01-01T00:00:00+00:00"
    assert campaigns[1]["name"] == "Beta"


def test_discover_campaigns_skips_unreadable(tmp_path):
    good_root = tmp_path / "Good"
    good_root.mkdir()
    (good_root / "Good.campaign").write_text(
        json.dumps({"name": "Good"}),
        encoding="utf-8",
    )

    bad_root = tmp_path / "Bad"
    bad_root.mkdir()
    (bad_root / "Bad.campaign").write_text("not json", encoding="utf-8")

    campaigns = app_module.discover_campaigns(campaigns_dir=tmp_path)

    assert len(campaigns) == 1
    assert campaigns[0]["name"] == "Good"


def test_create_campaign(tmp_path, monkeypatch):
    monkeypatch.setattr(app_module, "CAMPAIGNS_DIR", tmp_path)
    paths = app_module.create_campaign("New-Campaign", "Description")

    assert paths.root_dir.is_dir()
    assert paths.metadata_file.exists()
    data = json.loads(paths.metadata_file.read_text(encoding="utf-8"))
    assert data["name"] == "New-Campaign"
    assert data["description"] == "Description"
    assert "createdAt" in data
    assert paths.scenes_dir.is_dir()
    assert paths.uploads_dir.is_dir()
    assert paths.media_dir.is_dir()
    assert paths.music_dir.is_dir()
    assert paths.player_media_dir.is_dir()


# ── Legacy data migration ───────────────────────────────────────────────────


def _make_legacy_runtime(base: Path) -> None:
    """Create flat legacy runtime dirs/files under base."""
    scenes = base / "data" / "scenes"
    scenes.mkdir(parents=True)
    (scenes / "tavern.json").write_text('{"sceneId": "tavern"}', encoding="utf-8")
    (base / "data" / "sticky-notes.json").write_text("[]", encoding="utf-8")
    (base / "data" / "scenes-backup-state.json").write_text('{"tavern": 3}', encoding="utf-8")

    uploads = base / "public" / "uploads"
    uploads.mkdir(parents=True)
    (uploads / "token.png").write_text("png", encoding="utf-8")

    media = base / "public" / "media"
    media.mkdir(parents=True)
    (media / "village.jpg").write_text("jpg", encoding="utf-8")

    music = base / "public" / "music"
    music.mkdir(parents=True)
    (music / "battle.mp3").write_text("mp3", encoding="utf-8")

    player_media = base / "public" / "player-media"
    player_media.mkdir(parents=True)
    (player_media / "handout.pdf").write_text("pdf", encoding="utf-8")

    # Passwords must stay untouched
    private = base / "data" / "private"
    private.mkdir(parents=True)
    (private / "secrets.txt").write_text("DM_PASSWORD=KEEP\n", encoding="utf-8")


def test_migrate_legacy_runtime_data_moves_runtime_state(tmp_path):
    base = tmp_path / "legacy-root"
    _make_legacy_runtime(base)

    campaign_root = tmp_path / "campaigns" / DEFAULT_CAMPAIGN
    paths = app_module.CampaignPaths.from_root(campaign_root)

    app_module.migrate_legacy_runtime_data(paths, base_dir=base)

    assert (campaign_root / "data" / "scenes" / "tavern.json").exists()
    assert (campaign_root / "data" / "sticky-notes.json").exists()
    assert (campaign_root / "data" / "scenes-backup-state.json").exists()
    assert (campaign_root / "public" / "uploads" / "token.png").exists()
    assert (campaign_root / "public" / "media" / "village.jpg").exists()
    assert (campaign_root / "public" / "music" / "battle.mp3").exists()
    assert (campaign_root / "public" / "player-media" / "handout.pdf").exists()

    # Sources should be gone after verified copy+delete
    assert not (base / "data" / "scenes" / "tavern.json").exists()
    assert not (base / "public" / "media" / "village.jpg").exists()

    # A timestamped backup of the migrated runtime data should exist
    data_backups = list((base / "data").glob(".migration-backup-*"))
    public_backups = list((base / "public").glob(".migration-backup-*"))
    assert len(data_backups) == 1
    assert len(public_backups) == 1
    backup_data = data_backups[0]
    backup_public = public_backups[0]
    assert (backup_data / "scenes" / "tavern.json").exists()
    assert (backup_data / "sticky-notes.json").exists()
    assert (backup_data / "scenes-backup-state.json").exists()
    assert (backup_public / "uploads" / "token.png").exists()
    assert (backup_public / "media" / "village.jpg").exists()
    assert (backup_public / "music" / "battle.mp3").exists()
    assert (backup_public / "player-media" / "handout.pdf").exists()

    # Secrets stay global / untouched
    assert not (campaign_root / "data" / "private").exists()
    assert (base / "data" / "private" / "secrets.txt").read_text(encoding="utf-8") == "DM_PASSWORD=KEEP\n"


def test_migrate_legacy_runtime_data_creates_backup(tmp_path):
    base = tmp_path / "legacy-root"
    _make_legacy_runtime(base)

    campaign_root = tmp_path / "campaigns" / DEFAULT_CAMPAIGN
    paths = app_module.CampaignPaths.from_root(campaign_root)

    app_module.migrate_legacy_runtime_data(paths, base_dir=base)

    data_backups = list((base / "data").glob(".migration-backup-*"))
    public_backups = list((base / "public").glob(".migration-backup-*"))
    assert len(data_backups) == 1
    assert len(public_backups) == 1

    backup_data = data_backups[0]
    backup_public = public_backups[0]
    assert (backup_data / "scenes" / "tavern.json").exists()
    assert (backup_data / "sticky-notes.json").read_text(encoding="utf-8") == "[]"
    assert (backup_data / "scenes-backup-state.json").read_text(encoding="utf-8") == '{"tavern": 3}'
    assert (backup_public / "uploads" / "token.png").exists()
    assert (backup_public / "media" / "village.jpg").exists()
    assert (backup_public / "music" / "battle.mp3").exists()
    assert (backup_public / "player-media" / "handout.pdf").exists()

    # Backup must mirror the original content, not the campaign destination
    assert (
        backup_data / "scenes" / "tavern.json"
    ).read_text(encoding="utf-8") == '{"sceneId": "tavern"}'


def test_migrate_legacy_runtime_data_leaves_source_on_failure(tmp_path, monkeypatch):
    base = tmp_path / "legacy-root"
    _make_legacy_runtime(base)

    campaign_root = tmp_path / "campaigns" / DEFAULT_CAMPAIGN
    paths = app_module.CampaignPaths.from_root(campaign_root)

    real_copytree = shutil.copytree

    def _failing_copytree(src, dst, **kwargs):
        # Fail only when copying into the campaign tree, not during backup
        if ".migration-backup" not in str(dst):
            raise PermissionError(f"simulated failure copying {src} to {dst}")
        return real_copytree(src, dst, **kwargs)

    monkeypatch.setattr(shutil, "copytree", _failing_copytree)

    app_module.migrate_legacy_runtime_data(paths, base_dir=base)

    # The directory that failed mid-copy must remain intact
    assert (base / "data" / "scenes" / "tavern.json").exists()
    assert not (campaign_root / "data" / "scenes" / "tavern.json").exists()

    # Items copied successfully (files use copyfile, not copytree) may be removed
    assert (campaign_root / "data" / "sticky-notes.json").exists()


def test_migrate_legacy_skips_collisions_and_logs(tmp_path, caplog):
    base = tmp_path / "legacy-root"
    _make_legacy_runtime(base)

    campaign_root = tmp_path / "campaigns" / DEFAULT_CAMPAIGN
    paths = app_module.CampaignPaths.from_root(campaign_root)
    paths.data_dir.mkdir(parents=True)
    (paths.notes_file).write_text("[existing]", encoding="utf-8")

    app_module.migrate_legacy_runtime_data(paths, base_dir=base)

    # Collision skipped
    assert (paths.notes_file).read_text(encoding="utf-8") == "[existing]"
    # Non-colliding items still moved
    assert (campaign_root / "data" / "scenes" / "tavern.json").exists()


def test_migrate_legacy_creates_empty_tree_when_no_legacy(tmp_path):
    base = tmp_path / "clean-root"
    base.mkdir()

    campaign_root = tmp_path / "campaigns" / DEFAULT_CAMPAIGN
    paths = app_module.CampaignPaths.from_root(campaign_root)

    app_module.migrate_legacy_runtime_data(paths, base_dir=base)

    assert paths.scenes_dir.is_dir()
    assert paths.uploads_dir.is_dir()
    assert paths.media_dir.is_dir()
    assert paths.music_dir.is_dir()
    assert paths.player_media_dir.is_dir()


def test_initialize_runtime_creates_metadata_for_legacy_campaign(tmp_path, monkeypatch):
    monkeypatch.setattr(app_module, "CAMPAIGNS_DIR", tmp_path)
    monkeypatch.setattr(app_module, "BASE_DIR", tmp_path)
    monkeypatch.setattr(app_module, "CAMPAIGN_MARKER_FILE", tmp_path / ".campaign")
    name = "Legacy-Campaign"
    root = tmp_path / name
    root.mkdir(parents=True)
    paths = app_module.CampaignPaths.from_root(root)
    paths.ensure_dirs()

    app_module.initialize_runtime(name)

    assert app_module.campaign_paths.metadata_file.exists()
    data = json.loads(app_module.campaign_paths.metadata_file.read_text(encoding="utf-8"))
    assert data["name"] == name
    assert data["description"] == ""


def test_initialize_runtime_forces_default_when_legacy_data_exists(tmp_path, monkeypatch, caplog):
    """If flat legacy data still exists and the default campaign does not, force default."""
    monkeypatch.setattr(app_module, "CAMPAIGNS_DIR", tmp_path)
    monkeypatch.setattr(app_module, "BASE_DIR", tmp_path)
    monkeypatch.setattr(app_module, "CAMPAIGN_MARKER_FILE", tmp_path / ".campaign")

    # Create flat legacy runtime data
    legacy_scenes = tmp_path / "data" / "scenes"
    legacy_scenes.mkdir(parents=True)
    (legacy_scenes / "scene.json").write_text("{}", encoding="utf-8")

    with caplog.at_level("WARNING", logger="app"):
        app_module.initialize_runtime("Target")

    assert app_module.active_campaign_name == app_module.DEFAULT_CAMPAIGN_NAME
    assert (tmp_path / ".campaign").read_text(encoding="utf-8").strip() == app_module.DEFAULT_CAMPAIGN_NAME
    assert (tmp_path / app_module.DEFAULT_CAMPAIGN_NAME / "data" / "scenes" / "scene.json").exists()

    # A loud warning must explain that the explicit campaign selection was overridden
    assert any(
        "overridden" in record.message.lower() and "legacy" in record.message.lower()
        for record in caplog.records
    ), "Expected warning that explicit campaign selection was overridden by legacy migration"


# ── Runtime state scoping (integration with Flask app) ──────────────────────


def test_get_campaigns_requires_dm(client):
    resp = client.get("/campaigns")
    assert resp.status_code == 403
    data = json.loads(resp.data)
    assert data["error"] == "DM access required"


def test_get_campaigns_returns_active_and_list(dm_client, tmp_data, monkeypatch):
    monkeypatch.setattr(app_module, "CAMPAIGNS_DIR", tmp_data)
    resp = dm_client.get("/campaigns")
    assert resp.status_code == 200
    data = json.loads(resp.data)
    assert "campaigns" in data
    assert "active" in data
    assert data["active"] == app_module.campaign_paths.root_dir.name
    names = [c["name"] for c in data["campaigns"]]
    assert data["active"] in names


def test_get_campaigns_includes_other_campaigns(dm_client, tmp_data, monkeypatch):
    monkeypatch.setattr(app_module, "CAMPAIGNS_DIR", tmp_data)
    app_module.create_campaign("Second", "Another campaign")

    resp = dm_client.get("/campaigns")
    assert resp.status_code == 200
    data = json.loads(resp.data)
    names = [c["name"] for c in data["campaigns"]]
    assert "Second" in names
    assert "campaign" in names


# ── Campaign creation endpoint ──────────────────────────────────────────────


def test_post_campaigns_requires_dm(client):
    resp = client.post(
        "/campaigns",
        data=json.dumps({"name": "New"}),
        content_type="application/json",
    )
    assert resp.status_code == 403
    data = json.loads(resp.data)
    assert data["error"] == "DM access required"


def test_post_campaigns_creates_campaign(dm_client, tmp_data, monkeypatch):
    monkeypatch.setattr(app_module, "CAMPAIGNS_DIR", tmp_data)
    resp = dm_client.post(
        "/campaigns",
        data=json.dumps({"name": "New", "description": "Desc"}),
        content_type="application/json",
    )
    assert resp.status_code == 201
    data = json.loads(resp.data)
    assert data["success"] is True
    assert data["name"] == "New"
    assert (tmp_data / "New" / "New.campaign").exists()
    metadata = json.loads((tmp_data / "New" / "New.campaign").read_text(encoding="utf-8"))
    assert metadata["name"] == "New"
    assert metadata["description"] == "Desc"


def test_post_campaigns_duplicate_returns_409(dm_client, tmp_data, monkeypatch):
    monkeypatch.setattr(app_module, "CAMPAIGNS_DIR", tmp_data)
    dm_client.post(
        "/campaigns",
        data=json.dumps({"name": "New"}),
        content_type="application/json",
    )
    resp = dm_client.post(
        "/campaigns",
        data=json.dumps({"name": "New"}),
        content_type="application/json",
    )
    assert resp.status_code == 409


def test_post_campaigns_invalid_name(dm_client):
    resp = dm_client.post(
        "/campaigns",
        data=json.dumps({"name": ""}),
        content_type="application/json",
    )
    assert resp.status_code == 400


# ── Campaign switch endpoint ────────────────────────────────────────────────


def test_post_campaigns_switch_requires_dm(client):
    resp = client.post(
        "/campaigns/switch",
        data=json.dumps({"name": "New"}),
        content_type="application/json",
    )
    assert resp.status_code == 403
    data = json.loads(resp.data)
    assert data["error"] == "DM access required"


def test_post_campaigns_switch_writes_marker(dm_client, tmp_data, monkeypatch):
    monkeypatch.setattr(app_module, "CAMPAIGNS_DIR", tmp_data)
    app_module.create_campaign("Target")
    marker = tmp_data / ".campaign"
    monkeypatch.setattr(app_module, "CAMPAIGN_MARKER_FILE", marker)

    resp = dm_client.post(
        "/campaigns/switch",
        data=json.dumps({"name": "Target"}),
        content_type="application/json",
    )

    assert resp.status_code == 200
    data = json.loads(resp.data)
    assert data["success"] is True
    assert data["restartRequired"] is True
    assert marker.read_text(encoding="utf-8") == "Target\n"


def test_post_campaigns_switch_missing_campaign_writes_marker(dm_client, tmp_data, monkeypatch):
    monkeypatch.setattr(app_module, "CAMPAIGNS_DIR", tmp_data)
    marker = tmp_data / ".campaign"
    monkeypatch.setattr(app_module, "CAMPAIGN_MARKER_FILE", marker)

    resp = dm_client.post(
        "/campaigns/switch",
        data=json.dumps({"name": "Missing"}),
        content_type="application/json",
    )

    assert resp.status_code == 200
    data = json.loads(resp.data)
    assert data["success"] is True
    assert data["restartRequired"] is True
    assert marker.read_text(encoding="utf-8") == "Missing\n"


def test_post_campaigns_switch_invalid_name(dm_client):
    resp = dm_client.post(
        "/campaigns/switch",
        data=json.dumps({"name": ""}),
        content_type="application/json",
    )
    assert resp.status_code == 400


def test_dm_page_contains_campaign_selector(dm_client):
    resp = dm_client.get("/dm")
    assert resp.status_code == 200
    html = resp.data.decode("utf-8")
    assert 'id="campaign-dropdown-btn"' in html
    assert 'id="campaign-dropdown-menu"' in html
    assert 'id="campaign-restart-overlay"' in html


def test_dm_page_contains_active_campaign_name(dm_client):
    resp = dm_client.get("/dm")
    assert resp.status_code == 200
    html = resp.data.decode("utf-8")
    active = app_module.active_campaign_name
    assert f'id="campaign-dropdown-label">{active}</span>' in html


def test_static_media_route_serves_campaign_file(dm_client, tmp_data):
    campaign_media = app_module.campaign_paths.media_dir
    campaign_media.mkdir(parents=True, exist_ok=True)
    (campaign_media / "village.jpg").write_text("campaign-image", encoding="utf-8")

    resp = dm_client.get("/media/village.jpg")
    assert resp.status_code == 200
    assert resp.data.decode("utf-8") == "campaign-image"


def test_static_media_route_missing_returns_404(dm_client, tmp_data):
    resp = dm_client.get("/media/missing.jpg")
    assert resp.status_code == 404


def test_upload_endpoint_stores_in_campaign_uploads(dm_client, tmp_data):
    data = {"file": (io.BytesIO(b"file-content"), "drop.png", "image/png")}
    resp = dm_client.post(
        "/upload",
        data=data,
        content_type="multipart/form-data",
    )
    assert resp.status_code == 200
    payload = json.loads(resp.data)
    assert payload["imageUrl"].startswith("/uploads/")

    filename = payload["imageUrl"].replace("/uploads/", "")
    assert (app_module.campaign_paths.uploads_dir / filename).exists()


def test_scene_store_uses_campaign_paths(tmp_data):
    store = app_module.scene_store
    store.save_scene({"sceneId": "s1", "sceneName": "Test", "tokens": []}, count_save=False)
    assert (app_module.campaign_paths.scenes_dir / "s1.json").exists()


def test_sticky_notes_persist_to_campaign(dm_client, tmp_data):
    notes = [{"id": "n1", "x": 10, "y": 20, "w": 100, "h": 80, "color": "yellow", "text": "hi"}]
    resp = dm_client.post(
        "/sticky-notes",
        data=json.dumps(notes),
        content_type="application/json",
    )
    assert resp.status_code == 200
    assert (app_module.campaign_paths.notes_file).exists()
    saved = json.loads((app_module.campaign_paths.notes_file).read_text(encoding="utf-8"))
    assert saved == notes


def test_media_list_is_campaign_scoped(dm_client, player_client, tmp_data):
    # Seed a campaign media file
    app_module.campaign_paths.media_dir.mkdir(parents=True, exist_ok=True)
    (app_module.campaign_paths.media_dir / "village.jpg").write_text("jpg", encoding="utf-8")

    resp = player_client.get("/mediaList")
    assert resp.status_code == 200
    data = json.loads(resp.data)
    root_names = [f["name"] for f in data["rootFiles"]]
    assert "village.jpg" in root_names
