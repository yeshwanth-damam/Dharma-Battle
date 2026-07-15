"""Authoritative real-time multiplayer battle server for Dharma Battle.

Squad co-op over WebSockets: up to 4 players share one arena and fight
synchronized AI waves. The server owns ALL game state (enemies, bullets,
player HP, waves, drops) and simulates at 20 Hz; clients only send inputs
(joystick vector, tap-fire target, ability trigger). This keeps the game
cheat-resistant and every client perfectly in sync.

Wire protocol (JSON over ws at /api/ws/battle):

  client -> server
    {"type": "join", "player_id": str, "mode": "quick"|"create"|"code",
     "code": str?, "map_id": str?}
    {"type": "start"}                      # host only, lobby state
    {"type": "input", "move": {"x", "y"}, "fire": {"x", "y"}?, "ability": bool}
    {"type": "leave"}
    {"type": "ping"}

  server -> client
    {"type": "joined", "room_id", "code", "you", "map", "host"}
    {"type": "lobby", "players": [...], "host", "countdown": float?}
    {"type": "start", "arena": {"w", "h"}, "map", "waves_total"}
    {"type": "state", ...}                 # 20 Hz snapshot
    {"type": "end", "victory": bool, "stats": [...], "rewards": {...}}
    {"type": "error", "message"}
    {"type": "pong"}
"""
import asyncio
import logging
import math
import random
import secrets
import uuid
from datetime import datetime, timezone
from typing import Dict, List, Optional

from fastapi import FastAPI, WebSocket, WebSocketDisconnect

logger = logging.getLogger("multiplayer")

# ---------- Simulation constants (mirror the single-player battle) ----------
TICK = 0.05          # 20 Hz authoritative tick
ARENA_W = 800.0      # logical arena; clients scale to their screens
ARENA_H = 520.0
MAX_PLAYERS = 4
QUICK_AUTO_START = 8.0   # seconds after 2+ players queue up
PLAYER_RADIUS = 20.0
BULLET_SPEED = 520.0
BULLET_LIFE = 1.4
AUTO_FIRE_RANGE = 380.0
ABILITY_COOLDOWN = 12.0

ENEMY_BASE = {
    "grunt": {"hp": 30, "speed": 55, "damage": 8, "radius": 16, "color": "#8E24AA"},
    "swift": {"hp": 22, "speed": 90, "damage": 6, "radius": 13, "color": "#26C6DA"},
    "brute": {"hp": 80, "speed": 40, "damage": 18, "radius": 22, "color": "#D84315"},
}


def _norm(x: float, y: float):
    l = math.hypot(x, y) or 1.0
    return x / l, y / l


class RoomPlayer:
    def __init__(self, doc: dict, hero: dict, weapon: dict, ws: WebSocket):
        self.id: str = doc["id"]
        self.name: str = doc.get("name", "Warrior")
        self.hero = hero
        self.weapon = weapon
        self.ws = ws
        self.connected = True
        # sim state
        self.x = ARENA_W / 2
        self.y = ARENA_H / 2
        self.hp = float(hero["hp"])
        self.max_hp = float(hero["hp"])
        self.alive = True
        self.kills = 0
        self.bonus_coins = 0
        self.invuln = 0.0
        self.fire_cd = 0.0
        self.ability_cd = 0.0
        # inputs
        self.move_x = 0.0
        self.move_y = 0.0
        self.pending_fire: Optional[dict] = None
        self.pending_ability = False

    def public(self) -> dict:
        return {
            "id": self.id,
            "name": self.name,
            "hero": self.hero["id"],
            "color": self.hero["color"],
            "letter": self.hero["letter"],
            "x": round(self.x, 1),
            "y": round(self.y, 1),
            "hp": round(max(0.0, self.hp), 1),
            "max_hp": self.max_hp,
            "kills": self.kills,
            "alive": self.alive,
            "invuln": self.invuln > 0,
            "ability_cd": round(self.ability_cd, 1),
        }

    def lobby_public(self) -> dict:
        return {"id": self.id, "name": self.name, "hero": self.hero["id"],
                "color": self.hero["color"], "letter": self.hero["letter"]}


class Room:
    def __init__(self, mode: str, map_obj: dict):
        self.id = str(uuid.uuid4())
        self.code = secrets.token_hex(3).upper()  # 6-char join code
        self.mode = mode  # "quick" | "private"
        self.map = map_obj
        self.state = "waiting"  # waiting | playing | finished
        self.players: Dict[str, RoomPlayer] = {}
        self.order: List[str] = []  # join order; order[0] is host
        self.auto_start_at: Optional[float] = None
        self.task: Optional[asyncio.Task] = None
        # sim state
        self.enemies: List[dict] = []
        self.bullets: List[dict] = []
        self.drops: List[dict] = []
        self.feed: List[str] = []
        self.wave = 0
        self.enemies_left = 0
        self.spawn_cd = 0.0
        self.elapsed = 0.0
        self._uid = 0

    # ----- helpers -----
    def uid(self) -> int:
        self._uid += 1
        return self._uid

    @property
    def host_id(self) -> Optional[str]:
        return self.order[0] if self.order else None

    def connected_players(self) -> List[RoomPlayer]:
        return [self.players[pid] for pid in self.order if self.players[pid].connected]

    async def broadcast(self, msg: dict):
        for p in list(self.players.values()):
            if not p.connected:
                continue
            try:
                await p.ws.send_json(msg)
            except Exception:
                p.connected = False

    def lobby_msg(self) -> dict:
        countdown = None
        if self.auto_start_at is not None:
            countdown = max(0.0, self.auto_start_at - asyncio.get_event_loop().time())
        return {
            "type": "lobby",
            "players": [self.players[pid].lobby_public() for pid in self.order],
            "host": self.host_id,
            "code": self.code,
            "countdown": round(countdown, 1) if countdown is not None else None,
        }

    # ----- simulation -----
    def start_wave(self, w: int):
        self.wave = w
        n = max(1, len(self.order))
        self.enemies_left = int((4 + w * 2) * (1 + 0.5 * (n - 1)))
        self.feed.append(f"WAVE {w}")

    def spawn_enemy(self):
        roll = random.random()
        etype = "grunt"
        if roll > 0.85:
            etype = "brute"
        elif roll > 0.6:
            etype = "swift"
        base = ENEMY_BASE[etype]
        mult = 1 + (self.wave - 1) * 0.15
        side = random.randrange(4)
        if side == 0:
            x, y = random.random() * ARENA_W, -20.0
        elif side == 1:
            x, y = ARENA_W + 20.0, random.random() * ARENA_H
        elif side == 2:
            x, y = random.random() * ARENA_W, ARENA_H + 20.0
        else:
            x, y = -20.0, random.random() * ARENA_H
        self.enemies.append({
            "id": self.uid(), "x": x, "y": y, "type": etype,
            "hp": base["hp"] * mult, "max_hp": base["hp"] * mult,
            "r": float(base["radius"]), "speed": base["speed"] * mult,
            "damage": base["damage"] * mult, "color": base["color"],
        })

    def damage_enemy(self, e: dict, dmg: float, killer: Optional[RoomPlayer]):
        e["hp"] -= dmg
        if e["hp"] <= 0 and not e.get("dead"):
            e["dead"] = True
            if killer:
                killer.kills += 1
                self.feed.append(f"{killer.name} +1 {e['type'].upper()}")
            roll = random.random()
            if roll < 0.18:
                self.drops.append({"id": self.uid(), "x": e["x"], "y": e["y"], "kind": "hp"})
            elif roll < 0.4:
                self.drops.append({"id": self.uid(), "x": e["x"], "y": e["y"], "kind": "coin"})

    def fire_bullet(self, p: RoomPlayer, tx: float, ty: float):
        dx, dy = _norm(tx - p.x, ty - p.y)
        self.bullets.append({
            "id": self.uid(), "x": p.x, "y": p.y,
            "vx": dx * BULLET_SPEED, "vy": dy * BULLET_SPEED,
            "life": BULLET_LIFE, "damage": float(p.weapon["damage"]),
            "color": p.weapon["color"], "owner": p.id,
        })

    def trigger_ability(self, p: RoomPlayer):
        if p.ability_cd > 0 or not p.alive:
            return
        p.ability_cd = ABILITY_COOLDOWN
        hero = p.hero["id"]
        if hero == "arjuna":
            for i in range(12):
                a = (i / 12) * math.pi * 2
                self.fire_bullet(p, p.x + math.cos(a) * 200, p.y + math.sin(a) * 200)
            self.feed.append(f"{p.name}: RAPID FIRE ASTRA!")
        elif hero == "bhima":
            for e in self.enemies:
                if math.hypot(e["x"] - p.x, e["y"] - p.y) < 180:
                    self.damage_enemy(e, 80, p)
            self.feed.append(f"{p.name}: GROUND SLAM!")
        elif hero == "hanuman":
            dx, dy = (p.move_x, p.move_y)
            if math.hypot(dx, dy) < 0.05:
                dx, dy = 0.0, -1.0
            else:
                dx, dy = _norm(dx, dy)
            p.x = max(30.0, min(ARENA_W - 30.0, p.x + dx * 220))
            p.y = max(30.0, min(ARENA_H - 30.0, p.y + dy * 220))
            p.invuln = 1.5
            self.feed.append(f"{p.name}: DIVINE LEAP!")
        elif hero == "karna":
            for e in self.enemies:
                self.damage_enemy(e, 60, p)
            self.feed.append(f"{p.name}: SUN BLAST!")

    def step(self, dt: float) -> Optional[bool]:
        """Advance the sim one tick. Returns victory bool when finished, else None."""
        self.elapsed += dt
        alive_players = [p for p in self.players.values() if p.alive and p.connected]

        for p in self.players.values():
            if not p.connected:
                continue
            p.ability_cd = max(0.0, p.ability_cd - dt)
            p.invuln = max(0.0, p.invuln - dt)
            p.fire_cd -= dt
            if not p.alive:
                continue
            # movement
            spd = p.hero["spd"] * 26.0
            mlen = math.hypot(p.move_x, p.move_y)
            mx, my = (p.move_x, p.move_y) if mlen <= 1 else _norm(p.move_x, p.move_y)
            p.x = max(PLAYER_RADIUS, min(ARENA_W - PLAYER_RADIUS, p.x + mx * spd * dt))
            p.y = max(PLAYER_RADIUS, min(ARENA_H - PLAYER_RADIUS, p.y + my * spd * dt))
            # ability
            if p.pending_ability:
                p.pending_ability = False
                self.trigger_ability(p)
            # firing: tap-fire override, else auto-fire at nearest enemy
            if p.fire_cd <= 0:
                if p.pending_fire is not None:
                    self.fire_bullet(p, float(p.pending_fire["x"]), float(p.pending_fire["y"]))
                    p.fire_cd = float(p.weapon["cooldown"])
                    p.pending_fire = None
                elif self.enemies:
                    nearest, nd = None, math.inf
                    for e in self.enemies:
                        d = math.hypot(e["x"] - p.x, e["y"] - p.y)
                        if d < nd:
                            nd, nearest = d, e
                    if nearest is not None and nd < AUTO_FIRE_RANGE:
                        self.fire_bullet(p, nearest["x"], nearest["y"])
                        p.fire_cd = float(p.weapon["cooldown"])

        # bullets
        keep_bullets = []
        for b in self.bullets:
            b["x"] += b["vx"] * dt
            b["y"] += b["vy"] * dt
            b["life"] -= dt
            if b["life"] <= 0 or b["x"] < -20 or b["x"] > ARENA_W + 20 or b["y"] < -20 or b["y"] > ARENA_H + 20:
                continue
            hit = False
            for e in self.enemies:
                if e.get("dead"):
                    continue
                if math.hypot(b["x"] - e["x"], b["y"] - e["y"]) < e["r"] + 4:
                    owner = self.players.get(b["owner"])
                    self.damage_enemy(e, b["damage"], owner)
                    hit = True
                    break
            if not hit:
                keep_bullets.append(b)
        self.bullets = keep_bullets

        # enemies chase nearest alive player
        keep_enemies = []
        for e in self.enemies:
            if e.get("dead"):
                continue
            if alive_players:
                target = min(alive_players, key=lambda p: math.hypot(p.x - e["x"], p.y - e["y"]))
                dx, dy = _norm(target.x - e["x"], target.y - e["y"])
                e["x"] += dx * e["speed"] * dt
                e["y"] += dy * e["speed"] * dt
                if math.hypot(e["x"] - target.x, e["y"] - target.y) < e["r"] + PLAYER_RADIUS and target.invuln <= 0:
                    target.hp -= e["damage"] * dt
                    if target.hp <= 0:
                        target.hp = 0
                        target.alive = False
                        self.feed.append(f"{target.name} HAS FALLEN")
            keep_enemies.append(e)
        self.enemies = keep_enemies

        # drops pickup (any alive player)
        keep_drops = []
        for d in self.drops:
            taken = False
            for p in alive_players:
                if math.hypot(d["x"] - p.x, d["y"] - p.y) < 28:
                    if d["kind"] == "hp":
                        p.hp = min(p.max_hp, p.hp + p.max_hp * 0.25)
                        self.feed.append(f"{p.name} +25% HP")
                    else:
                        p.bonus_coins += 5
                        self.feed.append(f"{p.name} +5 COINS")
                    taken = True
                    break
            if not taken:
                keep_drops.append(d)
        self.drops = keep_drops

        # wave spawning
        self.spawn_cd -= dt
        n = max(1, len(self.order))
        max_concurrent = 8 + 3 * (n - 1)
        if self.enemies_left > 0 and self.spawn_cd <= 0 and len(self.enemies) < max_concurrent:
            self.spawn_enemy()
            self.enemies_left -= 1
            self.spawn_cd = max(0.4, 1.4 - self.wave * 0.08)

        # wave / match end
        if self.enemies_left <= 0 and not self.enemies:
            if self.wave >= self.map["waves"]:
                return True
            self.start_wave(self.wave + 1)

        if not any(p.alive and p.connected for p in self.players.values()):
            return False
        return None

    def snapshot(self) -> dict:
        feed, self.feed = self.feed, []
        return {
            "type": "state",
            "wave": self.wave,
            "waves_total": self.map["waves"],
            "elapsed": round(self.elapsed, 1),
            "players": [self.players[pid].public() for pid in self.order],
            "enemies": [
                {"id": e["id"], "x": round(e["x"], 1), "y": round(e["y"], 1),
                 "hp": round(e["hp"], 1), "max_hp": round(e["max_hp"], 1),
                 "r": e["r"], "type": e["type"], "color": e["color"]}
                for e in self.enemies
            ],
            "bullets": [{"id": b["id"], "x": round(b["x"], 1), "y": round(b["y"], 1), "color": b["color"]} for b in self.bullets],
            "drops": [{"id": d["id"], "x": round(d["x"], 1), "y": round(d["y"], 1), "kind": d["kind"]} for d in self.drops],
            "feed": feed,
        }


class BattleServer:
    """Owns all rooms and the ws endpoint. Attached to the FastAPI app."""

    def __init__(self, db, heroes: List[dict], weapons: List[dict], maps: List[dict], xp_for_next):
        self.db = db
        self.heroes = {h["id"]: h for h in heroes}
        self.weapons = {w["id"]: w for w in weapons}
        self.maps = {m["id"]: m for m in maps}
        self.default_map = maps[0]["id"]
        self.rooms: Dict[str, Room] = {}
        self.xp_for_next = xp_for_next

    # ----- room lookup -----
    def find_quick_room(self, map_id: str) -> Optional[Room]:
        for r in self.rooms.values():
            if r.mode == "quick" and r.state == "waiting" and r.map["id"] == map_id and len(r.order) < MAX_PLAYERS:
                return r
        return None

    def room_by_code(self, code: str) -> Optional[Room]:
        for r in self.rooms.values():
            if r.code == code.upper():
                return r
        return None

    def status(self) -> dict:
        return {
            "rooms": len(self.rooms),
            "waiting": sum(1 for r in self.rooms.values() if r.state == "waiting"),
            "playing": sum(1 for r in self.rooms.values() if r.state == "playing"),
            "players_online": sum(len(r.connected_players()) for r in self.rooms.values()),
        }

    # ----- match lifecycle -----
    async def start_room(self, room: Room):
        if room.state != "waiting":
            return
        room.state = "playing"
        room.auto_start_at = None
        # spread players around the arena center
        n = len(room.order)
        for i, pid in enumerate(room.order):
            p = room.players[pid]
            angle = (i / max(1, n)) * math.pi * 2
            p.x = ARENA_W / 2 + (60 if n > 1 else 0) * math.cos(angle)
            p.y = ARENA_H / 2 + (60 if n > 1 else 0) * math.sin(angle)
        room.start_wave(1)
        await room.broadcast({
            "type": "start",
            "arena": {"w": ARENA_W, "h": ARENA_H},
            "map": room.map,
            "waves_total": room.map["waves"],
        })
        room.task = asyncio.create_task(self.run_room(room))

    async def run_room(self, room: Room):
        try:
            while room.state == "playing":
                t0 = asyncio.get_event_loop().time()
                result = room.step(TICK)
                await room.broadcast(room.snapshot())
                if result is not None:
                    await self.finish_room(room, victory=result)
                    return
                if not any(p.connected for p in room.players.values()):
                    room.state = "finished"
                    self.rooms.pop(room.id, None)
                    return
                elapsed = asyncio.get_event_loop().time() - t0
                await asyncio.sleep(max(0.0, TICK - elapsed))
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("room %s crashed", room.id)
            room.state = "finished"
            self.rooms.pop(room.id, None)

    async def finish_room(self, room: Room, victory: bool):
        room.state = "finished"
        survived = int(room.elapsed)
        rewards = {}
        stats = []
        for pid in room.order:
            p = room.players[pid]
            coin_reward = p.kills * 10 + (50 if victory else 10) + p.bonus_coins
            xp_reward = p.kills * 15 + (100 if victory else 25)
            score = p.kills * 100 + survived * 2 + (500 if victory else 0)
            rewards[pid] = {"coins": coin_reward, "xp": xp_reward, "score": score,
                            "kills": p.kills, "bonus_coins": p.bonus_coins, "survived": survived}
            stats.append({"id": pid, "name": p.name, "kills": p.kills, "alive": p.alive})
            try:
                await self._grant_rewards(pid, p.kills, coin_reward, xp_reward, score, victory)
            except Exception:
                logger.exception("reward grant failed for %s", pid)
        stats.sort(key=lambda s: s["kills"], reverse=True)
        try:
            await self.db.squad_matches.insert_one({
                "id": str(uuid.uuid4()),
                "room_id": room.id,
                "map_id": room.map["id"],
                "mode": room.mode,
                "victory": victory,
                "players": [{"id": s["id"], "name": s["name"], "kills": s["kills"]} for s in stats],
                "survived_seconds": survived,
                "created_at": datetime.now(timezone.utc).isoformat(),
            })
        except Exception:
            logger.exception("squad match log failed")
        await room.broadcast({"type": "end", "victory": victory, "stats": stats, "rewards": rewards})
        self.rooms.pop(room.id, None)

    async def _grant_rewards(self, player_id: str, kills: int, coins: int, xp: int, score: int, victory: bool):
        doc = await self.db.players.find_one({"id": player_id}, {"_id": 0})
        if not doc:
            return
        new_xp = doc.get("xp", 0) + xp
        new_level = doc.get("level", 1)
        while new_xp >= self.xp_for_next(new_level):
            new_xp -= self.xp_for_next(new_level)
            new_level += 1
        await self.db.players.update_one({"id": player_id}, {"$set": {
            "coins": doc.get("coins", 0) + coins,
            "xp": new_xp,
            "level": new_level,
            "kills": doc.get("kills", 0) + kills,
            "matches": doc.get("matches", 0) + 1,
            "wins": doc.get("wins", 0) + (1 if victory else 0),
            "best_score": max(doc.get("best_score", 0), score),
        }})

    def schedule_auto_start(self, room: Room):
        """Quick rooms auto-start a few seconds after a 2nd player queues up."""
        if room.mode != "quick" or room.state != "waiting" or room.auto_start_at is not None:
            return
        if len(room.order) < 2:
            return
        room.auto_start_at = asyncio.get_event_loop().time() + QUICK_AUTO_START

        async def _auto():
            await room.broadcast(room.lobby_msg())  # includes the countdown
            await asyncio.sleep(QUICK_AUTO_START)
            if room.state == "waiting" and len(room.connected_players()) >= 1:
                await self.start_room(room)

        asyncio.create_task(_auto())

    # ----- ws endpoint -----
    async def handle_socket(self, ws: WebSocket):
        await ws.accept()
        room: Optional[Room] = None
        me: Optional[RoomPlayer] = None
        try:
            # -- join handshake --
            msg = await ws.receive_json()
            if msg.get("type") != "join":
                await ws.send_json({"type": "error", "message": "First message must be join"})
                await ws.close()
                return
            doc = await self.db.players.find_one({"id": msg.get("player_id", "")}, {"_id": 0})
            if not doc:
                await ws.send_json({"type": "error", "message": "Player not found"})
                await ws.close()
                return

            hero = self.heroes.get(doc.get("selected_hero", ""), next(iter(self.heroes.values())))
            weapon = self.weapons.get(doc.get("selected_weapon", ""), next(iter(self.weapons.values())))
            mode = msg.get("mode", "quick")
            map_id = msg.get("map_id") or self.default_map
            if map_id not in self.maps:
                map_id = self.default_map

            if mode == "code":
                room = self.room_by_code(msg.get("code", "") or "")
                if room is None or room.state != "waiting":
                    await ws.send_json({"type": "error", "message": "Room not found or already started"})
                    await ws.close()
                    return
                if len(room.order) >= MAX_PLAYERS:
                    await ws.send_json({"type": "error", "message": "Room is full"})
                    await ws.close()
                    return
            elif mode == "create":
                room = Room("private", self.maps[map_id])
                self.rooms[room.id] = room
            else:  # quick match
                room = self.find_quick_room(map_id)
                if room is None:
                    room = Room("quick", self.maps[map_id])
                    self.rooms[room.id] = room

            if doc["id"] in room.players:
                # rejoining same room: replace the stale socket
                me = room.players[doc["id"]]
                me.ws = ws
                me.connected = True
            else:
                me = RoomPlayer(doc, hero, weapon, ws)
                room.players[me.id] = me
                room.order.append(me.id)

            await ws.send_json({
                "type": "joined",
                "room_id": room.id,
                "code": room.code,
                "you": me.id,
                "map": room.map,
                "host": room.host_id,
            })
            await room.broadcast(room.lobby_msg())
            self.schedule_auto_start(room)
            if room.mode == "quick" and len(room.order) >= MAX_PLAYERS:
                await self.start_room(room)

            # -- message loop --
            while True:
                msg = await ws.receive_json()
                mtype = msg.get("type")
                if mtype == "input" and room.state == "playing" and me.connected:
                    move = msg.get("move") or {}
                    try:
                        me.move_x = max(-1.0, min(1.0, float(move.get("x", 0))))
                        me.move_y = max(-1.0, min(1.0, float(move.get("y", 0))))
                    except (TypeError, ValueError):
                        me.move_x = me.move_y = 0.0
                    fire = msg.get("fire")
                    if isinstance(fire, dict) and "x" in fire and "y" in fire:
                        me.pending_fire = fire
                    if msg.get("ability"):
                        me.pending_ability = True
                elif mtype == "start" and room.state == "waiting":
                    if me.id == room.host_id:
                        await self.start_room(room)
                elif mtype == "leave":
                    break
                elif mtype == "ping":
                    await ws.send_json({"type": "pong"})
        except WebSocketDisconnect:
            pass
        except Exception:
            logger.exception("ws handler error")
        finally:
            if room is not None and me is not None:
                await self._drop_player(room, me)
            try:
                await ws.close()
            except Exception:
                pass

    async def _drop_player(self, room: Room, me: RoomPlayer):
        me.connected = False
        if room.state == "waiting":
            room.players.pop(me.id, None)
            if me.id in room.order:
                room.order.remove(me.id)
            if not room.order:
                self.rooms.pop(room.id, None)
            else:
                await room.broadcast(room.lobby_msg())
        elif room.state == "playing":
            me.alive = False
            room.feed.append(f"{me.name} LEFT THE BATTLE")
            # run_room notices when nobody is connected and cleans up


def attach(app: FastAPI, db, heroes, weapons, maps, xp_for_next) -> BattleServer:
    server = BattleServer(db, heroes, weapons, maps, xp_for_next)

    @app.websocket("/api/ws/battle")
    async def battle_socket(ws: WebSocket):
        await server.handle_socket(ws)

    @app.get("/api/multiplayer/status")
    async def multiplayer_status():
        return server.status()

    return server
