"""Multiplayer room + WebSocket co-op tests for Dharma Battle."""
import asyncio
import json
import os
import uuid

import pytest
import requests

try:
    import websockets
except ImportError:
    websockets = None

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "http://localhost:8001").rstrip("/")
API = f"{BASE_URL}/api"
MP = f"{API}/mp"


def _ws_base() -> str:
    if BASE_URL.startswith("https"):
        return "wss://" + BASE_URL[len("https://"):]
    if BASE_URL.startswith("http"):
        return "ws://" + BASE_URL[len("http://"):]
    return "ws://" + BASE_URL


@pytest.fixture(scope="module")
def s():
    sess = requests.Session()
    sess.headers.update({"Content-Type": "application/json"})
    return sess


def _make_player(s, name=None):
    name = name or f"MP_{uuid.uuid4().hex[:6]}"
    r = s.post(f"{API}/player", json={"name": name}, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()


class TestMpRooms:
    def test_create_and_list(self, s):
        p = _make_player(s)
        r = s.post(
            f"{MP}/rooms",
            json={
                "player_id": p["id"],
                "player_name": p["name"],
                "hero_id": "arjuna",
                "weapon_id": "brahmastra",
                "map_id": "kurukshetra",
            },
            timeout=10,
        )
        assert r.status_code == 200, r.text
        room = r.json()
        assert room["phase"] == "lobby"
        assert room["host_id"] == p["id"]
        assert len(room["code"]) >= 4
        assert room["player_count"] == 1

        listed = s.get(f"{MP}/rooms", timeout=10)
        assert listed.status_code == 200
        codes = [x["code"] for x in listed.json()]
        assert room["code"] in codes

        got = s.get(f"{MP}/rooms/{room['code']}", timeout=10)
        assert got.status_code == 200
        assert got.json()["code"] == room["code"]

    def test_join_second_player(self, s):
        host = _make_player(s, "HostA")
        guest = _make_player(s, "GuestB")
        r = s.post(
            f"{MP}/rooms",
            json={
                "player_id": host["id"],
                "player_name": host["name"],
                "hero_id": "arjuna",
                "weapon_id": "brahmastra",
                "map_id": "lanka",
            },
            timeout=10,
        )
        assert r.status_code == 200
        code = r.json()["code"]

        j = s.post(
            f"{MP}/rooms/join",
            json={
                "player_id": guest["id"],
                "player_name": guest["name"],
                "hero_id": "bhima",
                "weapon_id": "brahmastra",
                "code": code,
            },
            timeout=10,
        )
        # bhima may not be owned — still allowed for MP loadout preview; server uses hero stats by id
        assert j.status_code == 200, j.text
        room = j.json()
        assert room["player_count"] == 2
        ids = {p["player_id"] for p in room["players"]}
        assert host["id"] in ids and guest["id"] in ids

    def test_join_missing_room_404(self, s):
        p = _make_player(s)
        r = s.post(
            f"{MP}/rooms/join",
            json={
                "player_id": p["id"],
                "player_name": p["name"],
                "hero_id": "arjuna",
                "weapon_id": "brahmastra",
                "code": "ZZZZZ",
            },
            timeout=10,
        )
        assert r.status_code == 404


@pytest.mark.skipif(websockets is None, reason="websockets package required")
class TestMpWebSocket:
    def test_ready_and_match_start(self, s):
        host = _make_player(s, "WSHost")
        r = s.post(
            f"{MP}/rooms",
            json={
                "player_id": host["id"],
                "player_name": host["name"],
                "hero_id": "arjuna",
                "weapon_id": "brahmastra",
                "map_id": "kurukshetra",
            },
            timeout=10,
        )
        assert r.status_code == 200
        code = r.json()["code"]

        async def run():
            uri = f"{_ws_base()}/api/mp/ws/{code}?player_id={host['id']}"
            async with websockets.connect(uri, open_timeout=10) as ws:
                # room_state on connect
                first = json.loads(await asyncio.wait_for(ws.recv(), timeout=5))
                assert first["type"] == "room_state"
                await ws.send(json.dumps({"type": "ready", "ready": True, "start": True}))
                # Expect match_start then snapshots
                got_start = False
                got_snap = False
                for _ in range(30):
                    msg = json.loads(await asyncio.wait_for(ws.recv(), timeout=5))
                    if msg.get("type") == "match_start":
                        got_start = True
                        assert "players" in msg
                        assert msg.get("phase") == "playing" or msg.get("arena")
                    if msg.get("type") == "snapshot":
                        got_snap = True
                        assert "enemies" in msg or "players" in msg
                    if got_start and got_snap:
                        break
                assert got_start, "did not receive match_start"
                # Send an input frame
                await ws.send(json.dumps({"type": "input", "mx": 0.5, "my": -0.2}))
                await asyncio.sleep(0.15)
                snap = json.loads(await asyncio.wait_for(ws.recv(), timeout=5))
                assert snap.get("type") in ("snapshot", "match_end", "room_state")

        asyncio.run(run())
