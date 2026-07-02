from __future__ import annotations

import json

import app as app_module


def test_dm_login_success(client):
    """POST /dm-login with correct DM password redirects to /dm."""
    resp = client.post("/dm-login", data={"password": "DMCODE"})
    assert resp.status_code == 302
    assert "/dm" in resp.headers["Location"]


def test_player_login_success(client):
    """POST /player-login with correct player password redirects to /."""
    resp = client.post("/player-login", data={"password": "PLAY"})
    assert resp.status_code == 302
    assert "/" in resp.headers["Location"]


def test_wrong_password_rejected(client):
    """POST /dm-login with wrong password returns 200 (stays on page, no redirect)."""
    resp = client.post("/dm-login", data={"password": "WRONG"})
    assert resp.status_code == 200


def test_player_wrong_password_rejected(client):
    """POST /player-login with wrong password returns 200 (stays on page, no redirect)."""
    resp = client.post("/player-login", data={"password": "WRONG"})
    assert resp.status_code == 200


def test_get_scenes_empty(dm_client):
    """GET /scenes returns 200 and empty scenes list when no scenes exist."""
    resp = dm_client.get("/scenes")
    assert resp.status_code == 200
    data = json.loads(resp.data)
    assert data == {"scenes": []}


def test_create_and_list_scene(dm_client):
    """POST /createScene then GET /scenes shows the new scene."""
    create_resp = dm_client.post(
        "/createScene",
        data=json.dumps({"sceneName": "Test Scene"}),
        content_type="application/json",
    )
    assert create_resp.status_code == 200
    created = json.loads(create_resp.data)
    assert "sceneId" in created
    scene_id = created["sceneId"]

    list_resp = dm_client.get("/scenes")
    assert list_resp.status_code == 200
    scenes_data = json.loads(list_resp.data)
    scene_ids = [s["sceneId"] for s in scenes_data["scenes"]]
    assert scene_id in scene_ids


def test_get_sticky_notes_empty(dm_client):
    """GET /sticky-notes returns 200 and empty list when notes file is empty."""
    resp = dm_client.get("/sticky-notes")
    assert resp.status_code == 200
    data = json.loads(resp.data)
    assert data == []


def test_post_sticky_notes(dm_client):
    """POST /sticky-notes with valid payload returns 200 and {ok: true}."""
    notes = [{"id": "n1", "x": 10, "y": 20, "w": 100, "h": 80, "color": "yellow", "text": "hi"}]
    resp = dm_client.post(
        "/sticky-notes",
        data=json.dumps(notes),
        content_type="application/json",
    )
    assert resp.status_code == 200
    data = json.loads(resp.data)
    assert data == {"ok": True}


def test_unauth_redirect(client):
    """GET /dm without session redirects to /dm-login."""
    resp = client.get("/dm")
    assert resp.status_code == 302
    assert "/dm-login" in resp.headers["Location"]


# ── Fog of War Tier 2 smoke tests ──────────────────────────────────────────


def _make_scene_with_token(dm_client, scene_name: str = "FogTest") -> tuple[str, str]:
    """Helper: create a scene and add a token via HTTP. Returns (scene_id, token_id)."""
    create_resp = dm_client.post(
        "/createScene",
        data=json.dumps({"sceneName": scene_name}),
        content_type="application/json",
    )
    scene_id = json.loads(create_resp.data)["sceneId"]

    token_id = "test-token-1"
    token = {
        "tokenId": token_id,
        "sceneId": scene_id,
        "imageUrl": "/uploads/test.png",
        "mediaType": "image",
        "x": 100.0,
        "y": 100.0,
        "width": 60.0,
        "height": 60.0,
        "rotation": 0.0,
        "zIndex": 1,
        "movableByPlayers": False,
        "hidden": False,
    }
    app_module.scene_store.add_token(scene_id, token)
    return scene_id, token_id


def test_vision_radius_and_is_map_round_trip(dm_socket, tmp_data):
    """
    DM emits updateToken with visionRadius and isMap; values persist in scene JSON
    and are present in subsequent sceneData responses.
    """
    # Create scene + token directly via store (dm_socket fixture already has tmp_data)
    scene_id = "fog-scene-1"
    app_module.scene_store.scenes[scene_id] = {
        "sceneId": scene_id,
        "sceneName": "FogScene",
        "tokens": [],
    }
    token_id = "tok-1"
    app_module.scene_store.add_token(scene_id, {
        "tokenId": token_id,
        "sceneId": scene_id,
        "imageUrl": "/uploads/t.png",
        "mediaType": "image",
        "x": 0.0, "y": 0.0,
        "width": 60.0, "height": 60.0,
        "rotation": 0.0,
        "zIndex": 1,
        "movableByPlayers": False,
        "hidden": False,
    })

    # DM emits updateToken with new fog properties
    dm_socket.emit("updateToken", {
        "sceneId": scene_id,
        "tokenId": token_id,
        "properties": {"visionRadius": 150.0, "isMap": False},
    })

    # Read the persisted scene JSON and confirm values
    scene = app_module.scene_store.load_scene(scene_id)
    token = next(t for t in scene["tokens"] if t["tokenId"] == token_id)
    assert token["visionRadius"] == 150.0
    assert token["isMap"] is False

    # Also request sceneData and confirm values arrive
    dm_socket.emit("loadScene", {"sceneId": scene_id})
    received = dm_socket.get_received()
    scene_data_events = [e for e in received if e["name"] == "sceneData"]
    assert scene_data_events, "Expected sceneData event"
    scene_payload = scene_data_events[-1]["args"][0]
    tok = next(t for t in scene_payload["tokens"] if t["tokenId"] == token_id)
    assert tok["visionRadius"] == 150.0
    assert tok["isMap"] is False


def test_vision_radius_negative_clamped_to_zero(dm_socket, tmp_data):
    """Negative visionRadius is coerced to 0 by the server."""
    scene_id = "fog-scene-2"
    app_module.scene_store.scenes[scene_id] = {
        "sceneId": scene_id,
        "sceneName": "FogScene2",
        "tokens": [],
    }
    token_id = "tok-2"
    app_module.scene_store.add_token(scene_id, {
        "tokenId": token_id,
        "sceneId": scene_id,
        "imageUrl": "/uploads/t.png",
        "mediaType": "image",
        "x": 0.0, "y": 0.0,
        "width": 60.0, "height": 60.0,
        "rotation": 0.0,
        "zIndex": 1,
        "movableByPlayers": False,
        "hidden": False,
    })

    dm_socket.emit("updateToken", {
        "sceneId": scene_id,
        "tokenId": token_id,
        "properties": {"visionRadius": -50},
    })

    scene = app_module.scene_store.load_scene(scene_id)
    token = next(t for t in scene["tokens"] if t["tokenId"] == token_id)
    assert token["visionRadius"] == 0.0, "Negative radius must be clamped to 0"


def test_player_scene_data_excludes_hidden_exposes_vision(player_socket, dm_socket, tmp_data):
    """
    Player loadScene response excludes hidden tokens and includes vision properties
    on visible tokens.
    """
    scene_id = "fog-scene-3"
    app_module.scene_store.scenes[scene_id] = {
        "sceneId": scene_id,
        "sceneName": "FogScene3",
        "tokens": [],
    }
    app_module.scene_store.active_scene_id = scene_id

    # Visible token with vision radius
    app_module.scene_store.add_token(scene_id, {
        "tokenId": "visible-tok",
        "sceneId": scene_id,
        "imageUrl": "/uploads/t.png",
        "mediaType": "image",
        "x": 0.0, "y": 0.0,
        "width": 60.0, "height": 60.0,
        "rotation": 0.0,
        "zIndex": 1,
        "movableByPlayers": False,
        "hidden": False,
        "visionRadius": 120.0,
        "isMap": False,
    })
    # Hidden token with vision radius — must not appear in player sceneData
    app_module.scene_store.add_token(scene_id, {
        "tokenId": "hidden-tok",
        "sceneId": scene_id,
        "imageUrl": "/uploads/t.png",
        "mediaType": "image",
        "x": 200.0, "y": 200.0,
        "width": 60.0, "height": 60.0,
        "rotation": 0.0,
        "zIndex": 2,
        "movableByPlayers": False,
        "hidden": True,
        "visionRadius": 80.0,
        "isMap": False,
    })

    player_socket.emit("loadScene", {"sceneId": scene_id})
    received = player_socket.get_received()
    scene_data_events = [e for e in received if e["name"] == "sceneData"]
    assert scene_data_events, "Expected sceneData event for player"

    scene_payload = scene_data_events[-1]["args"][0]
    token_ids = [t["tokenId"] for t in scene_payload["tokens"]]

    assert "visible-tok" in token_ids, "Visible token must appear in player sceneData"
    assert "hidden-tok" not in token_ids, "Hidden token must be excluded from player sceneData"

    visible = next(t for t in scene_payload["tokens"] if t["tokenId"] == "visible-tok")
    assert visible.get("visionRadius") == 120.0
    assert visible.get("isMap") is False


# ── Fog of War – Walls & Line of Sight smoke tests ─────────────────────────


def _make_scene_with_walls(dm_socket, tmp_data, walls=None):
    """Helper: create an empty scene and set it as active. Returns scene_id."""
    app_module.scene_store.active_scene_id = None
    dm_socket.emit("loadScene", {"sceneId": "no-scene"})
    dm_socket.get_received()

    scene_id = "wall-scene-1"
    app_module.scene_store.scenes[scene_id] = {
        "sceneId": scene_id,
        "sceneName": "WallScene",
        "tokens": [],
        "walls": walls or [],
    }
    app_module.scene_store.active_scene_id = scene_id
    return scene_id


def test_wall_add_persists(dm_socket, tmp_data):
    """DM emits addWall; wall persists in scene JSON and is broadcast back."""
    scene_id = _make_scene_with_walls(dm_socket, tmp_data)

    wall = {"wallId": "w1", "x1": 0.0, "y1": 0.0, "x2": 100.0, "y2": 0.0}
    dm_socket.emit("addWall", {"sceneId": scene_id, "wall": wall})

    scene = app_module.scene_store.load_scene(scene_id)
    assert len(scene["walls"]) == 1
    assert scene["walls"][0]["wallId"] == "w1"

    received = dm_socket.get_received()
    add_events = [e for e in received if e["name"] == "addWall"]
    assert add_events, "Expected addWall broadcast to DM room"


def test_player_scene_data_omits_walls_but_receives_walls_data(player_socket, dm_socket, tmp_data):
    """Player loadScene sceneData must not contain walls; wallsData carries geometry."""
    scene_id = "wall-scene-2"
    app_module.scene_store.scenes[scene_id] = {
        "sceneId": scene_id,
        "sceneName": "WallScene2",
        "tokens": [],
        "walls": [
            {"wallId": "w1", "x1": 0.0, "y1": 0.0, "x2": 100.0, "y2": 0.0},
        ],
    }
    app_module.scene_store.active_scene_id = scene_id

    player_socket.emit("loadScene", {"sceneId": scene_id})
    received = player_socket.get_received()

    scene_data_events = [e for e in received if e["name"] == "sceneData"]
    assert scene_data_events, "Expected sceneData for player"
    payload = scene_data_events[-1]["args"][0]
    assert "walls" not in payload, "Player sceneData must not expose walls"

    walls_data_events = [e for e in received if e["name"] == "wallsData"]
    assert walls_data_events, "Expected wallsData event for player"
    walls_payload = walls_data_events[-1]["args"][0]
    assert walls_payload["sceneId"] == scene_id
    assert len(walls_payload["walls"]) == 1
    assert walls_payload["walls"][0]["wallId"] == "w1"


def test_dm_scene_data_includes_walls(dm_socket, tmp_data):
    """DM loadScene sceneData includes the walls array."""
    scene_id = "wall-scene-3"
    app_module.scene_store.scenes[scene_id] = {
        "sceneId": scene_id,
        "sceneName": "WallScene3",
        "tokens": [],
        "walls": [
            {"wallId": "w1", "x1": 0.0, "y1": 0.0, "x2": 100.0, "y2": 0.0},
        ],
    }
    app_module.scene_store.active_scene_id = scene_id

    dm_socket.emit("loadScene", {"sceneId": scene_id})
    received = dm_socket.get_received()
    scene_data_events = [e for e in received if e["name"] == "sceneData"]
    assert scene_data_events, "Expected sceneData for DM"
    payload = scene_data_events[-1]["args"][0]
    assert "walls" in payload, "DM sceneData must include walls"
    assert payload["walls"][0]["wallId"] == "w1"


def test_update_wall(dm_socket, tmp_data):
    """DM emits updateWall; endpoints are mutated and broadcast."""
    scene_id = _make_scene_with_walls(dm_socket, tmp_data, walls=[
        {"wallId": "w1", "x1": 0.0, "y1": 0.0, "x2": 100.0, "y2": 0.0},
    ])

    dm_socket.emit("updateWall", {
        "sceneId": scene_id,
        "wallId": "w1",
        "x1": 10.0, "y1": 20.0, "x2": 30.0, "y2": 40.0,
    })

    scene = app_module.scene_store.load_scene(scene_id)
    wall = scene["walls"][0]
    assert wall["x1"] == 10.0
    assert wall["y1"] == 20.0
    assert wall["x2"] == 30.0
    assert wall["y2"] == 40.0


def test_remove_wall(dm_socket, tmp_data):
    """DM emits removeWall; the wall is deleted."""
    scene_id = _make_scene_with_walls(dm_socket, tmp_data, walls=[
        {"wallId": "w1", "x1": 0.0, "y1": 0.0, "x2": 100.0, "y2": 0.0},
        {"wallId": "w2", "x1": 0.0, "y1": 0.0, "x2": 0.0, "y2": 100.0},
    ])

    dm_socket.emit("removeWall", {"sceneId": scene_id, "wallId": "w1"})

    scene = app_module.scene_store.load_scene(scene_id)
    assert len(scene["walls"]) == 1
    assert scene["walls"][0]["wallId"] == "w2"


def test_clear_walls(dm_socket, tmp_data):
    """DM emits clearWalls; all walls are removed."""
    scene_id = _make_scene_with_walls(dm_socket, tmp_data, walls=[
        {"wallId": "w1", "x1": 0.0, "y1": 0.0, "x2": 100.0, "y2": 0.0},
    ])

    dm_socket.emit("clearWalls", {"sceneId": scene_id})

    scene = app_module.scene_store.load_scene(scene_id)
    assert scene["walls"] == []


def test_wall_undo_redo(dm_socket, tmp_data):
    """Add wall -> undo removes it -> redo restores it."""
    scene_id = _make_scene_with_walls(dm_socket, tmp_data)

    wall = {"wallId": "w1", "x1": 0.0, "y1": 0.0, "x2": 100.0, "y2": 0.0}
    dm_socket.emit("addWall", {"sceneId": scene_id, "wall": wall})
    assert len(app_module.scene_store.load_scene(scene_id)["walls"]) == 1

    dm_socket.emit("undo", {"sceneId": scene_id})
    assert app_module.scene_store.load_scene(scene_id)["walls"] == []

    dm_socket.emit("redo", {"sceneId": scene_id})
    scene = app_module.scene_store.load_scene(scene_id)
    assert len(scene["walls"]) == 1
    assert scene["walls"][0]["wallId"] == "w1"


def test_wall_history_preserves_tokens(dm_socket, tmp_data):
    """Undoing a wall change does not touch unrelated token state."""
    scene_id = _make_scene_with_walls(dm_socket, tmp_data)
    token_id = "tok-keep"
    app_module.scene_store.add_token(scene_id, {
        "tokenId": token_id,
        "sceneId": scene_id,
        "imageUrl": "/uploads/t.png",
        "mediaType": "image",
        "x": 10.0, "y": 10.0,
        "width": 60.0, "height": 60.0,
        "rotation": 0.0,
        "zIndex": 1,
        "movableByPlayers": False,
        "hidden": False,
    })

    wall = {"wallId": "w1", "x1": 0.0, "y1": 0.0, "x2": 100.0, "y2": 0.0}
    dm_socket.emit("addWall", {"sceneId": scene_id, "wall": wall})

    dm_socket.emit("undo", {"sceneId": scene_id})
    scene = app_module.scene_store.load_scene(scene_id)
    assert scene["walls"] == []
    assert any(t["tokenId"] == token_id for t in scene["tokens"])


def test_duplicate_scene_deep_copies_walls(dm_client, tmp_data):
    """Duplicate scene copies walls into the new scene."""
    scene_id = "wall-scene-dup"
    app_module.scene_store.scenes[scene_id] = {
        "sceneId": scene_id,
        "sceneName": "Original",
        "tokens": [],
        "walls": [
            {"wallId": "w1", "x1": 0.0, "y1": 0.0, "x2": 100.0, "y2": 0.0},
        ],
    }
    app_module.scene_store.save_scene(app_module.scene_store.scenes[scene_id])

    resp = dm_client.post(
        "/duplicateScene",
        data=json.dumps({"sceneId": scene_id, "sceneName": "Copy"}),
        content_type="application/json",
    )
    assert resp.status_code == 200
    new_id = json.loads(resp.data)["sceneId"]

    new_scene = app_module.scene_store.load_scene(new_id)
    assert len(new_scene["walls"]) == 1
    assert new_scene["walls"][0]["wallId"] == "w1"
    # Mutation independence
    new_scene["walls"][0]["x1"] = 999.0
    original = app_module.scene_store.load_scene(scene_id)
    assert original["walls"][0]["x1"] == 0.0
