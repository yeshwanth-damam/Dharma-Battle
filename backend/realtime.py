"""Authoritative real-time co-op multiplayer server for Dharma Battle.

This is the "incremental evolution" of the single-player wave shooter: an
authoritative game server that runs *next to* the existing FastAPI REST API.
Clients no longer simulate the fight locally — they send inputs over a
WebSocket and render the snapshots the server broadcasts. This closes the
classic cheating/desync holes and lets several warriors fight the same waves
together (drop-in PvE co-op).

Design
------
* One :class:`GameRoom` per match. Each room owns an ``asyncio`` task that
  advances a fixed-timestep simulation (``TICK_HZ`` Hz) and broadcasts a
  compact snapshot every tick.
* :class:`RoomManager` handles match-making: a joining player drops into an
  open room for the same map, or a fresh room is spun up.
* All world state (positions, HP, enemies, bullets, waves) is owned by the
  server. The only thing a client can influence is its own input intent.

The module is intentionally free of any FastAPI/DB imports at the top level so
it can be unit-tested in isolation; ``server.py`` wires in persistence via
:func:`configure` and the WebSocket route via :func:`register_routes`.
"""
from __future__ import annotations

import asyncio
import logging
import math
import random
import time
import uuid
from typing import Awaitable, Callable, Dict, List, Optional

from fastapi import WebSocket, WebSocketDisconnect

from game_config import HEROES_BY_ID, WEAPONS_BY_ID, MAPS_BY_ID

logger = logging.getLogger("dharma.realtime")

# ---------- Tunables (kept in sync with the single-player client feel) ----------
ARENA_W = 720.0
ARENA_H = 1180.0
TICK_HZ = 20
DT = 1.0 / TICK_HZ
MAX_PLAYERS = 4

BULLET_SPEED = 520.0
BULLET_LIFE = 1.4
FIRE_RANGE = 440.0

PLAYER_RADIUS = 22.0
PLAYER_CONTACT_PAD = 20.0
ABILITY_COOLDOWN = 12.0
RESPAWN_HP_FRACTION = 0.5

ENEMY_BASE = {
    "grunt": {"hp": 30, "speed": 55, "damage": 8, "radius": 16, "color": "#8E24AA"},
    "swift": {"hp": 22, "speed": 90, "damage": 6, "radius": 13, "color": "#26C6DA"},
    "brute": {"hp": 80, "speed": 40, "damage": 18, "radius": 22, "color": "#D84315"},
}

# ---------- Persistence hook (set by server.py) ----------
# Signature: async (player_id, kills, survived_seconds, victory) -> Optional[dict]
PersistMatch = Callable[[str, int, int, bool], Awaitable[Optional[dict]]]
_persist_match: Optional[PersistMatch] = None


def configure(persist_match: Optional[PersistMatch] = None) -> None:
    """Inject side-effecting dependencies (currently only match persistence)."""
    global _persist_match
    _persist_match = persist_match


# ---------- Vector helpers ----------
def _len(x: float, y: float) -> float:
    return math.hypot(x, y)


def _clamp(v: float, lo: float, hi: float) -> float:
    return lo if v < lo else hi if v > hi else v


# ---------- Entities ----------
class RTPlayer:
    __slots__ = (
        "id", "ws", "name", "hero_id", "weapon_id", "color", "letter",
        "hp", "max_hp", "speed", "weapon_damage", "weapon_cooldown", "weapon_color",
        "x", "y", "alive", "kills", "bonus_coins", "fire_cd", "ability_cd", "invuln",
        "in_move_x", "in_move_y", "in_aim", "in_fire", "in_ability", "connected",
    )

    def __init__(self, pid: str, ws, name: str, hero: dict, weapon: dict, spawn):
        self.id = pid
        self.ws = ws
        self.name = name
        self.hero_id = hero["id"]
        self.weapon_id = weapon["id"]
        self.color = hero["color"]
        self.letter = hero["letter"]
        self.max_hp = float(hero["hp"])
        self.hp = float(hero["hp"])
        self.speed = float(hero["spd"]) * 26.0
        self.weapon_damage = float(weapon["damage"])
        self.weapon_cooldown = float(weapon["cooldown"])
        self.weapon_color = weapon["color"]
        self.x, self.y = spawn
        self.alive = True
        self.kills = 0
        self.bonus_coins = 0
        self.fire_cd = 0.0
        self.ability_cd = 0.0
        self.invuln = 0.0
        # latest input intent
        self.in_move_x = 0.0
        self.in_move_y = 0.0
        self.in_aim: Optional[tuple] = None
        self.in_fire = False
        self.in_ability = False
        self.connected = True

    def snapshot(self) -> dict:
        return {
            "id": self.id,
            "name": self.name,
            "hero": self.hero_id,
            "color": self.color,
            "letter": self.letter,
            "x": round(self.x, 1),
            "y": round(self.y, 1),
            "hp": round(self.hp, 1),
            "maxHp": self.max_hp,
            "alive": self.alive,
            "kills": self.kills,
            "abilityCd": round(self.ability_cd, 2),
            "invuln": round(self.invuln, 2),
            "connected": self.connected,
        }


class Enemy:
    __slots__ = ("id", "x", "y", "hp", "max_hp", "radius", "speed", "damage", "color", "type")

    def __init__(self, eid, x, y, hp, radius, speed, damage, color, etype):
        self.id = eid
        self.x = x
        self.y = y
        self.hp = hp
        self.max_hp = hp
        self.radius = radius
        self.speed = speed
        self.damage = damage
        self.color = color
        self.type = etype

    def snapshot(self) -> dict:
        return {
            "id": self.id, "x": round(self.x, 1), "y": round(self.y, 1),
            "hp": round(self.hp, 1), "maxHp": round(self.max_hp, 1),
            "r": self.radius, "type": self.type, "color": self.color,
        }


class Bullet:
    __slots__ = ("id", "x", "y", "vx", "vy", "life", "damage", "color", "owner")

    def __init__(self, bid, x, y, vx, vy, damage, color, owner):
        self.id = bid
        self.x = x
        self.y = y
        self.vx = vx
        self.vy = vy
        self.life = BULLET_LIFE
        self.damage = damage
        self.color = color
        self.owner = owner

    def snapshot(self) -> dict:
        return {"id": self.id, "x": round(self.x, 1), "y": round(self.y, 1), "color": self.color}


class Drop:
    __slots__ = ("id", "x", "y", "kind")

    def __init__(self, did, x, y, kind):
        self.id = did
        self.x = x
        self.y = y
        self.kind = kind

    def snapshot(self) -> dict:
        return {"id": self.id, "x": round(self.x, 1), "y": round(self.y, 1), "kind": self.kind}


# ---------- Room ----------
class GameRoom:
    def __init__(self, room_id: str, map_id: str):
        self.id = room_id
        self.map_id = map_id
        mp = MAPS_BY_ID.get(map_id, MAPS_BY_ID["kurukshetra"])
        self.total_waves = int(mp["waves"])
        self.map_bg = mp["bg"]
        self.players: Dict[str, RTPlayer] = {}
        self.enemies: List[Enemy] = []
        self.bullets: List[Bullet] = []
        self.drops: List[Drop] = []
        self.wave = 0
        self.enemies_to_spawn = 0
        self.spawn_cd = 0.0
        self.status = "playing"  # playing | victory | defeat
        self.seq = 0
        self.elapsed = 0.0
        self._uniq = 1
        self._events: List[dict] = []
        self._task: Optional[asyncio.Task] = None
        self._persisted = False
        self._final_broadcasts = 0
        self._lock = asyncio.Lock()

    # ---- entity id helper ----
    def _nid(self) -> int:
        self._uniq += 1
        return self._uniq

    def is_joinable(self) -> bool:
        return self.status == "playing" and len(self.players) < MAX_PLAYERS

    def _spawn_point(self, index: int) -> tuple:
        # spread starting positions around arena centre
        cx, cy = ARENA_W / 2, ARENA_H / 2
        ring = 90
        angle = (index / MAX_PLAYERS) * math.tau
        return (cx + math.cos(angle) * ring, cy + math.sin(angle) * ring)

    def add_player(self, pid: str, ws, name: str, hero: dict, weapon: dict) -> RTPlayer:
        spawn = self._spawn_point(len(self.players))
        p = RTPlayer(pid, ws, name, hero, weapon, spawn)
        self.players[pid] = p
        if self.wave == 0:
            self._start_wave(1)
        self._events.append({"kind": "player_join", "id": pid, "name": name})
        return p

    def remove_player(self, pid: str) -> None:
        p = self.players.get(pid)
        if p:
            p.connected = False
            self._events.append({"kind": "player_leave", "id": pid, "name": p.name})
        self.players.pop(pid, None)

    def active_players(self) -> List[RTPlayer]:
        return [p for p in self.players.values() if p.connected]

    def _start_wave(self, w: int) -> None:
        self.wave = w
        n = max(1, len(self.players))
        # base curve mirrors client (4 + 2w) with a gentle co-op bump
        self.enemies_to_spawn = (4 + w * 2) + (n - 1) * 3
        self.spawn_cd = 0.0
        # revive downed warriors at the start of each wave
        for p in self.players.values():
            if not p.alive:
                p.alive = True
                p.hp = p.max_hp * RESPAWN_HP_FRACTION
                p.invuln = 2.0
        self._events.append({"kind": "wave", "wave": w, "total": self.total_waves})

    def _spawn_enemy(self) -> None:
        roll = random.random()
        etype = "grunt"
        if roll > 0.85:
            etype = "brute"
        elif roll > 0.6:
            etype = "swift"
        base = ENEMY_BASE[etype]
        mult = 1.0 + (self.wave - 1) * 0.15
        side = random.randint(0, 3)
        if side == 0:
            x, y = random.uniform(0, ARENA_W), -20.0
        elif side == 1:
            x, y = ARENA_W + 20.0, random.uniform(0, ARENA_H)
        elif side == 2:
            x, y = random.uniform(0, ARENA_W), ARENA_H + 20.0
        else:
            x, y = -20.0, random.uniform(0, ARENA_H)
        self.enemies.append(Enemy(
            self._nid(), x, y, base["hp"] * mult, base["radius"],
            base["speed"] * mult, base["damage"] * mult, base["color"], etype,
        ))

    def _nearest_enemy(self, x: float, y: float, max_d: float = 1e9):
        best = None
        bd = max_d
        for e in self.enemies:
            d = _len(e.x - x, e.y - y)
            if d < bd:
                bd = d
                best = e
        return best, bd

    def _nearest_player(self, x: float, y: float):
        best = None
        bd = 1e9
        for p in self.players.values():
            if not p.alive:
                continue
            d = _len(p.x - x, p.y - y)
            if d < bd:
                bd = d
                best = p
        return best, bd

    def _fire_bullet(self, owner: RTPlayer, dx: float, dy: float) -> None:
        d = _len(dx, dy) or 1.0
        self.bullets.append(Bullet(
            self._nid(), owner.x, owner.y,
            dx / d * BULLET_SPEED, dy / d * BULLET_SPEED,
            owner.weapon_damage, owner.weapon_color, owner.id,
        ))

    def _damage_enemy(self, e: Enemy, dmg: float, owner: Optional[RTPlayer]) -> None:
        e.hp -= dmg
        if e.hp <= 0:
            if owner is not None:
                owner.kills += 1
            self._events.append({"kind": "kill", "by": owner.id if owner else None, "etype": e.type, "x": round(e.x, 1), "y": round(e.y, 1)})
            roll = random.random()
            if roll < 0.18:
                self.drops.append(Drop(self._nid(), e.x, e.y, "hp"))
            elif roll < 0.40:
                self.drops.append(Drop(self._nid(), e.x, e.y, "coin"))

    def _trigger_ability(self, p: RTPlayer) -> None:
        if p.ability_cd > 0 or not p.alive:
            return
        p.ability_cd = ABILITY_COOLDOWN
        hero = p.hero_id
        if hero == "arjuna":
            for i in range(12):
                a = (i / 12) * math.tau
                self._fire_bullet(p, math.cos(a), math.sin(a))
        elif hero == "bhima":
            R = 180.0
            for e in self.enemies:
                if _len(e.x - p.x, e.y - p.y) < R:
                    self._damage_enemy(e, 80.0, p)
        elif hero == "hanuman":
            dx, dy = p.in_move_x, p.in_move_y
            if _len(dx, dy) < 0.05:
                dx, dy = 0.0, -1.0
            dl = _len(dx, dy) or 1.0
            p.x = _clamp(p.x + dx / dl * 220.0, 30, ARENA_W - 30)
            p.y = _clamp(p.y + dy / dl * 220.0, 30, ARENA_H - 30)
            p.invuln = 1.5
        elif hero == "karna":
            for e in self.enemies:
                self._damage_enemy(e, 60.0, p)
        self._events.append({"kind": "ability", "id": p.id, "hero": hero})

    # ---- main step ----
    def step(self, dt: float) -> None:
        if self.status != "playing":
            return
        self.elapsed += dt

        # 1) players: timers, movement, ability, firing
        for p in self.players.values():
            p.fire_cd = max(0.0, p.fire_cd - dt)
            p.ability_cd = max(0.0, p.ability_cd - dt)
            p.invuln = max(0.0, p.invuln - dt)
            if not p.alive:
                continue

            mx, my = p.in_move_x, p.in_move_y
            ml = _len(mx, my)
            if ml > 1.0:
                mx, my = mx / ml, my / ml
            p.x = _clamp(p.x + mx * p.speed * dt, 20, ARENA_W - 20)
            p.y = _clamp(p.y + my * p.speed * dt, 20, ARENA_H - 20)

            if p.in_ability:
                self._trigger_ability(p)
                p.in_ability = False

            if p.fire_cd <= 0:
                tx = ty = None
                if p.in_aim is not None:
                    ax, ay = p.in_aim
                    if _len(ax, ay) > 0.01:
                        tx, ty = ax, ay  # treat as a direction vector
                if tx is None:
                    tgt, d = self._nearest_enemy(p.x, p.y, FIRE_RANGE)
                    if tgt is not None:
                        tx, ty = tgt.x - p.x, tgt.y - p.y
                if tx is not None:
                    self._fire_bullet(p, tx, ty)
                    p.fire_cd = p.weapon_cooldown

        # 2) bullets
        alive_bullets: List[Bullet] = []
        for b in self.bullets:
            b.x += b.vx * dt
            b.y += b.vy * dt
            b.life -= dt
            if b.life <= 0 or b.x < -20 or b.x > ARENA_W + 20 or b.y < -20 or b.y > ARENA_H + 20:
                continue
            hit = False
            for e in self.enemies:
                if e.hp <= 0:
                    continue
                if _len(b.x - e.x, b.y - e.y) < e.radius + 4:
                    self._damage_enemy(e, b.damage, self.players.get(b.owner))
                    hit = True
                    break
            if not hit:
                alive_bullets.append(b)
        self.bullets = alive_bullets

        # 3) enemies: move toward nearest player + contact damage
        surviving: List[Enemy] = []
        for e in self.enemies:
            if e.hp <= 0:
                continue
            tgt, _d = self._nearest_player(e.x, e.y)
            if tgt is not None:
                dx, dy = tgt.x - e.x, tgt.y - e.y
                dl = _len(dx, dy) or 1.0
                e.x += dx / dl * e.speed * dt
                e.y += dy / dl * e.speed * dt
                if _len(e.x - tgt.x, e.y - tgt.y) < e.radius + PLAYER_CONTACT_PAD and tgt.invuln <= 0:
                    tgt.hp -= e.damage * dt
                    if tgt.hp <= 0:
                        tgt.hp = 0.0
                        tgt.alive = False
                        self._events.append({"kind": "down", "id": tgt.id, "name": tgt.name})
            surviving.append(e)
        self.enemies = surviving

        # 4) drops pickup
        remaining: List[Drop] = []
        for d in self.drops:
            picked = False
            for p in self.players.values():
                if not p.alive:
                    continue
                if _len(d.x - p.x, d.y - p.y) < 28:
                    if d.kind == "hp":
                        p.hp = min(p.max_hp, p.hp + p.max_hp * 0.25)
                    else:
                        p.bonus_coins += 5
                    self._events.append({"kind": "pickup", "id": p.id, "drop": d.kind})
                    picked = True
                    break
            if not picked:
                remaining.append(d)
        self.drops = remaining

        # 5) spawning
        self.spawn_cd -= dt
        cap = 8 * max(1, len(self.players))
        if self.enemies_to_spawn > 0 and self.spawn_cd <= 0 and len(self.enemies) < cap:
            self._spawn_enemy()
            self.enemies_to_spawn -= 1
            self.spawn_cd = max(0.4, 1.4 - self.wave * 0.08)

        # 6) wave / win / lose resolution
        if self.enemies_to_spawn <= 0 and not self.enemies and self.status == "playing":
            if self.wave >= self.total_waves:
                self.status = "victory"
                self._events.append({"kind": "gameover", "victory": True})
            else:
                self._start_wave(self.wave + 1)

        if self.status == "playing":
            act = self.active_players()
            if act and all(not p.alive for p in act):
                self.status = "defeat"
                self._events.append({"kind": "gameover", "victory": False})

    # ---- snapshot ----
    def snapshot(self) -> dict:
        self.seq += 1
        snap = {
            "t": "state",
            "seq": self.seq,
            "status": self.status,
            "wave": self.wave,
            "totalWaves": self.total_waves,
            "elapsed": round(self.elapsed, 1),
            "players": [p.snapshot() for p in self.players.values()],
            "enemies": [e.snapshot() for e in self.enemies],
            "bullets": [b.snapshot() for b in self.bullets],
            "drops": [d.snapshot() for d in self.drops],
            "events": self._events,
        }
        self._events = []
        return snap


# ---------- Room manager ----------
class RoomManager:
    def __init__(self):
        self.rooms: Dict[str, GameRoom] = {}
        self._loops: Dict[str, asyncio.Task] = {}

    def _find_open_room(self, map_id: str) -> Optional[GameRoom]:
        for room in self.rooms.values():
            if room.map_id == map_id and room.is_joinable():
                return room
        return None

    async def join(self, ws, player_id: Optional[str], name: str, hero_id: str, weapon_id: str, map_id: str):
        hero = HEROES_BY_ID.get(hero_id) or HEROES_BY_ID["arjuna"]
        weapon = WEAPONS_BY_ID.get(weapon_id) or WEAPONS_BY_ID["brahmastra"]
        if map_id not in MAPS_BY_ID:
            map_id = "kurukshetra"

        room = self._find_open_room(map_id)
        if room is None:
            room = GameRoom(str(uuid.uuid4())[:8], map_id)
            self.rooms[room.id] = room
            self._loops[room.id] = asyncio.create_task(self._run(room))

        pid = player_id or str(uuid.uuid4())
        # guard against a duplicate id already in the room
        if pid in room.players:
            pid = f"{pid}-{str(uuid.uuid4())[:4]}"
        player = room.add_player(pid, ws, name, hero, weapon)
        return room, player

    async def leave(self, room: GameRoom, pid: str) -> None:
        room.remove_player(pid)

    async def _run(self, room: GameRoom) -> None:
        target = DT
        try:
            while True:
                start = time.perf_counter()
                room.step(DT)
                await self._broadcast(room, room.snapshot())

                # tear-down conditions
                if not room.players and room.status == "playing":
                    break
                if room.status in ("victory", "defeat"):
                    if not room._persisted:
                        room._persisted = True
                        await self._persist(room)
                    room._final_broadcasts += 1
                    if room._final_broadcasts >= TICK_HZ:  # ~1s of final frames
                        break

                elapsed = time.perf_counter() - start
                await asyncio.sleep(max(0.0, target - elapsed))
        except asyncio.CancelledError:  # pragma: no cover
            raise
        except Exception:  # noqa
            logger.exception("room %s loop crashed", room.id)
        finally:
            self.rooms.pop(room.id, None)
            self._loops.pop(room.id, None)

    async def _persist(self, room: GameRoom) -> None:
        if _persist_match is None:
            return
        victory = room.status == "victory"
        survived = int(room.elapsed)
        for p in room.players.values():
            try:
                await _persist_match(p.id, p.kills + p.bonus_coins // 10, survived, victory)
            except Exception:  # noqa
                logger.exception("persist match failed for %s", p.id)

    async def _broadcast(self, room: GameRoom, msg: dict) -> None:
        dead: List[str] = []
        for pid, p in list(room.players.items()):
            try:
                await p.ws.send_json(msg)
            except Exception:  # noqa
                dead.append(pid)
        for pid in dead:
            room.remove_player(pid)

    async def shutdown(self) -> None:
        for task in list(self._loops.values()):
            task.cancel()
        for task in list(self._loops.values()):
            try:
                await task
            except (asyncio.CancelledError, Exception):  # noqa
                pass
        self._loops.clear()
        self.rooms.clear()


room_manager = RoomManager()


async def shutdown() -> None:
    await room_manager.shutdown()


# ---------- WebSocket route ----------
def register_routes(router) -> None:
    """Attach the ``/ws/battle`` WebSocket endpoint to the given router.

    ``WebSocket``/``WebSocketDisconnect`` are imported at module scope so the
    (stringified) type annotations resolve correctly under
    ``from __future__ import annotations``."""

    @router.websocket("/ws/battle")
    async def battle_ws(ws: WebSocket):  # noqa: ANN001
        await ws.accept()
        room: Optional[GameRoom] = None
        pid: Optional[str] = None
        try:
            join_msg = await ws.receive_json()
            if join_msg.get("t") != "join":
                await ws.send_json({"t": "error", "message": "expected join"})
                await ws.close()
                return

            name = str(join_msg.get("name") or "Warrior")[:20]
            hero_id = str(join_msg.get("hero") or "arjuna")
            weapon_id = str(join_msg.get("weapon") or "brahmastra")
            map_id = str(join_msg.get("map") or "kurukshetra")
            player_id = join_msg.get("player_id")

            room, player = await room_manager.join(ws, player_id, name, hero_id, weapon_id, map_id)
            pid = player.id

            await ws.send_json({
                "t": "welcome",
                "self_id": pid,
                "room_id": room.id,
                "map": map_id,
                "map_bg": room.map_bg,
                "tick_rate": TICK_HZ,
                "arena": {"w": ARENA_W, "h": ARENA_H},
                "total_waves": room.total_waves,
                "max_players": MAX_PLAYERS,
            })

            while True:
                data = await ws.receive_json()
                mt = data.get("t")
                if mt == "input":
                    mv = data.get("move") or {}
                    player.in_move_x = float(mv.get("x", 0.0) or 0.0)
                    player.in_move_y = float(mv.get("y", 0.0) or 0.0)
                    aim = data.get("aim")
                    if aim and isinstance(aim, dict):
                        player.in_aim = (float(aim.get("x", 0.0) or 0.0), float(aim.get("y", 0.0) or 0.0))
                    else:
                        player.in_aim = None
                    player.in_fire = bool(data.get("fire", False))
                    if data.get("ability"):
                        player.in_ability = True
                elif mt == "ping":
                    await ws.send_json({"t": "pong", "ts": data.get("ts")})
                elif mt == "leave":
                    break
        except WebSocketDisconnect:
            pass
        except Exception:  # noqa
            logger.exception("battle_ws error")
        finally:
            if room is not None and pid is not None:
                await room_manager.leave(room, pid)
            try:
                await ws.close()
            except Exception:  # noqa
                pass
