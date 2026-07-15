"""Tests for the authoritative real-time co-op multiplayer server.

Two layers of coverage:

1. Pure simulation tests against :class:`realtime.GameRoom` — deterministic,
   fast, and require neither a running server nor MongoDB.
2. WebSocket integration tests through Starlette's ``TestClient`` — exercise the
   join handshake, snapshot broadcasting, input handling and multi-client
   matchmaking end to end.
"""
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import realtime  # noqa: E402
from realtime import GameRoom, ARENA_W, ARENA_H, DT  # noqa: E402


# ---------------------------------------------------------------------------
# Simulation-level tests (no network / DB)
# ---------------------------------------------------------------------------
class _FakeWS:
    def __init__(self):
        self.sent = []

    async def send_json(self, msg):
        self.sent.append(msg)


def _hero(hid="arjuna"):
    return realtime.HEROES_BY_ID[hid]


def _weapon(wid="brahmastra"):
    return realtime.WEAPONS_BY_ID[wid]


class TestSimulation:
    def test_add_player_starts_wave_and_spawns_at_center(self):
        room = GameRoom("r1", "kurukshetra")
        assert room.wave == 0
        p = room.add_player("p1", _FakeWS(), "Arjun", _hero(), _weapon())
        assert room.wave == 1
        assert room.enemies_to_spawn > 0
        # spawn point is inside the arena
        assert 0 < p.x < ARENA_W and 0 < p.y < ARENA_H
        assert p.alive and p.hp == p.max_hp

    def test_player_moves_according_to_input(self):
        room = GameRoom("r2", "kurukshetra")
        p = room.add_player("p1", _FakeWS(), "Arjun", _hero(), _weapon())
        start_x = p.x
        p.in_move_x, p.in_move_y = 1.0, 0.0
        for _ in range(5):
            room.step(DT)
        assert p.x > start_x  # moved right

    def test_player_movement_is_clamped_to_arena(self):
        room = GameRoom("r3", "kurukshetra")
        p = room.add_player("p1", _FakeWS(), "Arjun", _hero(), _weapon())
        p.in_move_x, p.in_move_y = 1.0, 0.0
        for _ in range(400):
            room.step(DT)
        assert p.x <= ARENA_W - 20 + 0.001

    def test_bullets_spawn_and_kill_enemy_crediting_owner(self):
        room = GameRoom("r4", "kurukshetra")
        p = room.add_player("p1", _FakeWS(), "Arjun", _hero(), _weapon("gada"))
        room.enemies_to_spawn = 0  # stop auto spawning for a controlled test
        room.enemies.clear()
        # place a weak enemy right next to the player
        from realtime import Enemy
        e = Enemy(999, p.x + 40, p.y, hp=5, radius=16, speed=0, damage=0, color="#fff", etype="grunt")
        room.enemies.append(e)
        killed = False
        for _ in range(30):
            room.step(DT)
            if not room.enemies:
                killed = True
                break
        assert killed
        assert p.kills == 1

    def test_contact_damage_reduces_hp(self):
        room = GameRoom("r5", "kurukshetra")
        p = room.add_player("p1", _FakeWS(), "Arjun", _hero(), _weapon())
        p.invuln = 0.0
        from realtime import Enemy
        room.enemies_to_spawn = 0
        e = Enemy(1, p.x, p.y, hp=100000, radius=16, speed=0, damage=50, color="#fff", etype="grunt")
        room.enemies.append(e)
        hp0 = p.hp
        for _ in range(10):
            room.step(DT)
        assert p.hp < hp0

    def test_victory_when_all_waves_cleared(self):
        room = GameRoom("r6", "kurukshetra")
        room.add_player("p1", _FakeWS(), "Arjun", _hero(), _weapon())
        room.total_waves = 1
        room.wave = 1
        room.enemies_to_spawn = 0
        room.enemies.clear()
        room.step(DT)
        assert room.status == "victory"

    def test_defeat_when_all_players_down(self):
        room = GameRoom("r7", "kurukshetra")
        p = room.add_player("p1", _FakeWS(), "Arjun", _hero(), _weapon())
        p.alive = False
        room.step(DT)
        assert room.status == "defeat"

    def test_ability_has_cooldown(self):
        room = GameRoom("r8", "kurukshetra")
        p = room.add_player("p1", _FakeWS(), "Arjun", _hero("karna"), _weapon())
        assert p.ability_cd == 0
        room._trigger_ability(p)
        assert p.ability_cd > 0
        cd = p.ability_cd
        room._trigger_ability(p)  # should be ignored
        assert p.ability_cd <= cd

    def test_snapshot_structure(self):
        room = GameRoom("r9", "kurukshetra")
        room.add_player("p1", _FakeWS(), "Arjun", _hero(), _weapon())
        room.step(DT)
        snap = room.snapshot()
        assert snap["t"] == "state"
        assert snap["status"] == "playing"
        assert isinstance(snap["players"], list) and len(snap["players"]) == 1
        pl = snap["players"][0]
        assert {"id", "name", "x", "y", "hp", "maxHp", "alive", "kills"} <= set(pl.keys())
        assert set(("enemies", "bullets", "drops", "wave", "totalWaves")) <= set(snap.keys())

    def test_events_cleared_after_snapshot(self):
        room = GameRoom("r10", "kurukshetra")
        room.add_player("p1", _FakeWS(), "Arjun", _hero(), _weapon())
        snap1 = room.snapshot()
        assert any(ev["kind"] in ("wave", "player_join") for ev in snap1["events"])
        snap2 = room.snapshot()
        assert snap2["events"] == []


class TestRoomManager:
    @pytest.mark.asyncio
    async def test_matchmaking_reuses_open_room(self):
        mgr = realtime.RoomManager()
        try:
            room_a, pa = await mgr.join(_FakeWS(), None, "A", "arjuna", "brahmastra", "kurukshetra")
            room_b, pb = await mgr.join(_FakeWS(), None, "B", "arjuna", "brahmastra", "kurukshetra")
            assert room_a.id == room_b.id
            assert len(room_a.players) == 2
        finally:
            await mgr.shutdown()

    @pytest.mark.asyncio
    async def test_different_maps_get_different_rooms(self):
        mgr = realtime.RoomManager()
        try:
            room_a, _ = await mgr.join(_FakeWS(), None, "A", "arjuna", "brahmastra", "kurukshetra")
            room_b, _ = await mgr.join(_FakeWS(), None, "B", "arjuna", "brahmastra", "lanka")
            assert room_a.id != room_b.id
        finally:
            await mgr.shutdown()

    @pytest.mark.asyncio
    async def test_full_room_creates_new_room(self):
        mgr = realtime.RoomManager()
        try:
            first = None
            rooms = set()
            for i in range(realtime.MAX_PLAYERS + 1):
                room, _ = await mgr.join(_FakeWS(), None, f"P{i}", "arjuna", "brahmastra", "kurukshetra")
                rooms.add(room.id)
                if first is None:
                    first = room
            # once the first room filled to MAX_PLAYERS, a new room is created
            assert len(rooms) == 2
        finally:
            await mgr.shutdown()


# ---------------------------------------------------------------------------
# WebSocket integration tests (through the FastAPI app)
# ---------------------------------------------------------------------------
def _make_app():
    """A minimal FastAPI app that only mounts the realtime WS route, so these
    tests don't need MongoDB or the full server stack."""
    from fastapi import FastAPI, APIRouter

    app = FastAPI()
    router = APIRouter(prefix="/api")
    realtime.configure(persist_match=None)
    realtime.register_routes(router)
    app.include_router(router)
    return app


@pytest.fixture()
def client():
    from starlette.testclient import TestClient
    app = _make_app()
    with TestClient(app) as c:
        yield c


class TestWebSocket:
    def test_join_handshake_returns_welcome(self, client):
        with client.websocket_connect("/api/ws/battle") as ws:
            ws.send_json({"t": "join", "name": "Arjun", "hero": "arjuna", "weapon": "brahmastra", "map": "kurukshetra"})
            welcome = ws.receive_json()
            assert welcome["t"] == "welcome"
            assert welcome["self_id"]
            assert welcome["room_id"]
            assert welcome["arena"]["w"] > 0
            assert welcome["total_waves"] >= 1
            # then we should start receiving state snapshots
            state = ws.receive_json()
            assert state["t"] == "state"
            assert len(state["players"]) == 1

    def test_input_moves_player(self, client):
        with client.websocket_connect("/api/ws/battle") as ws:
            ws.send_json({"t": "join", "name": "Arjun", "hero": "arjuna", "weapon": "brahmastra", "map": "kurukshetra"})
            ws.receive_json()  # welcome
            first = ws.receive_json()
            x0 = first["players"][0]["x"]
            ws.send_json({"t": "input", "move": {"x": 1.0, "y": 0.0}})
            moved = False
            for _ in range(30):
                s = ws.receive_json()
                if s["t"] == "state" and s["players"] and s["players"][0]["x"] > x0 + 1:
                    moved = True
                    break
            assert moved

    def test_two_clients_share_room(self, client):
        with client.websocket_connect("/api/ws/battle") as ws1:
            ws1.send_json({"t": "join", "name": "A", "hero": "arjuna", "weapon": "brahmastra", "map": "lanka"})
            w1 = ws1.receive_json()
            with client.websocket_connect("/api/ws/battle") as ws2:
                ws2.send_json({"t": "join", "name": "B", "hero": "bhima", "weapon": "gada", "map": "lanka"})
                w2 = ws2.receive_json()
                assert w1["room_id"] == w2["room_id"]
                # ws2 should observe two players in a snapshot
                seen_two = False
                for _ in range(20):
                    s = ws2.receive_json()
                    if s["t"] == "state" and len(s["players"]) == 2:
                        seen_two = True
                        break
                assert seen_two

    def test_ping_pong(self, client):
        with client.websocket_connect("/api/ws/battle") as ws:
            ws.send_json({"t": "join", "name": "A", "hero": "arjuna", "weapon": "brahmastra", "map": "kurukshetra"})
            ws.receive_json()  # welcome
            ws.send_json({"t": "ping", "ts": 123})
            got_pong = False
            for _ in range(10):
                m = ws.receive_json()
                if m["t"] == "pong":
                    assert m["ts"] == 123
                    got_pong = True
                    break
            assert got_pong

    def test_bad_first_message_rejected(self, client):
        with client.websocket_connect("/api/ws/battle") as ws:
            ws.send_json({"t": "input", "move": {"x": 0, "y": 0}})
            m = ws.receive_json()
            assert m["t"] == "error"
