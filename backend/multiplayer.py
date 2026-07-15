"""
Authoritative co-op multiplayer for Dharma Battle.

REST room lobby + WebSocket game channel. The server owns the sim;
clients send inputs and render snapshots.
"""
from __future__ import annotations

import asyncio
import math
import random
import string
import time
import uuid
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple

from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect
from pydantic import BaseModel

# Logical arena shared by all clients (clients scale to their screen).
ARENA_W = 800.0
ARENA_H = 500.0
TICK_HZ = 20
TICK_DT = 1.0 / TICK_HZ
MAX_PLAYERS = 4
ABILITY_COOLDOWN = 12.0

# Mirrored from server game config (ids only — stats pulled at join).
DEFAULT_MAP = "kurukshetra"

mp_router = APIRouter(prefix="/api/mp")


# ---------- REST models ----------
class CreateRoomRequest(BaseModel):
    player_id: str
    player_name: str
    hero_id: str = "arjuna"
    weapon_id: str = "brahmastra"
    map_id: str = DEFAULT_MAP


class JoinRoomRequest(BaseModel):
    player_id: str
    player_name: str
    hero_id: str = "arjuna"
    weapon_id: str = "brahmastra"
    code: str


class RoomSummary(BaseModel):
    code: str
    map_id: str
    host_id: str
    phase: str
    player_count: int
    max_players: int = MAX_PLAYERS
    players: List[Dict[str, Any]]


# ---------- Sim helpers ----------
def _len(x: float, y: float) -> float:
    return math.hypot(x, y)


def _norm(x: float, y: float) -> Tuple[float, float]:
    l = _len(x, y) or 1.0
    return x / l, y / l


def _code(n: int = 5) -> str:
    alphabet = string.ascii_uppercase + string.digits
    # Avoid ambiguous chars
    alphabet = alphabet.replace("O", "").replace("0", "").replace("I", "").replace("1", "")
    return "".join(random.choice(alphabet) for _ in range(n))


@dataclass
class HeroStats:
    id: str
    name: str
    hp: float
    atk: float
    spd: float
    color: str
    letter: str


@dataclass
class WeaponStats:
    id: str
    name: str
    damage: float
    cooldown: float
    color: str


@dataclass
class MapStats:
    id: str
    name: str
    waves: int
    bg: str
    difficulty: int = 1


@dataclass
class PlayerState:
    player_id: str
    name: str
    hero: HeroStats
    weapon: WeaponStats
    x: float = ARENA_W / 2
    y: float = ARENA_H / 2
    hp: float = 100
    max_hp: float = 100
    kills: int = 0
    ready: bool = False
    alive: bool = True
    invuln: float = 0.0
    fire_cd: float = 0.0
    ability_cd: float = 0.0
    # Latest input
    mx: float = 0.0
    my: float = 0.0
    fire_x: Optional[float] = None
    fire_y: Optional[float] = None
    ability: bool = False
    connected: bool = True
    ws: Optional[WebSocket] = field(default=None, repr=False)


@dataclass
class Enemy:
    id: int
    x: float
    y: float
    hp: float
    max_hp: float
    radius: float
    speed: float
    damage: float
    color: str
    type: str


@dataclass
class Bullet:
    id: int
    owner_id: str
    x: float
    y: float
    vx: float
    vy: float
    life: float
    damage: float
    color: str


@dataclass
class Drop:
    id: int
    x: float
    y: float
    kind: str  # hp | coin


@dataclass
class Room:
    code: str
    host_id: str
    map: MapStats
    players: Dict[str, PlayerState] = field(default_factory=dict)
    phase: str = "lobby"  # lobby | playing | finished
    enemies: List[Enemy] = field(default_factory=list)
    bullets: List[Bullet] = field(default_factory=list)
    drops: List[Drop] = field(default_factory=list)
    wave: int = 1
    enemies_left: int = 0
    spawn_cd: float = 0.0
    elapsed: float = 0.0
    victory: Optional[bool] = None
    uniq: int = 1
    tick_task: Optional[asyncio.Task] = field(default=None, repr=False)
    created_at: float = field(default_factory=time.time)
    rewards_granted: bool = False
    feed: List[str] = field(default_factory=list)

    def summary(self) -> Dict[str, Any]:
        return {
            "code": self.code,
            "map_id": self.map.id,
            "map_name": self.map.name,
            "host_id": self.host_id,
            "phase": self.phase,
            "player_count": len(self.players),
            "max_players": MAX_PLAYERS,
            "players": [
                {
                    "player_id": p.player_id,
                    "name": p.name,
                    "hero_id": p.hero.id,
                    "weapon_id": p.weapon.id,
                    "ready": p.ready,
                    "connected": p.connected,
                    "color": p.hero.color,
                    "letter": p.hero.letter,
                }
                for p in self.players.values()
            ],
        }

    def snapshot(self) -> Dict[str, Any]:
        return {
            "type": "snapshot",
            "phase": self.phase,
            "wave": self.wave,
            "total_waves": self.map.waves,
            "elapsed": round(self.elapsed, 2),
            "arena": {"w": ARENA_W, "h": ARENA_H, "bg": self.map.bg},
            "feed": self.feed[-6:],
            "players": [
                {
                    "id": p.player_id,
                    "name": p.name,
                    "x": round(p.x, 1),
                    "y": round(p.y, 1),
                    "hp": round(p.hp, 1),
                    "max_hp": p.max_hp,
                    "alive": p.alive,
                    "kills": p.kills,
                    "color": p.hero.color,
                    "letter": p.hero.letter,
                    "ability_cd": round(p.ability_cd, 1),
                    "invuln": p.invuln > 0,
                }
                for p in self.players.values()
            ],
            "enemies": [
                {
                    "id": e.id,
                    "x": round(e.x, 1),
                    "y": round(e.y, 1),
                    "hp": round(e.hp, 1),
                    "max_hp": e.max_hp,
                    "radius": e.radius,
                    "color": e.color,
                    "type": e.type,
                }
                for e in self.enemies
            ],
            "bullets": [
                {"id": b.id, "x": round(b.x, 1), "y": round(b.y, 1), "color": b.color}
                for b in self.bullets
            ],
            "drops": [
                {"id": d.id, "x": round(d.x, 1), "y": round(d.y, 1), "kind": d.kind}
                for d in self.drops
            ],
        }


class RoomManager:
    def __init__(self) -> None:
        self.rooms: Dict[str, Room] = {}
        self._hero_lookup: Dict[str, HeroStats] = {}
        self._weapon_lookup: Dict[str, WeaponStats] = {}
        self._map_lookup: Dict[str, MapStats] = {}
        self._reward_cb = None  # async (player_id, map_id, kills, seconds, victory) -> None

    def configure(
        self,
        heroes: List[dict],
        weapons: List[dict],
        maps: List[dict],
        reward_cb=None,
    ) -> None:
        self._hero_lookup = {
            h["id"]: HeroStats(
                id=h["id"], name=h["name"], hp=float(h["hp"]), atk=float(h["atk"]),
                spd=float(h["spd"]), color=h["color"], letter=h["letter"],
            )
            for h in heroes
        }
        self._weapon_lookup = {
            w["id"]: WeaponStats(
                id=w["id"], name=w["name"], damage=float(w["damage"]),
                cooldown=float(w["cooldown"]), color=w["color"],
            )
            for w in weapons
        }
        self._map_lookup = {
            m["id"]: MapStats(
                id=m["id"], name=m["name"], waves=int(m["waves"]),
                bg=m["bg"], difficulty=int(m.get("difficulty", 1)),
            )
            for m in maps
        }
        self._reward_cb = reward_cb

    def hero(self, hero_id: str) -> HeroStats:
        return self._hero_lookup.get(hero_id) or self._hero_lookup["arjuna"]

    def weapon(self, weapon_id: str) -> WeaponStats:
        return self._weapon_lookup.get(weapon_id) or self._weapon_lookup["brahmastra"]

    def map_stats(self, map_id: str) -> MapStats:
        return self._map_lookup.get(map_id) or self._map_lookup[DEFAULT_MAP]

    def list_open(self) -> List[Dict[str, Any]]:
        return [r.summary() for r in self.rooms.values() if r.phase == "lobby"]

    def get(self, code: str) -> Room:
        room = self.rooms.get(code.upper())
        if not room:
            raise HTTPException(404, "Room not found")
        return room

    def create(
        self,
        player_id: str,
        player_name: str,
        hero_id: str,
        weapon_id: str,
        map_id: str,
    ) -> Room:
        # One room per player as host — drop empty old lobby rooms for this player
        for code, r in list(self.rooms.items()):
            if r.phase == "lobby" and r.host_id == player_id and not any(
                p.connected for p in r.players.values() if p.player_id != player_id
            ):
                self.rooms.pop(code, None)

        for _ in range(20):
            code = _code()
            if code not in self.rooms:
                break
        else:
            code = uuid.uuid4().hex[:5].upper()

        hero = self.hero(hero_id)
        weapon = self.weapon(weapon_id)
        m = self.map_stats(map_id)
        room = Room(code=code, host_id=player_id, map=m)
        ps = PlayerState(
            player_id=player_id,
            name=player_name[:20] or "Warrior",
            hero=hero,
            weapon=weapon,
            hp=hero.hp,
            max_hp=hero.hp,
        )
        room.players[player_id] = ps
        self.rooms[code] = room
        return room

    def join(
        self,
        code: str,
        player_id: str,
        player_name: str,
        hero_id: str,
        weapon_id: str,
    ) -> Room:
        room = self.get(code)
        if room.phase != "lobby":
            raise HTTPException(400, "Match already started")
        if player_id in room.players:
            # Rejoin lobby seat
            p = room.players[player_id]
            p.name = player_name[:20] or p.name
            p.hero = self.hero(hero_id)
            p.weapon = self.weapon(weapon_id)
            p.hp = p.hero.hp
            p.max_hp = p.hero.hp
            p.connected = True
            return room
        if len(room.players) >= MAX_PLAYERS:
            raise HTTPException(400, "Room full")
        hero = self.hero(hero_id)
        weapon = self.weapon(weapon_id)
        room.players[player_id] = PlayerState(
            player_id=player_id,
            name=player_name[:20] or "Warrior",
            hero=hero,
            weapon=weapon,
            hp=hero.hp,
            max_hp=hero.hp,
            x=ARENA_W / 2 + (len(room.players) - 1) * 40,
            y=ARENA_H / 2,
        )
        return room

    async def broadcast(self, room: Room, payload: dict) -> None:
        dead: List[str] = []
        for pid, p in room.players.items():
            if not p.ws:
                continue
            try:
                await p.ws.send_json(payload)
            except Exception:
                dead.append(pid)
        for pid in dead:
            p = room.players.get(pid)
            if p:
                p.connected = False
                p.ws = None

    async def start_match(self, room: Room) -> None:
        if room.phase != "lobby":
            return
        if len(room.players) < 1:
            return
        room.phase = "playing"
        room.wave = 1
        room.elapsed = 0.0
        room.enemies.clear()
        room.bullets.clear()
        room.drops.clear()
        room.feed = [f"WAVE 1 — {room.map.name}"]
        room.enemies_left = 4 + room.wave * 2
        room.spawn_cd = 0.5
        # Spread spawn positions
        n = len(room.players)
        for i, p in enumerate(room.players.values()):
            p.alive = True
            p.hp = p.max_hp
            p.kills = 0
            p.invuln = 1.0
            p.fire_cd = 0.0
            p.ability_cd = 0.0
            p.x = ARENA_W * (0.3 + 0.4 * (i / max(1, n - 1 if n > 1 else 1)))
            p.y = ARENA_H / 2
            p.ready = True
        await self.broadcast(room, {**room.snapshot(), "type": "match_start", "room": room.summary()})
        if room.tick_task and not room.tick_task.done():
            room.tick_task.cancel()
        room.tick_task = asyncio.create_task(self._tick_loop(room))

    async def _tick_loop(self, room: Room) -> None:
        try:
            while room.phase == "playing":
                t0 = time.perf_counter()
                self._simulate(room, TICK_DT)
                await self.broadcast(room, room.snapshot())
                if room.phase != "playing":
                    break
                elapsed = time.perf_counter() - t0
                await asyncio.sleep(max(0.0, TICK_DT - elapsed))
            if room.phase == "finished" and not room.rewards_granted:
                await self._finish(room)
        except asyncio.CancelledError:
            return
        except Exception:
            room.phase = "finished"
            room.victory = False
            if not room.rewards_granted:
                await self._finish(room)

    def _spawn_enemy(self, room: Room) -> None:
        roll = random.random()
        etype = "grunt"
        if roll > 0.85:
            etype = "brute"
        elif roll > 0.6:
            etype = "swift"
        wave_mult = 1 + (room.wave - 1) * 0.15
        base = {
            "grunt": {"hp": 30, "speed": 55, "damage": 8, "radius": 16, "color": "#8E24AA"},
            "swift": {"hp": 22, "speed": 90, "damage": 6, "radius": 13, "color": "#26C6DA"},
            "brute": {"hp": 80, "speed": 40, "damage": 18, "radius": 22, "color": "#D84315"},
        }[etype]
        side = random.randint(0, 3)
        if side == 0:
            x, y = random.random() * ARENA_W, -20
        elif side == 1:
            x, y = ARENA_W + 20, random.random() * ARENA_H
        elif side == 2:
            x, y = random.random() * ARENA_W, ARENA_H + 20
        else:
            x, y = -20, random.random() * ARENA_H
        room.uniq += 1
        room.enemies.append(
            Enemy(
                id=room.uniq,
                x=x,
                y=y,
                hp=base["hp"] * wave_mult,
                max_hp=base["hp"] * wave_mult,
                radius=base["radius"],
                speed=base["speed"] * wave_mult,
                damage=base["damage"] * wave_mult,
                color=base["color"],
                type=etype,
            )
        )

    def _fire(self, room: Room, p: PlayerState, tx: float, ty: float) -> None:
        dx, dy = _norm(tx - p.x, ty - p.y)
        speed = 520.0
        room.uniq += 1
        room.bullets.append(
            Bullet(
                id=room.uniq,
                owner_id=p.player_id,
                x=p.x,
                y=p.y,
                vx=dx * speed,
                vy=dy * speed,
                life=1.4,
                damage=p.weapon.damage,
                color=p.weapon.color,
            )
        )

    def _damage_enemy(self, room: Room, e: Enemy, dmg: float, owner_id: str) -> None:
        e.hp -= dmg
        if e.hp <= 0:
            owner = room.players.get(owner_id)
            if owner:
                owner.kills += 1
            room.feed.append(f"+1 {e.type.upper()}")
            roll = random.random()
            room.uniq += 1
            if roll < 0.18:
                room.drops.append(Drop(id=room.uniq, x=e.x, y=e.y, kind="hp"))
            elif roll < 0.4:
                room.drops.append(Drop(id=room.uniq, x=e.x, y=e.y, kind="coin"))

    def _ability(self, room: Room, p: PlayerState) -> None:
        if p.ability_cd > 0 or not p.alive:
            return
        p.ability_cd = ABILITY_COOLDOWN
        hid = p.hero.id
        if hid == "arjuna":
            for i in range(12):
                a = (i / 12) * math.pi * 2
                self._fire(room, p, p.x + math.cos(a) * 200, p.y + math.sin(a) * 200)
            room.feed.append(f"{p.name}: RAPID FIRE!")
        elif hid == "bhima":
            R = 180
            for e in room.enemies:
                if _len(e.x - p.x, e.y - p.y) < R:
                    self._damage_enemy(room, e, 80, p.player_id)
            room.feed.append(f"{p.name}: GROUND SLAM!")
        elif hid == "hanuman":
            jx, jy = p.mx, p.my
            if _len(jx, jy) < 0.05:
                jx, jy = 0.0, -1.0
            dx, dy = _norm(jx, jy)
            p.x = max(30.0, min(ARENA_W - 30, p.x + dx * 220))
            p.y = max(30.0, min(ARENA_H - 30, p.y + dy * 220))
            p.invuln = 1.5
            room.feed.append(f"{p.name}: DIVINE LEAP!")
        elif hid == "karna":
            for e in room.enemies:
                self._damage_enemy(room, e, 60, p.player_id)
            room.feed.append(f"{p.name}: SUN BLAST!")

    def _simulate(self, room: Room, dt: float) -> None:
        room.elapsed += dt
        room.feed = room.feed[-8:]

        # Players
        for p in room.players.values():
            if not p.alive:
                continue
            p.invuln = max(0.0, p.invuln - dt)
            p.ability_cd = max(0.0, p.ability_cd - dt)
            p.fire_cd = max(0.0, p.fire_cd - dt)

            spd = p.hero.spd * 26
            p.x = max(20.0, min(ARENA_W - 20, p.x + p.mx * spd * dt))
            p.y = max(20.0, min(ARENA_H - 20, p.y + p.my * spd * dt))

            if p.ability:
                self._ability(room, p)
                p.ability = False

            # Explicit aim fire
            if p.fire_x is not None and p.fire_y is not None and p.fire_cd <= 0:
                self._fire(room, p, p.fire_x, p.fire_y)
                p.fire_cd = p.weapon.cooldown
                p.fire_x = None
                p.fire_y = None
            elif p.fire_cd <= 0 and room.enemies:
                # Auto-fire nearest
                nearest = None
                nd = 1e9
                for e in room.enemies:
                    d = _len(e.x - p.x, e.y - p.y)
                    if d < nd:
                        nd = d
                        nearest = e
                if nearest and nd < 380:
                    self._fire(room, p, nearest.x, nearest.y)
                    p.fire_cd = p.weapon.cooldown

        # Bullets
        alive_bullets: List[Bullet] = []
        for b in room.bullets:
            b.x += b.vx * dt
            b.y += b.vy * dt
            b.life -= dt
            if b.life <= 0 or b.x < -30 or b.x > ARENA_W + 30 or b.y < -30 or b.y > ARENA_H + 30:
                continue
            hit = False
            for e in room.enemies:
                if _len(b.x - e.x, b.y - e.y) < e.radius + 4:
                    self._damage_enemy(room, e, b.damage, b.owner_id)
                    hit = True
                    break
            if not hit:
                alive_bullets.append(b)
        room.bullets = alive_bullets
        room.enemies = [e for e in room.enemies if e.hp > 0]

        # Enemies chase nearest living player
        for e in room.enemies:
            target = None
            td = 1e9
            for p in room.players.values():
                if not p.alive:
                    continue
                d = _len(e.x - p.x, e.y - p.y)
                if d < td:
                    td = d
                    target = p
            if not target:
                continue
            dx, dy = _norm(target.x - e.x, target.y - e.y)
            e.x += dx * e.speed * dt
            e.y += dy * e.speed * dt
            if td < e.radius + 20 and target.invuln <= 0:
                target.hp -= e.damage * dt
                if target.hp <= 0:
                    target.hp = 0
                    target.alive = False
                    room.feed.append(f"{target.name} fell!")

        # Drops
        remain_drops: List[Drop] = []
        for d in room.drops:
            picked = False
            for p in room.players.values():
                if not p.alive:
                    continue
                if _len(d.x - p.x, d.y - p.y) < 28:
                    if d.kind == "hp":
                        p.hp = min(p.max_hp, p.hp + p.max_hp * 0.25)
                    picked = True
                    break
            if not picked:
                remain_drops.append(d)
        room.drops = remain_drops

        # Spawns
        room.spawn_cd -= dt
        if room.enemies_left > 0 and room.spawn_cd <= 0 and len(room.enemies) < 10:
            self._spawn_enemy(room)
            room.enemies_left -= 1
            room.spawn_cd = max(0.4, 1.4 - room.wave * 0.08)

        # Wave / win
        if room.enemies_left <= 0 and not room.enemies:
            if room.wave >= room.map.waves:
                room.phase = "finished"
                room.victory = True
                return
            room.wave += 1
            room.enemies_left = 4 + room.wave * 2
            room.spawn_cd = 1.0
            room.feed.append(f"WAVE {room.wave}")

        # All dead → defeat
        if room.players and all(not p.alive for p in room.players.values()):
            room.phase = "finished"
            room.victory = False

    async def _finish(self, room: Room) -> None:
        if room.rewards_granted:
            return
        victory = bool(room.victory)
        room.feed.append("VICTORY!" if victory else "DEFEAT")

        results = []
        for p in room.players.values():
            results.append({
                "player_id": p.player_id,
                "name": p.name,
                "kills": p.kills,
                "alive": p.alive,
            })
            if self._reward_cb:
                try:
                    await self._reward_cb(
                        p.player_id,
                        room.map.id,
                        p.kills,
                        int(room.elapsed),
                        victory,
                    )
                except Exception:
                    pass
        room.rewards_granted = True

        await self.broadcast(
            room,
            {
                "type": "match_end",
                "victory": victory,
                "elapsed": int(room.elapsed),
                "results": results,
                "snapshot": room.snapshot(),
            },
        )

    async def handle_ws(self, websocket: WebSocket, code: str, player_id: str) -> None:
        await websocket.accept()
        try:
            room = self.get(code)
        except HTTPException:
            await websocket.send_json({"type": "error", "message": "Room not found"})
            await websocket.close()
            return

        p = room.players.get(player_id)
        if not p:
            await websocket.send_json({"type": "error", "message": "Join room via REST first"})
            await websocket.close()
            return

        p.ws = websocket
        p.connected = True
        await self.broadcast(room, {"type": "room_state", "room": room.summary()})

        try:
            while True:
                raw = await websocket.receive_json()
                msg_type = raw.get("type")
                if msg_type == "ready":
                    p.ready = bool(raw.get("ready", True))
                    await self.broadcast(room, {"type": "room_state", "room": room.summary()})
                    # Host can force-start, or auto-start when all ready (min 1)
                    if room.phase == "lobby":
                        all_ready = all(pl.ready for pl in room.players.values())
                        host_start = raw.get("start") and player_id == room.host_id
                        if (all_ready and len(room.players) >= 1) or host_start:
                            # Require host ready for auto-start
                            if host_start or (all_ready and room.players[room.host_id].ready):
                                await self.start_match(room)
                elif msg_type == "input" and room.phase == "playing":
                    p.mx = max(-1.0, min(1.0, float(raw.get("mx", 0))))
                    p.my = max(-1.0, min(1.0, float(raw.get("my", 0))))
                    if "fire_x" in raw and raw["fire_x"] is not None:
                        p.fire_x = float(raw["fire_x"])
                        p.fire_y = float(raw.get("fire_y", p.y))
                    if raw.get("ability"):
                        p.ability = True
                elif msg_type == "ping":
                    await websocket.send_json({"type": "pong", "t": raw.get("t")})
                elif msg_type == "leave":
                    break
        except WebSocketDisconnect:
            pass
        except Exception:
            pass
        finally:
            p.connected = False
            p.ws = None
            p.mx = 0.0
            p.my = 0.0
            if room.phase == "lobby":
                # Remove from lobby if disconnected
                room.players.pop(player_id, None)
                if not room.players:
                    if room.tick_task and not room.tick_task.done():
                        room.tick_task.cancel()
                    self.rooms.pop(room.code, None)
                else:
                    if room.host_id == player_id:
                        room.host_id = next(iter(room.players))
                    await self.broadcast(room, {"type": "room_state", "room": room.summary()})
            elif room.phase == "playing":
                await self.broadcast(room, {"type": "room_state", "room": room.summary()})


manager = RoomManager()


# ---------- Routes (bound after configure from server.py) ----------
@mp_router.post("/rooms", response_model=RoomSummary)
async def create_room(req: CreateRoomRequest):
    room = manager.create(req.player_id, req.player_name, req.hero_id, req.weapon_id, req.map_id)
    return RoomSummary(**room.summary())


@mp_router.post("/rooms/join", response_model=RoomSummary)
async def join_room(req: JoinRoomRequest):
    room = manager.join(req.code, req.player_id, req.player_name, req.hero_id, req.weapon_id)
    return RoomSummary(**room.summary())


@mp_router.get("/rooms")
async def list_rooms():
    return manager.list_open()


@mp_router.get("/rooms/{code}", response_model=RoomSummary)
async def get_room(code: str):
    room = manager.get(code)
    return RoomSummary(**room.summary())


@mp_router.websocket("/ws/{code}")
async def mp_ws(websocket: WebSocket, code: str, player_id: str = ""):
    if not player_id:
        await websocket.close(code=4400)
        return
    await manager.handle_ws(websocket, code.upper(), player_id)
