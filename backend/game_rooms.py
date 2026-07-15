"""Authoritative, real-time co-op room simulation.

This module is intentionally framework-free (no FastAPI / Mongo / asyncio
network code) so the core game-loop logic can be unit tested deterministically
and reused independently of the transport layer. `multiplayer.py` wires this
up to WebSockets + REST + persistence.

The simulation mirrors the single-player wave-shooter in
`frontend/app/battle.tsx`, generalized to N players sharing one set of waves:
- Players move via a joystick vector, auto-fire at the nearest enemy (or a
  tap-to-fire target), and can trigger their hero's unique ability.
- Enemies spawn from the arena edges in waves and chase the nearest living,
  connected player.
- Positions are tracked in a fixed logical arena (`ARENA_W` x `ARENA_H`);
  clients scale this to their own screen size when rendering.
"""
import math
import random
import string
import time
from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple

from game_data import HEROES, WEAPONS, MAPS, HEROES_BY_ID, WEAPONS_BY_ID, MAPS_BY_ID

# ---------- Tunables ----------
ARENA_W = 390.0
ARENA_H = 640.0
MAX_PLAYERS = 4
MAX_ENEMIES_ON_SCREEN = 14
ABILITY_COOLDOWN = 12.0
BULLET_SPEED = 520.0
BULLET_LIFE = 1.4
AUTO_FIRE_RANGE = 380.0
PICKUP_RADIUS = 28.0
ENEMY_TOUCH_RADIUS = 20.0
TICK_DT = 0.05  # 20Hz authoritative tick
COUNTDOWN_SECONDS = 3.0
ROOM_CODE_CHARS = string.ascii_uppercase + string.digits
ROOM_CODE_LEN = 5

ENEMY_BASE = {
    "grunt": {"hp": 30, "speed": 55, "damage": 8, "radius": 16, "color": "#8E24AA"},
    "swift": {"hp": 22, "speed": 90, "damage": 6, "radius": 13, "color": "#26C6DA"},
    "brute": {"hp": 80, "speed": 40, "damage": 18, "radius": 22, "color": "#D84315"},
}


def _dist(ax: float, ay: float, bx: float, by: float) -> float:
    return math.hypot(ax - bx, ay - by)


def _norm(x: float, y: float) -> Tuple[float, float]:
    length = math.hypot(x, y) or 1.0
    return x / length, y / length


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
    kind: str

    def to_dict(self) -> dict:
        return {
            "id": self.id, "x": round(self.x, 1), "y": round(self.y, 1),
            "hp": round(max(0.0, self.hp), 1), "max_hp": self.max_hp,
            "radius": self.radius, "color": self.color, "kind": self.kind,
        }


@dataclass
class Bullet:
    id: int
    x: float
    y: float
    vx: float
    vy: float
    life: float
    damage: float
    color: str
    owner_id: str

    def to_dict(self) -> dict:
        return {"id": self.id, "x": round(self.x, 1), "y": round(self.y, 1), "color": self.color}


@dataclass
class Drop:
    id: int
    x: float
    y: float
    kind: str  # "hp" | "coin"

    def to_dict(self) -> dict:
        return {"id": self.id, "x": round(self.x, 1), "y": round(self.y, 1), "kind": self.kind}


@dataclass
class RoomPlayer:
    id: str
    name: str
    hero_id: str
    weapon_id: str
    x: float = 0.0
    y: float = 0.0
    hp: float = 100.0
    max_hp: float = 100.0
    alive: bool = True
    connected: bool = True
    kills: int = 0
    bonus_coins: int = 0
    fire_cd: float = 0.0
    ability_cd: float = 0.0
    invuln: float = 0.0
    joystick: Tuple[float, float] = (0.0, 0.0)
    pending_fire: Optional[Tuple[float, float]] = None
    pending_ability: bool = False

    def hero(self) -> dict:
        return HEROES_BY_ID.get(self.hero_id, HEROES[0])

    def weapon(self) -> dict:
        return WEAPONS_BY_ID.get(self.weapon_id, WEAPONS[0])

    def to_dict(self) -> dict:
        return {
            "id": self.id, "name": self.name, "hero_id": self.hero_id, "weapon_id": self.weapon_id,
            "x": round(self.x, 1), "y": round(self.y, 1),
            "hp": round(max(0.0, self.hp), 1), "max_hp": self.max_hp,
            "alive": self.alive, "connected": self.connected, "kills": self.kills,
            "ability_ready": self.ability_cd <= 0, "ability_cd": round(max(0.0, self.ability_cd), 1),
            "invuln": self.invuln > 0,
        }


class Room:
    """One co-op match: lobby -> countdown -> playing -> finished."""

    def __init__(self, code: str, host_id: str, map_id: str, max_players: int = 4):
        self.code = code
        self.host_id = host_id
        self.map_id = map_id if map_id in MAPS_BY_ID else MAPS[0]["id"]
        self.max_players = max(1, min(MAX_PLAYERS, max_players))
        self.state = "waiting"  # waiting -> countdown -> playing -> finished
        self.players: Dict[str, RoomPlayer] = {}
        self.enemies: List[Enemy] = []
        self.bullets: List[Bullet] = []
        self.drops: List[Drop] = []
        self.events: List[dict] = []
        self.wave = 0
        self.enemies_left = 0
        self.enemy_spawn_timer = 0.0
        self.elapsed = 0.0
        self.countdown = 0.0
        self.victory: Optional[bool] = None
        self._uniq = 1
        self.created_at = time.time()
        self.finished_at: Optional[float] = None
        self.rewards_granted = False

    # ---------- membership ----------
    def map_obj(self) -> dict:
        return MAPS_BY_ID[self.map_id]

    def _spawn_point(self, idx: int, n: int) -> Tuple[float, float]:
        if n <= 1:
            return ARENA_W / 2, ARENA_H / 2
        angle = (idx / n) * math.pi * 2
        r = 46.0
        return ARENA_W / 2 + math.cos(angle) * r, ARENA_H / 2 + math.sin(angle) * r

    def add_player(self, player_id: str, name: str, hero_id: str, weapon_id: str) -> RoomPlayer:
        if player_id in self.players:
            self.players[player_id].connected = True
            return self.players[player_id]
        if len(self.players) >= self.max_players:
            raise ValueError("Room is full")
        if self.state != "waiting":
            raise ValueError("Match already in progress")
        hero = HEROES_BY_ID.get(hero_id, HEROES[0])
        wpn_id = weapon_id if weapon_id in WEAPONS_BY_ID else WEAPONS[0]["id"]
        x, y = self._spawn_point(len(self.players), self.max_players)
        rp = RoomPlayer(
            id=player_id, name=name[:20] or "Warrior", hero_id=hero["id"], weapon_id=wpn_id,
            x=x, y=y, hp=float(hero["hp"]), max_hp=float(hero["hp"]),
        )
        self.players[player_id] = rp
        return rp

    def remove_player(self, player_id: str) -> None:
        self.players.pop(player_id, None)
        if player_id == self.host_id and self.players:
            self.host_id = next(iter(self.players))

    def set_connected(self, player_id: str, connected: bool) -> None:
        p = self.players.get(player_id)
        if p:
            p.connected = connected

    def is_empty(self) -> bool:
        return len(self.players) == 0

    # ---------- lifecycle ----------
    def start(self, requester_id: str) -> None:
        if requester_id != self.host_id:
            raise ValueError("Only the host can start the match")
        if self.state != "waiting":
            raise ValueError("Match already started")
        if not self.players:
            raise ValueError("Need at least one player to start")
        self.state = "countdown"
        self.countdown = COUNTDOWN_SECONDS

    def _start_wave(self, w: int) -> None:
        self.wave = w
        n_players = max(1, len(self.players))
        self.enemies_left = 4 + w * 2 + (n_players - 1) * 3
        self.enemy_spawn_timer = 0.0
        self.events.append({"type": "wave", "wave": w})

    def _finish(self, victory: bool) -> None:
        self.state = "finished"
        self.victory = victory
        self.finished_at = time.time()
        self.events.append({"type": "match_end", "victory": victory})

    # ---------- input ----------
    def apply_input(
        self, player_id: str, joystick: Optional[dict] = None,
        fire: Optional[dict] = None, ability: bool = False,
    ) -> None:
        p = self.players.get(player_id)
        if not p or not p.alive:
            return
        if joystick is not None:
            jx = max(-1.0, min(1.0, float(joystick.get("x", 0))))
            jy = max(-1.0, min(1.0, float(joystick.get("y", 0))))
            p.joystick = (jx, jy)
        if fire is not None:
            p.pending_fire = (float(fire.get("x", p.x)), float(fire.get("y", p.y)))
        if ability:
            p.pending_ability = True

    # ---------- simulation internals ----------
    def _next_id(self) -> int:
        self._uniq += 1
        return self._uniq

    def _fire_bullet(self, owner: RoomPlayer, tx: float, ty: float) -> None:
        dx, dy = _norm(tx - owner.x, ty - owner.y)
        wpn = owner.weapon()
        self.bullets.append(Bullet(
            id=self._next_id(), x=owner.x, y=owner.y,
            vx=dx * BULLET_SPEED, vy=dy * BULLET_SPEED,
            life=BULLET_LIFE, damage=wpn["damage"], color=wpn["color"], owner_id=owner.id,
        ))

    def _damage_enemy(self, e: Enemy, dmg: float, owner: Optional[RoomPlayer]) -> None:
        if e.hp <= 0:
            return  # already dead this tick — avoid double-kill credit (e.g. ability + bullet same tick)
        e.hp -= dmg
        if e.hp <= 0 and owner is not None:
            owner.kills += 1
            roll = random.random()
            if roll < 0.18:
                self.drops.append(Drop(id=self._next_id(), x=e.x, y=e.y, kind="hp"))
            elif roll < 0.40:
                self.drops.append(Drop(id=self._next_id(), x=e.x, y=e.y, kind="coin"))
            self.events.append({"type": "kill", "player_id": owner.id, "enemy": e.kind})

    def _spawn_enemy(self) -> None:
        roll = random.random()
        kind = "grunt"
        if roll > 0.85:
            kind = "brute"
        elif roll > 0.6:
            kind = "swift"
        base = ENEMY_BASE[kind]
        wave_mult = 1 + (self.wave - 1) * 0.15
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
            id=self._next_id(), x=x, y=y,
            hp=base["hp"] * wave_mult, max_hp=base["hp"] * wave_mult,
            radius=base["radius"], speed=base["speed"] * wave_mult,
            damage=base["damage"] * wave_mult, color=base["color"], kind=kind,
        ))

    def trigger_ability(self, p: RoomPlayer) -> None:
        if p.ability_cd > 0:
            return
        p.ability_cd = ABILITY_COOLDOWN
        hero_id = p.hero_id
        if hero_id == "arjuna":
            for i in range(12):
                angle = (i / 12) * math.pi * 2
                self._fire_bullet(p, p.x + math.cos(angle) * 200, p.y + math.sin(angle) * 200)
            self.events.append({"type": "ability", "player_id": p.id, "text": "RAPID FIRE ASTRA!"})
        elif hero_id == "bhima":
            r = 180.0
            for e in self.enemies:
                if _dist(e.x, e.y, p.x, p.y) < r:
                    self._damage_enemy(e, 80, p)
            self.events.append({"type": "ability", "player_id": p.id, "text": "GROUND SLAM!"})
        elif hero_id == "hanuman":
            jx, jy = p.joystick
            if math.hypot(jx, jy) > 0.05:
                dx, dy = _norm(jx, jy)
            else:
                dx, dy = 0.0, -1.0
            p.x = max(30.0, min(ARENA_W - 30.0, p.x + dx * 220))
            p.y = max(30.0, min(ARENA_H - 30.0, p.y + dy * 220))
            p.invuln = 1.5
            self.events.append({"type": "ability", "player_id": p.id, "text": "DIVINE LEAP!"})
        elif hero_id == "karna":
            for e in self.enemies:
                self._damage_enemy(e, 60, p)
            self.events.append({"type": "ability", "player_id": p.id, "text": "SUN BLAST!"})

    def step(self, dt: float = TICK_DT) -> None:
        self.events = []

        if self.state == "countdown":
            self.countdown -= dt
            if self.countdown <= 0:
                self.state = "playing"
                self._start_wave(1)
            return

        if self.state != "playing":
            return

        self.elapsed += dt

        for p in self.players.values():
            p.ability_cd = max(0.0, p.ability_cd - dt)
            p.invuln = max(0.0, p.invuln - dt)
            p.fire_cd -= dt
            if not p.alive or not p.connected:
                p.pending_fire = None
                p.pending_ability = False
                continue

            hero = p.hero()
            spd = hero.get("spd", 6) * 26
            jx, jy = p.joystick
            p.x = max(20.0, min(ARENA_W - 20.0, p.x + jx * spd * dt))
            p.y = max(20.0, min(ARENA_H - 20.0, p.y + jy * spd * dt))

            if p.pending_ability:
                self.trigger_ability(p)
            p.pending_ability = False

            if p.pending_fire is not None and p.fire_cd <= 0:
                self._fire_bullet(p, *p.pending_fire)
                p.fire_cd = p.weapon()["cooldown"]
            elif p.fire_cd <= 0 and self.enemies:
                nearest, nd = None, math.inf
                for e in self.enemies:
                    d = _dist(e.x, e.y, p.x, p.y)
                    if d < nd:
                        nd, nearest = d, e
                if nearest is not None and nd < AUTO_FIRE_RANGE:
                    self._fire_bullet(p, nearest.x, nearest.y)
                    p.fire_cd = p.weapon()["cooldown"]
            p.pending_fire = None

        # bullets: move, cull, and resolve hits
        remaining_bullets: List[Bullet] = []
        for b in self.bullets:
            b.x += b.vx * dt
            b.y += b.vy * dt
            b.life -= dt
            if b.life <= 0 or b.x < -20 or b.x > ARENA_W + 20 or b.y < -20 or b.y > ARENA_H + 20:
                continue
            hit = False
            for e in self.enemies:
                if _dist(b.x, b.y, e.x, e.y) < e.radius + 4:
                    self._damage_enemy(e, b.damage, self.players.get(b.owner_id))
                    hit = True
                    break
            if not hit:
                remaining_bullets.append(b)
        self.bullets = remaining_bullets
        self.enemies = [e for e in self.enemies if e.hp > 0]

        # enemies chase & damage the nearest living, connected player
        alive_players = [p for p in self.players.values() if p.alive and p.connected]
        for e in self.enemies:
            if not alive_players:
                continue
            target = min(alive_players, key=lambda p: _dist(e.x, e.y, p.x, p.y))
            dx, dy = _norm(target.x - e.x, target.y - e.y)
            e.x += dx * e.speed * dt
            e.y += dy * e.speed * dt
            if _dist(e.x, e.y, target.x, target.y) < e.radius + ENEMY_TOUCH_RADIUS and target.invuln <= 0:
                target.hp -= e.damage * dt
                if target.hp <= 0:
                    target.hp = 0.0
                    if target.alive:
                        target.alive = False
                        self.events.append({"type": "down", "player_id": target.id})

        # drop pickups (first eligible player wins the pickup)
        remaining_drops: List[Drop] = []
        for d in self.drops:
            picked = False
            for p in self.players.values():
                if not p.alive or not p.connected:
                    continue
                if _dist(d.x, d.y, p.x, p.y) < PICKUP_RADIUS:
                    if d.kind == "hp":
                        p.hp = min(p.max_hp, p.hp + p.max_hp * 0.25)
                    else:
                        p.bonus_coins += 5
                    picked = True
                    break
            if not picked:
                remaining_drops.append(d)
        self.drops = remaining_drops

        # wave spawning
        self.enemy_spawn_timer -= dt
        if self.enemies_left > 0 and self.enemy_spawn_timer <= 0 and len(self.enemies) < MAX_ENEMIES_ON_SCREEN:
            self._spawn_enemy()
            self.enemies_left -= 1
            self.enemy_spawn_timer = max(0.4, 1.4 - self.wave * 0.08)

        # Match ends in defeat once no connected player is left standing.
        # Checked before the wave-clear below, since a wipe should end the
        # match even if the last enemy also died on this same tick.
        connected = [p for p in self.players.values() if p.connected]
        if self.players and not any(p.alive for p in connected):
            self._finish(victory=False)

        if self.state == "playing" and self.enemies_left <= 0 and not self.enemies:
            total_waves = self.map_obj()["waves"]
            if self.wave >= total_waves:
                self._finish(victory=True)
            else:
                self._start_wave(self.wave + 1)

    # ---------- serialization ----------
    def snapshot(self) -> dict:
        return {
            "type": "state",
            "code": self.code,
            "state": self.state,
            "map_id": self.map_id,
            "wave": self.wave,
            "total_waves": self.map_obj()["waves"],
            "elapsed": round(self.elapsed, 1),
            "countdown": max(0, math.ceil(self.countdown)) if self.state == "countdown" else 0,
            "victory": self.victory,
            "max_players": self.max_players,
            "players": [p.to_dict() for p in self.players.values()],
            "enemies": [e.to_dict() for e in self.enemies],
            "bullets": [b.to_dict() for b in self.bullets],
            "drops": [d.to_dict() for d in self.drops],
            "events": list(self.events),
            "host_id": self.host_id,
        }

    def lobby_summary(self) -> dict:
        return {
            "code": self.code,
            "state": self.state,
            "map_id": self.map_id,
            "host_id": self.host_id,
            "max_players": self.max_players,
            "players": [
                {"id": p.id, "name": p.name, "hero_id": p.hero_id, "connected": p.connected}
                for p in self.players.values()
            ],
        }

    def match_results(self) -> List[dict]:
        """Per-player result summary once finished; feeds reward persistence."""
        results = []
        for p in self.players.values():
            kills_for_reward = p.kills + (p.bonus_coins // 10)
            results.append({
                "player_id": p.id,
                "kills": kills_for_reward,
                "survived_seconds": int(self.elapsed),
                "victory": bool(self.victory),
            })
        return results


class RoomManager:
    def __init__(self):
        self.rooms: Dict[str, Room] = {}

    def _gen_code(self) -> str:
        while True:
            code = "".join(random.choice(ROOM_CODE_CHARS) for _ in range(ROOM_CODE_LEN))
            if code not in self.rooms:
                return code

    def create_room(self, host_id: str, map_id: str, max_players: int = 4) -> Room:
        code = self._gen_code()
        room = Room(code=code, host_id=host_id, map_id=map_id, max_players=max_players)
        self.rooms[code] = room
        return room

    def get(self, code: str) -> Optional[Room]:
        return self.rooms.get((code or "").upper())

    def remove(self, code: str) -> None:
        self.rooms.pop((code or "").upper(), None)

    def list_open(self) -> List[Room]:
        return [r for r in self.rooms.values() if r.state == "waiting"]

    def cleanup_empty(self) -> None:
        for code in [c for c, r in self.rooms.items() if r.is_empty()]:
            del self.rooms[code]
