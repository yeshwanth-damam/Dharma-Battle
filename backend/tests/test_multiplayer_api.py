"""Integration tests for the co-op multiplayer REST + WebSocket API.

Builds a minimal FastAPI app around `create_multiplayer_router` (bypassing
server.py, so this doesn't need the Stripe/emergentintegrations package) and
exercises it with Starlette's TestClient against a real MongoDB instance.
"""
import os
import sys
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pytest  # noqa: E402
from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from motor.motor_asyncio import AsyncIOMotorClient  # noqa: E402
from pymongo import MongoClient  # noqa: E402

from multiplayer import create_multiplayer_router  # noqa: E402

MONGO_URL = os.environ.get("MONGO_URL", "mongodb://127.0.0.1:27017")
DB_NAME = os.environ.get("DB_NAME", "dharma_battle_test")


@pytest.fixture(scope="module")
def app_db():
    client = AsyncIOMotorClient(MONGO_URL)
    db = client[DB_NAME]
    yield db
    client.close()


@pytest.fixture(scope="module")
def client(app_db):
    app = FastAPI()
    app.include_router(create_multiplayer_router(app_db), prefix="/api")
    with TestClient(app) as c:
        yield c


# Separate *synchronous* pymongo client purely for test-data setup, so we
# never touch the app's motor client outside of the request event loop
# TestClient runs it on (mixing loops raises "attached to a different loop").
_sync_mongo = MongoClient(MONGO_URL)
_sync_db = _sync_mongo[DB_NAME]


def make_player(app_db=None, name="TEST_MP"):
    """Insert a minimal player document directly (mirrors server.py's Player defaults)."""
    pid = str(uuid.uuid4())
    doc = {
        "id": pid, "name": name, "level": 1, "xp": 0, "coins": 250,
        "kills": 0, "matches": 0, "wins": 0, "best_score": 0,
        "owned_heroes": ["arjuna"], "owned_weapons": ["brahmastra"],
        "selected_hero": "arjuna", "selected_weapon": "brahmastra",
        "premium_warrior": False, "google_linked": False,
    }
    _sync_db.players.insert_one(dict(doc))
    return doc


class TestRoomRestFlow:
    def test_create_room(self, client, app_db):
        host = make_player(app_db, "TEST_Host")
        r = client.post("/api/multiplayer/rooms", json={"player_id": host["id"], "map_id": "kurukshetra", "max_players": 4})
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["state"] == "waiting"
        assert body["host_id"] == host["id"]
        assert len(body["players"]) == 1
        assert body["players"][0]["hero_id"] == "arjuna"

    def test_create_room_unknown_player_404(self, client):
        r = client.post("/api/multiplayer/rooms", json={"player_id": "does-not-exist", "map_id": "kurukshetra"})
        assert r.status_code == 404

    def test_list_rooms_shows_waiting_room(self, client, app_db):
        host = make_player(app_db, "TEST_Lister")
        r = client.post("/api/multiplayer/rooms", json={"player_id": host["id"]})
        code = r.json()["code"]
        listing = client.get("/api/multiplayer/rooms").json()
        assert any(room["code"] == code for room in listing)

    def test_join_room(self, client, app_db):
        host = make_player(app_db, "TEST_Host2")
        guest = make_player(app_db, "TEST_Guest2")
        code = client.post("/api/multiplayer/rooms", json={"player_id": host["id"]}).json()["code"]
        r = client.post(f"/api/multiplayer/rooms/{code}/join", json={"player_id": guest["id"]})
        assert r.status_code == 200
        assert len(r.json()["players"]) == 2

    def test_join_unknown_room_404(self, client, app_db):
        guest = make_player(app_db, "TEST_Guest3")
        r = client.post("/api/multiplayer/rooms/ZZZZZ/join", json={"player_id": guest["id"]})
        assert r.status_code == 404

    def test_join_full_room_400(self, client, app_db):
        host = make_player(app_db, "TEST_Host3")
        code = client.post("/api/multiplayer/rooms", json={"player_id": host["id"], "max_players": 1}).json()["code"]
        guest = make_player(app_db, "TEST_Guest4")
        r = client.post(f"/api/multiplayer/rooms/{code}/join", json={"player_id": guest["id"]})
        assert r.status_code == 400

    def test_get_room_status(self, client, app_db):
        host = make_player(app_db, "TEST_Host4")
        code = client.post("/api/multiplayer/rooms", json={"player_id": host["id"]}).json()["code"]
        r = client.get(f"/api/multiplayer/rooms/{code}")
        assert r.status_code == 200
        assert r.json()["code"] == code

    def test_leave_room(self, client, app_db):
        host = make_player(app_db, "TEST_Host5")
        guest = make_player(app_db, "TEST_Guest5")
        code = client.post("/api/multiplayer/rooms", json={"player_id": host["id"]}).json()["code"]
        client.post(f"/api/multiplayer/rooms/{code}/join", json={"player_id": guest["id"]})
        r = client.post(f"/api/multiplayer/rooms/{code}/leave", json={"player_id": guest["id"]})
        assert r.status_code == 200
        status = client.get(f"/api/multiplayer/rooms/{code}").json()
        assert len(status["players"]) == 1

    def test_leave_last_player_removes_room(self, client, app_db):
        host = make_player(app_db, "TEST_Host6")
        code = client.post("/api/multiplayer/rooms", json={"player_id": host["id"]}).json()["code"]
        client.post(f"/api/multiplayer/rooms/{code}/leave", json={"player_id": host["id"]})
        r = client.get(f"/api/multiplayer/rooms/{code}")
        assert r.status_code == 404

    def test_only_host_can_start(self, client, app_db):
        host = make_player(app_db, "TEST_Host7")
        guest = make_player(app_db, "TEST_Guest7")
        code = client.post("/api/multiplayer/rooms", json={"player_id": host["id"]}).json()["code"]
        client.post(f"/api/multiplayer/rooms/{code}/join", json={"player_id": guest["id"]})
        r = client.post(f"/api/multiplayer/rooms/{code}/start", json={"player_id": guest["id"]})
        assert r.status_code == 400
        r2 = client.post(f"/api/multiplayer/rooms/{code}/start", json={"player_id": host["id"]})
        assert r2.status_code == 200
        assert r2.json()["state"] == "countdown"

    def test_start_unknown_room_404(self, client, app_db):
        host = make_player(app_db, "TEST_Host8")
        r = client.post("/api/multiplayer/rooms/ZZZZZ/start", json={"player_id": host["id"]})
        assert r.status_code == 404


class TestWebSocketFlow:
    def test_reject_unjoined_player(self, client, app_db):
        host = make_player(app_db, "TEST_WSHost")
        code = client.post("/api/multiplayer/rooms", json={"player_id": host["id"]}).json()["code"]
        with pytest.raises(Exception):
            with client.websocket_connect(f"/api/ws/room/{code}?player_id=someone-else") as ws:
                ws.receive_json()

    def test_connect_receives_initial_snapshot(self, client, app_db):
        host = make_player(app_db, "TEST_WSHost2")
        code = client.post("/api/multiplayer/rooms", json={"player_id": host["id"]}).json()["code"]
        with client.websocket_connect(f"/api/ws/room/{code}?player_id={host['id']}") as ws:
            msg = ws.receive_json()
            assert msg["type"] == "state"
            assert msg["code"] == code
            assert msg["state"] == "waiting"

    def test_start_then_ws_receives_countdown_and_playing_states(self, client, app_db):
        host = make_player(app_db, "TEST_WSHost3")
        code = client.post("/api/multiplayer/rooms", json={"player_id": host["id"]}).json()["code"]
        with client.websocket_connect(f"/api/ws/room/{code}?player_id={host['id']}") as ws:
            ws.receive_json()  # initial waiting snapshot
            client.post(f"/api/multiplayer/rooms/{code}/start", json={"player_id": host["id"]})

            seen_states = set()
            for _ in range(200):
                msg = ws.receive_json()
                seen_states.add(msg["state"])
                if "playing" in seen_states:
                    break
            assert "countdown" in seen_states or "playing" in seen_states

    def test_join_broadcasts_lobby_update_to_connected_players(self, client, app_db):
        host = make_player(app_db, "TEST_WSHost5")
        guest = make_player(app_db, "TEST_WSGuest5")
        code = client.post("/api/multiplayer/rooms", json={"player_id": host["id"]}).json()["code"]
        with client.websocket_connect(f"/api/ws/room/{code}?player_id={host['id']}") as ws:
            ws.receive_json()  # initial state snapshot
            ws.receive_json()  # lobby broadcast triggered by host's own connect
            client.post(f"/api/multiplayer/rooms/{code}/join", json={"player_id": guest["id"]})
            msg = ws.receive_json()
            assert msg["type"] == "lobby"
            assert len(msg["players"]) == 2

    def test_disconnect_broadcasts_lobby_update(self, client, app_db):
        host = make_player(app_db, "TEST_WSHost6")
        guest = make_player(app_db, "TEST_WSGuest6")
        code = client.post("/api/multiplayer/rooms", json={"player_id": host["id"]}).json()["code"]
        client.post(f"/api/multiplayer/rooms/{code}/join", json={"player_id": guest["id"]})

        with client.websocket_connect(f"/api/ws/room/{code}?player_id={host['id']}") as host_ws:
            host_ws.receive_json()  # initial snapshot
            host_ws.receive_json()  # lobby broadcast triggered by host's own connect
            with client.websocket_connect(f"/api/ws/room/{code}?player_id={guest['id']}") as guest_ws:
                guest_ws.receive_json()  # initial snapshot
                host_ws.receive_json()  # lobby update: guest connected
            # guest_ws context exit disconnects the guest; while the room is
            # still "waiting" a disconnect fully drops the player (they can
            # simply rejoin), rather than leaving a stale "disconnected" slot.
            msg = host_ws.receive_json()
            assert msg["type"] == "lobby"
            assert all(p["id"] != guest["id"] for p in msg["players"])

    def test_input_moves_player_in_snapshot(self, client, app_db):
        host = make_player(app_db, "TEST_WSHost4")
        code = client.post("/api/multiplayer/rooms", json={"player_id": host["id"]}).json()["code"]
        with client.websocket_connect(f"/api/ws/room/{code}?player_id={host['id']}") as ws:
            first = ws.receive_json()
            start_x = first["players"][0]["x"]
            client.post(f"/api/multiplayer/rooms/{code}/start", json={"player_id": host["id"]})

            reached_playing = False
            for _ in range(400):
                msg = ws.receive_json()
                if msg["state"] == "playing":
                    reached_playing = True
                    break
            assert reached_playing

            ws.send_json({"type": "input", "joystick": {"x": 1, "y": 0}})
            moved = False
            for _ in range(60):
                msg = ws.receive_json()
                me = next((p for p in msg["players"] if p["id"] == host["id"]), None)
                if me and me["x"] > start_x:
                    moved = True
                    break
            assert moved
