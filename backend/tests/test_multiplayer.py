"""Tests for the real-time squad co-op multiplayer server.

Two layers:
  1. Pure-simulation unit tests against Room/BattleServer logic (no network).
  2. WebSocket integration tests against a running server (skipped when the
     `websockets` package or a live server is unavailable).
"""
import asyncio
import json
import os
import sys
import uuid

import pytest
import requests

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import multiplayer  # noqa: E402
from multiplayer import Room, RoomPlayer, ARENA_W, ARENA_H, MAX_PLAYERS  # noqa: E402

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "http://localhost:8001").rstrip("/")
API = f"{BASE_URL}/api"
WS_URL = BASE_URL.replace("http", "ws", 1) + "/api/ws/battle"

HERO = {"id": "arjuna", "name": "Arjuna", "hp": 100, "atk": 22, "spd": 6, "color": "#4FC3F7", "letter": "A"}
WEAPON = {"id": "brahmastra", "damage": 20, "cooldown": 0.35, "color": "#FFD700"}
MAP = {"id": "kurukshetra", "name": "Kurukshetra", "waves": 2, "bg": "#2B1810"}


class FakeWS:
    """Stands in for a WebSocket in pure-sim tests."""
    def __init__(self):
        self.sent = []

    async def send_json(self, msg):
        self.sent.append(msg)


def make_player(pid="p1", name="Tester") -> RoomPlayer:
    doc = {"id": pid, "name": name}
    return RoomPlayer(doc, HERO, WEAPON, FakeWS())


def make_room(n_players=1, mode="quick") -> Room:
    room = Room(mode, dict(MAP))
    for i in range(n_players):
        p = make_player(pid=f"p{i+1}", name=f"W{i+1}")
        room.players[p.id] = p
        room.order.append(p.id)
    return room


# ---------- Pure simulation ----------
class TestRoomSim:
    def test_room_has_join_code(self):
        room = make_room()
        assert len(room.code) == 6
        assert room.state == "waiting"
        assert room.host_id == "p1"

    def test_wave_scaling_with_squad_size(self):
        solo = make_room(1)
        solo.start_wave(1)
        squad = make_room(4)
        squad.start_wave(1)
        # 4-player squads face substantially more enemies than solo
        assert squad.enemies_left > solo.enemies_left
        assert solo.enemies_left == 6  # matches single-player: 4 + 1*2

    def test_enemy_spawn_and_chase(self):
        room = make_room(1)
        room.state = "playing"
        room.start_wave(1)
        room.spawn_enemy()
        assert len(room.enemies) == 1
        e = room.enemies[0]
        d0 = ((e["x"] - ARENA_W / 2) ** 2 + (e["y"] - ARENA_H / 2) ** 2) ** 0.5
        room.step(0.05)
        e = room.enemies[0]
        d1 = ((e["x"] - ARENA_W / 2) ** 2 + (e["y"] - ARENA_H / 2) ** 2) ** 0.5
        assert d1 < d0  # enemy moved toward the player at center

    def test_player_movement_clamped_to_arena(self):
        room = make_room(1)
        room.state = "playing"
        room.start_wave(1)
        p = room.players["p1"]
        p.move_x, p.move_y = -1.0, -1.0
        for _ in range(2000):
            room.step(0.05)
            if room.enemies_left <= 0 and not room.enemies:
                break
        assert p.x >= multiplayer.PLAYER_RADIUS
        assert p.y >= multiplayer.PLAYER_RADIUS

    def test_auto_fire_kills_enemy_and_awards_kill(self):
        room = make_room(1)
        room.state = "playing"
        room.wave = 1
        room.enemies_left = 0  # no extra spawns
        p = room.players["p1"]
        # Place a weak enemy right next to the player
        room.enemies.append({
            "id": room.uid(), "x": p.x + 60, "y": p.y, "type": "grunt",
            "hp": 10.0, "max_hp": 10.0, "r": 16.0, "speed": 0.0, "damage": 0.0, "color": "#fff",
        })
        for _ in range(100):
            result = room.step(0.05)
            if result is not None or p.kills > 0:
                break
        assert p.kills == 1

    def test_victory_when_final_wave_cleared(self):
        room = make_room(1)
        room.state = "playing"
        room.wave = MAP["waves"]  # already on final wave
        room.enemies_left = 0
        room.enemies = []
        result = room.step(0.05)
        assert result is True

    def test_defeat_when_all_players_dead(self):
        room = make_room(2)
        room.state = "playing"
        room.start_wave(1)
        for p in room.players.values():
            p.alive = False
            p.hp = 0
        result = room.step(0.05)
        assert result is False

    def test_squad_fights_on_when_one_falls(self):
        room = make_room(2)
        room.state = "playing"
        room.start_wave(1)
        room.players["p1"].alive = False
        result = room.step(0.05)
        assert result is None  # match continues

    def test_ability_bhima_ground_slam(self):
        room = make_room(1)
        room.state = "playing"
        room.wave = 1
        p = room.players["p1"]
        p.hero = {**HERO, "id": "bhima"}
        room.enemies.append({
            "id": room.uid(), "x": p.x + 50, "y": p.y, "type": "grunt",
            "hp": 30.0, "max_hp": 30.0, "r": 16.0, "speed": 0.0, "damage": 0.0, "color": "#fff",
        })
        room.trigger_ability(p)
        assert p.kills == 1          # slam does 80 dmg, enemy had 30
        assert p.ability_cd > 0      # cooldown applied
        room.trigger_ability(p)      # second trigger blocked by cooldown
        assert p.kills == 1

    def test_ability_hanuman_leap_grants_invuln(self):
        room = make_room(1)
        room.state = "playing"
        p = room.players["p1"]
        p.hero = {**HERO, "id": "hanuman"}
        y0 = p.y
        room.trigger_ability(p)
        assert p.invuln > 0
        assert p.y < y0  # leapt forward (default direction is up)

    def test_snapshot_shape(self):
        room = make_room(2)
        room.state = "playing"
        room.start_wave(1)
        room.spawn_enemy()
        snap = room.snapshot()
        assert snap["type"] == "state"
        assert snap["wave"] == 1
        assert snap["waves_total"] == MAP["waves"]
        assert len(snap["players"]) == 2
        assert len(snap["enemies"]) == 1
        pk = snap["players"][0]
        assert {"id", "name", "hero", "x", "y", "hp", "max_hp", "kills", "alive"} <= set(pk.keys())

    def test_input_clamping(self):
        # Movement input is clamped server-side so speed cheats are impossible
        room = make_room(1)
        room.state = "playing"
        room.start_wave(1)
        p = room.players["p1"]
        p.move_x, p.move_y = 1.0, 0.0
        x0 = p.x
        room.step(0.05)
        legit_dx = p.x - x0
        # reset and try a hacked oversized vector: server normalizes, same speed
        p.x = x0
        p.move_x, p.move_y = 1.0, 0.0
        room2 = make_room(1)
        room2.state = "playing"
        room2.start_wave(1)
        p2 = room2.players["p1"]
        p2.move_x, p2.move_y = 50.0, 0.0  # raw input would be clamped at ws layer too
        x1 = p2.x
        room2.step(0.05)
        hacked_dx = p2.x - x1
        assert abs(hacked_dx - legit_dx) < 1e-6


# ---------- Live WebSocket integration ----------
def _server_up() -> bool:
    try:
        return requests.get(f"{API}/multiplayer/status", timeout=5).status_code == 200
    except requests.RequestException:
        return False


websockets = pytest.importorskip("websockets", reason="websockets client lib not installed")
pytestmark_live = pytest.mark.skipif(not _server_up(), reason="backend not running")


async def _recv_until(ws, wanted_types, timeout=15.0):
    """Read messages until one of wanted_types arrives; returns it."""
    loop = asyncio.get_event_loop()
    deadline = loop.time() + timeout
    while True:
        remaining = deadline - loop.time()
        if remaining <= 0:
            raise TimeoutError(f"never received {wanted_types}")
        raw = await asyncio.wait_for(ws.recv(), timeout=remaining)
        msg = json.loads(raw)
        if msg["type"] in wanted_types:
            return msg


def _mk_player(name):
    r = requests.post(f"{API}/player", json={"name": name}, timeout=10)
    assert r.status_code == 200, r.text
    return r.json()


@pytestmark_live
class TestWebSocketLive:
    def test_status_endpoint(self):
        r = requests.get(f"{API}/multiplayer/status", timeout=10)
        assert r.status_code == 200
        d = r.json()
        assert {"rooms", "waiting", "playing", "players_online"} <= set(d.keys())

    def test_join_unknown_player_rejected(self):
        async def run():
            async with websockets.connect(WS_URL) as ws:
                await ws.send(json.dumps({"type": "join", "player_id": f"ghost-{uuid.uuid4()}", "mode": "quick"}))
                msg = json.loads(await asyncio.wait_for(ws.recv(), timeout=10))
                assert msg["type"] == "error"
                assert "not found" in msg["message"].lower()
        asyncio.run(run())

    def test_create_room_and_join_by_code(self):
        p1 = _mk_player(f"TEST_HOST_{uuid.uuid4().hex[:5]}")
        p2 = _mk_player(f"TEST_MATE_{uuid.uuid4().hex[:5]}")

        async def run():
            async with websockets.connect(WS_URL) as ws1:
                await ws1.send(json.dumps({"type": "join", "player_id": p1["id"], "mode": "create", "map_id": "kurukshetra"}))
                joined = await _recv_until(ws1, {"joined"})
                assert joined["host"] == p1["id"]
                code = joined["code"]
                assert len(code) == 6

                async with websockets.connect(WS_URL) as ws2:
                    await ws2.send(json.dumps({"type": "join", "player_id": p2["id"], "mode": "code", "code": code}))
                    joined2 = await _recv_until(ws2, {"joined"})
                    assert joined2["room_id"] == joined["room_id"]
                    # both see a 2-player lobby
                    lobby = await _recv_until(ws1, {"lobby"})
                    while len(lobby["players"]) < 2:
                        lobby = await _recv_until(ws1, {"lobby"})
                    ids = {p["id"] for p in lobby["players"]}
                    assert ids == {p1["id"], p2["id"]}
        asyncio.run(run())

    def test_join_bad_code_rejected(self):
        p = _mk_player(f"TEST_CODE_{uuid.uuid4().hex[:5]}")

        async def run():
            async with websockets.connect(WS_URL) as ws:
                await ws.send(json.dumps({"type": "join", "player_id": p["id"], "mode": "code", "code": "ZZZZZZ"}))
                msg = json.loads(await asyncio.wait_for(ws.recv(), timeout=10))
                assert msg["type"] == "error"
        asyncio.run(run())

    def test_full_match_start_play_and_finish_with_rewards(self):
        """Host starts a private room solo, plays (auto-fire does the work),
        and the match ends with rewards persisted to the player document."""
        p1 = _mk_player(f"TEST_SOLO_{uuid.uuid4().hex[:5]}")
        coins_before = p1["coins"]

        async def run():
            async with websockets.connect(WS_URL) as ws:
                await ws.send(json.dumps({"type": "join", "player_id": p1["id"], "mode": "create", "map_id": "kurukshetra"}))
                await _recv_until(ws, {"joined"})
                await ws.send(json.dumps({"type": "start"}))
                start = await _recv_until(ws, {"start"})
                assert start["arena"]["w"] > 0

                # play until the match ends (server sim; client just idles &
                # lets auto-fire clear waves) — cap at ~4 minutes of sim
                end = None
                deadline = asyncio.get_event_loop().time() + 240
                while asyncio.get_event_loop().time() < deadline:
                    raw = await asyncio.wait_for(ws.recv(), timeout=30)
                    msg = json.loads(raw)
                    if msg["type"] == "state":
                        continue
                    if msg["type"] == "end":
                        end = msg
                        break
                assert end is not None, "match never ended"
                assert isinstance(end["victory"], bool)
                assert p1["id"] in end["rewards"]
                reward = end["rewards"][p1["id"]]
                assert reward["coins"] > 0
                return reward

        reward = asyncio.run(run())
        # rewards persisted
        after = requests.get(f"{API}/player/{p1['id']}", timeout=10).json()
        assert after["coins"] == coins_before + reward["coins"]
        assert after["matches"] == 1

    def test_state_snapshots_flow_during_match(self):
        p1 = _mk_player(f"TEST_SNAP_{uuid.uuid4().hex[:5]}")

        async def run():
            async with websockets.connect(WS_URL) as ws:
                await ws.send(json.dumps({"type": "join", "player_id": p1["id"], "mode": "create"}))
                await _recv_until(ws, {"joined"})
                await ws.send(json.dumps({"type": "start"}))
                await _recv_until(ws, {"start"})
                snap = await _recv_until(ws, {"state"})
                assert snap["wave"] == 1
                assert len(snap["players"]) == 1
                me = snap["players"][0]
                # send movement input and verify position changes
                x0 = me["x"]
                await ws.send(json.dumps({"type": "input", "move": {"x": 1, "y": 0}}))
                await asyncio.sleep(0.5)
                # drain to latest snapshot
                latest = None
                for _ in range(30):
                    latest = await _recv_until(ws, {"state"})
                    if latest["players"][0]["x"] != x0:
                        break
                assert latest["players"][0]["x"] > x0
                await ws.send(json.dumps({"type": "leave"}))
        asyncio.run(run())

    def test_room_full_rejected(self):
        players = [_mk_player(f"TEST_FULL{i}_{uuid.uuid4().hex[:4]}") for i in range(MAX_PLAYERS + 1)]

        async def run():
            socks = []
            try:
                ws0 = await websockets.connect(WS_URL)
                socks.append(ws0)
                await ws0.send(json.dumps({"type": "join", "player_id": players[0]["id"], "mode": "create"}))
                joined = await _recv_until(ws0, {"joined"})
                code = joined["code"]
                for i in range(1, MAX_PLAYERS):
                    w = await websockets.connect(WS_URL)
                    socks.append(w)
                    await w.send(json.dumps({"type": "join", "player_id": players[i]["id"], "mode": "code", "code": code}))
                    await _recv_until(w, {"joined"})
                # 5th player rejected
                w5 = await websockets.connect(WS_URL)
                socks.append(w5)
                await w5.send(json.dumps({"type": "join", "player_id": players[-1]["id"], "mode": "code", "code": code}))
                msg = json.loads(await asyncio.wait_for(w5.recv(), timeout=10))
                assert msg["type"] == "error"
                assert "full" in msg["message"].lower()
            finally:
                for w in socks:
                    try:
                        await w.close()
                    except Exception:
                        pass
        asyncio.run(run())
