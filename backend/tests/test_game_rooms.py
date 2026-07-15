"""Unit tests for the authoritative co-op room simulation (game_rooms.py).

These are pure-python tests with no network/Mongo dependency — they exercise
Room/RoomManager directly so the core game loop can be verified deterministically.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pytest  # noqa: E402

from game_rooms import Enemy, Room, RoomManager  # noqa: E402


def make_room(max_players=4, map_id="kurukshetra"):
    return Room(code="TEST1", host_id="host", map_id=map_id, max_players=max_players)


# ---------- Membership ----------
class TestMembership:
    def test_add_player_sets_stats_from_hero(self):
        room = make_room()
        p = room.add_player("p1", "Arjun", "arjuna", "brahmastra")
        assert p.hp == 100 and p.max_hp == 100
        assert p.hero_id == "arjuna" and p.weapon_id == "brahmastra"
        assert p.alive and p.connected

    def test_add_player_unknown_hero_falls_back(self):
        room = make_room()
        p = room.add_player("p1", "X", "not-a-hero", "not-a-weapon")
        assert p.hero_id in {"arjuna"}  # falls back to HEROES[0]
        assert p.weapon_id in {"brahmastra"}

    def test_room_full_raises(self):
        room = make_room(max_players=1)
        room.add_player("p1", "A", "arjuna", "brahmastra")
        with pytest.raises(ValueError):
            room.add_player("p2", "B", "bhima", "gada")

    def test_rejoin_same_player_is_idempotent(self):
        room = make_room()
        room.add_player("p1", "A", "arjuna", "brahmastra")
        room.set_connected("p1", False)
        p = room.add_player("p1", "A", "arjuna", "brahmastra")
        assert p.connected is True
        assert len(room.players) == 1

    def test_cannot_join_once_playing(self):
        room = make_room()
        room.add_player("p1", "A", "arjuna", "brahmastra")
        room.state = "playing"
        with pytest.raises(ValueError):
            room.add_player("p2", "B", "bhima", "gada")

    def test_remove_player_promotes_new_host(self):
        room = make_room()
        room.add_player("host", "A", "arjuna", "brahmastra")
        room.add_player("p2", "B", "bhima", "gada")
        room.remove_player("host")
        assert room.host_id == "p2"
        assert room.is_empty() is False

    def test_lobby_summary_shape(self):
        room = make_room()
        room.add_player("p1", "A", "arjuna", "brahmastra")
        summary = room.lobby_summary()
        assert summary["code"] == "TEST1"
        assert summary["state"] == "waiting"
        assert len(summary["players"]) == 1
        assert summary["players"][0]["id"] == "p1"


# ---------- Lifecycle ----------
class TestLifecycle:
    def test_only_host_can_start(self):
        room = make_room()
        room.add_player("host", "A", "arjuna", "brahmastra")
        room.add_player("p2", "B", "bhima", "gada")
        with pytest.raises(ValueError):
            room.start("p2")
        room.start("host")
        assert room.state == "countdown"
        assert room.countdown == pytest.approx(3.0)

    def test_cannot_start_without_players(self):
        room = make_room()
        with pytest.raises(ValueError):
            room.start("host")

    def test_cannot_start_twice(self):
        room = make_room()
        room.add_player("host", "A", "arjuna", "brahmastra")
        room.start("host")
        with pytest.raises(ValueError):
            room.start("host")

    def test_countdown_transitions_to_playing_and_starts_wave_1(self):
        room = make_room()
        room.add_player("host", "A", "arjuna", "brahmastra")
        room.start("host")
        for _ in range(80):  # 80 * 0.05s = 4s > 3s countdown
            room.step(0.05)
            if room.state == "playing":
                break
        assert room.state == "playing"
        assert room.wave == 1
        assert room.enemies_left > 0

    def test_waiting_room_does_not_simulate(self):
        room = make_room()
        room.add_player("host", "A", "arjuna", "brahmastra")
        room.step(0.05)
        assert room.state == "waiting"
        assert room.elapsed == 0


# ---------- Movement & input ----------
class TestMovementAndInput:
    def _playing_room(self):
        room = make_room(max_players=1)
        room.add_player("p1", "A", "arjuna", "brahmastra")
        room.state = "playing"
        room._start_wave(1)
        return room

    def test_joystick_moves_player(self):
        room = self._playing_room()
        p = room.players["p1"]
        start_x = p.x
        room.apply_input("p1", joystick={"x": 1, "y": 0})
        room.step(0.05)
        assert p.x > start_x

    def test_movement_clamped_to_arena_bounds(self):
        room = self._playing_room()
        p = room.players["p1"]
        room.apply_input("p1", joystick={"x": -1, "y": -1})
        for _ in range(500):
            room.step(0.05)
        assert p.x >= 20.0 and p.y >= 20.0

    def test_joystick_input_is_clamped_to_unit_range(self):
        room = self._playing_room()
        room.apply_input("p1", joystick={"x": 5, "y": -5})
        p = room.players["p1"]
        assert p.joystick == (1.0, -1.0)

    def test_dead_player_ignores_input(self):
        room = self._playing_room()
        p = room.players["p1"]
        p.alive = False
        start_x = p.x
        room.apply_input("p1", joystick={"x": 1, "y": 0})
        assert p.joystick == (0.0, 0.0)
        room.step(0.05)
        assert p.x == start_x


# ---------- Combat ----------
class TestCombat:
    def _playing_room(self):
        room = make_room(max_players=1)
        room.add_player("p1", "A", "arjuna", "brahmastra")
        room.state = "playing"
        room._start_wave(1)
        room.enemies_left = 0  # prevent extra auto-spawns from interfering
        return room

    def test_autofire_kills_enemy_in_range_same_tick(self):
        room = self._playing_room()
        p = room.players["p1"]
        # Place the enemy exactly where the bullet will be after one tick,
        # along the firing direction, so the hit registers this tick.
        travel = 520 * 0.05  # BULLET_SPEED * dt
        enemy = Enemy(id=9001, x=p.x + travel, y=p.y, hp=5, max_hp=5,
                      radius=16, speed=0, damage=0, color="#fff", kind="grunt")
        room.enemies = [enemy]
        room.step(0.05)
        assert p.kills == 1
        assert len(room.enemies) == 0

    def test_enemy_out_of_range_is_not_autotargeted(self):
        room = self._playing_room()
        p = room.players["p1"]
        enemy = Enemy(id=9002, x=p.x + 1000, y=p.y, hp=100, max_hp=100,
                      radius=16, speed=0, damage=0, color="#fff", kind="grunt")
        room.enemies = [enemy]
        room.step(0.05)
        assert len(room.bullets) == 0

    def test_enemy_damages_player_on_touch(self):
        room = self._playing_room()
        p = room.players["p1"]
        start_hp = p.hp
        enemy = Enemy(id=9003, x=p.x, y=p.y, hp=1000, max_hp=1000,
                      radius=16, speed=0, damage=50, color="#fff", kind="brute")
        room.enemies = [enemy]
        room.step(0.05)
        assert p.hp < start_hp

    def test_player_death_marks_not_alive_and_emits_event(self):
        room = self._playing_room()
        p = room.players["p1"]
        enemy = Enemy(id=9004, x=p.x, y=p.y, hp=1000, max_hp=1000,
                      radius=16, speed=0, damage=100000, color="#fff", kind="brute")
        room.enemies = [enemy]
        room.step(0.05)
        assert p.alive is False
        assert p.hp == 0
        assert any(e["type"] == "down" for e in room.events)

    def test_all_players_dead_finishes_room_in_defeat(self):
        room = self._playing_room()
        p = room.players["p1"]
        p.alive = False
        room.step(0.05)
        assert room.state == "finished"
        assert room.victory is False

    def test_wave_clear_advances_to_next_wave(self):
        room = self._playing_room()
        room.enemies = []
        room.enemies_left = 0
        room.wave = 1
        room.step(0.05)
        assert room.wave == 2

    def test_final_wave_clear_finishes_in_victory(self):
        room = self._playing_room()
        total_waves = room.map_obj()["waves"]
        room.enemies = []
        room.enemies_left = 0
        room.wave = total_waves
        room.step(0.05)
        assert room.state == "finished"
        assert room.victory is True

    def test_ability_does_not_double_count_kill_with_autofire_same_tick(self):
        room = self._playing_room()
        p = room.players["p1"]
        p.hero_id = "karna"  # Sun Blast: damages every enemy on screen
        enemy = Enemy(id=9005, x=p.x + 500, y=p.y + 500, hp=10, max_hp=10,
                      radius=16, speed=0, damage=0, color="#fff", kind="grunt")
        room.enemies = [enemy]
        room.apply_input("p1", ability=True)
        room.step(0.05)
        assert p.kills == 1

    def test_disconnected_player_is_skipped_by_enemies(self):
        room = self._playing_room()
        p = room.players["p1"]
        p.connected = False
        enemy = Enemy(id=9006, x=p.x + 5, y=p.y, hp=100, max_hp=100,
                      radius=16, speed=10, damage=50, color="#fff", kind="grunt")
        room.enemies = [enemy]
        ex, ey = enemy.x, enemy.y
        room.step(0.05)
        # No connected+alive target, so the enemy should not move or attack.
        assert enemy.x == ex and enemy.y == ey


# ---------- Drops ----------
class TestDrops:
    def test_hp_drop_heals_player(self):
        room = make_room(max_players=1)
        room.add_player("p1", "A", "arjuna", "brahmastra")
        room.state = "playing"
        room._start_wave(1)
        room.enemies_left = 0
        p = room.players["p1"]
        p.hp = 10
        from game_rooms import Drop
        room.drops = [Drop(id=1, x=p.x, y=p.y, kind="hp")]
        room.step(0.05)
        assert p.hp > 10
        assert len(room.drops) == 0

    def test_coin_drop_adds_bonus_coins(self):
        room = make_room(max_players=1)
        room.add_player("p1", "A", "arjuna", "brahmastra")
        room.state = "playing"
        room._start_wave(1)
        room.enemies_left = 0
        p = room.players["p1"]
        from game_rooms import Drop
        room.drops = [Drop(id=1, x=p.x, y=p.y, kind="coin")]
        room.step(0.05)
        assert p.bonus_coins == 5


# ---------- Snapshots / results ----------
class TestSerialization:
    def test_snapshot_contains_expected_keys(self):
        room = make_room(max_players=1)
        room.add_player("p1", "A", "arjuna", "brahmastra")
        snap = room.snapshot()
        for key in ("type", "code", "state", "players", "enemies", "bullets", "drops", "events", "host_id"):
            assert key in snap

    def test_match_results_reflect_kills_and_victory(self):
        room = make_room(max_players=1)
        room.add_player("p1", "A", "arjuna", "brahmastra")
        p = room.players["p1"]
        p.kills = 3
        p.bonus_coins = 20
        room.elapsed = 42.0
        room.victory = True
        results = room.match_results()
        assert results == [{"player_id": "p1", "kills": 5, "survived_seconds": 42, "victory": True}]


# ---------- RoomManager ----------
class TestRoomManager:
    def test_create_and_get_room(self):
        mgr = RoomManager()
        room = mgr.create_room(host_id="h1", map_id="kurukshetra", max_players=4)
        assert mgr.get(room.code) is room
        assert mgr.get(room.code.lower()) is room  # case-insensitive lookup

    def test_list_open_excludes_started_rooms(self):
        mgr = RoomManager()
        r1 = mgr.create_room(host_id="h1", map_id="kurukshetra")
        r1.add_player("h1", "A", "arjuna", "brahmastra")
        r2 = mgr.create_room(host_id="h2", map_id="lanka")
        r2.add_player("h2", "B", "bhima", "gada")
        r1.start("h1")
        open_codes = {r.code for r in mgr.list_open()}
        assert r1.code not in open_codes
        assert r2.code in open_codes

    def test_cleanup_empty_removes_rooms_with_no_players(self):
        mgr = RoomManager()
        room = mgr.create_room(host_id="h1", map_id="kurukshetra")
        mgr.cleanup_empty()
        assert mgr.get(room.code) is None

    def test_generated_codes_are_unique(self):
        mgr = RoomManager()
        codes = {mgr.create_room(host_id=f"h{i}", map_id="kurukshetra").code for i in range(50)}
        assert len(codes) == 50
