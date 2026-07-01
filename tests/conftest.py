from __future__ import annotations

import json
from pathlib import Path
from typing import Generator

import pytest
from flask.testing import FlaskClient

import app as app_module
from app import app as flask_app


@pytest.fixture()
def tmp_data(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """Redirect all persistent-storage paths to a temp directory."""
    scenes_dir = tmp_path / "scenes"
    scenes_dir.mkdir()
    private_dir = tmp_path / "private"
    private_dir.mkdir()
    notes_file = tmp_path / "sticky-notes.json"
    notes_file.write_text("[]", encoding="utf-8")
    secret_file = private_dir / "secrets.txt"
    secret_file.write_text("DM_PASSWORD=DMCODE\nPLAYER_PASSWORD=PLAY\n", encoding="utf-8")

    monkeypatch.setattr(app_module, "SCENES_DIR", scenes_dir)
    monkeypatch.setattr(app_module, "DATA_DIR", tmp_path)
    monkeypatch.setattr(app_module, "NOTES_FILE", notes_file)
    monkeypatch.setattr(app_module, "SECRET_FILE", secret_file)
    monkeypatch.setattr(app_module, "SECRET_DIR", private_dir)
    # Reset in-memory scene store for each test
    app_module.scene_store.scenes.clear()
    app_module.scene_store.active_scene_id = None
    return tmp_path


@pytest.fixture()
def app(tmp_data: Path):
    """Pytest-flask convention: returns the Flask app instance under test."""
    flask_app.config["TESTING"] = True
    flask_app.config["DM_PASSWORD"] = "DMCODE"
    flask_app.config["PLAYER_PASSWORD"] = "PLAY"
    return flask_app


@pytest.fixture()
def client(app) -> Generator[FlaskClient, None, None]:
    with app.test_client() as c:
        yield c


@pytest.fixture()
def dm_client(client: FlaskClient) -> FlaskClient:
    """Client with an active DM session."""
    client.post("/dm-login", data={"password": "DMCODE"})
    return client


@pytest.fixture()
def player_client(client: FlaskClient) -> FlaskClient:
    """Client with an active player session."""
    client.post("/player-login", data={"password": "PLAY"})
    return client
