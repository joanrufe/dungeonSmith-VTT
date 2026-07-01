from __future__ import annotations

import json


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
