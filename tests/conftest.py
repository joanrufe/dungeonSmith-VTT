from __future__ import annotations

import json
from pathlib import Path
from typing import Generator

import pytest
from flask.testing import FlaskClient
from flask_socketio import SocketIOTestClient

import app as app_module
from app import app as flask_app, socketio


@pytest.fixture()
def tmp_data(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """Redirect all persistent-storage paths to a temp directory."""
    private_dir = tmp_path / "private"
    private_dir.mkdir()
    secret_file = private_dir / "secrets.txt"
    secret_file.write_text("DM_PASSWORD=DMCODE\nPLAYER_PASSWORD=PLAY\n", encoding="utf-8")

    monkeypatch.setattr(app_module, "SECRET_FILE", secret_file)
    monkeypatch.setattr(app_module, "SECRET_DIR", private_dir)

    # Scope all campaign runtime data under a temp campaign tree.
    app_module.initialize_for_test(tmp_path / "campaign")
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


@pytest.fixture()
def dm_socket(app) -> Generator[SocketIOTestClient, None, None]:
    """Flask-SocketIO test client authenticated as DM (role=dm)."""
    http = app.test_client()
    http.post("/dm-login", data={"password": "DMCODE"})
    sio = SocketIOTestClient(app, socketio, flask_test_client=http, query_string="role=dm")
    yield sio
    sio.disconnect()


@pytest.fixture()
def player_socket(app) -> Generator[SocketIOTestClient, None, None]:
    """Flask-SocketIO test client authenticated as player (role=player)."""
    http = app.test_client()
    http.post("/player-login", data={"password": "PLAY"})
    sio = SocketIOTestClient(app, socketio, flask_test_client=http, query_string="role=player")
    yield sio
    sio.disconnect()
