"""Backend API tests for Dharma Battle game (FastAPI + MongoDB)."""
import os
import uuid
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "http://localhost:8001").rstrip("/")
API = f"{BASE_URL}/api"


@pytest.fixture(scope="session")
def s():
    sess = requests.Session()
    sess.headers.update({"Content-Type": "application/json"})
    return sess


@pytest.fixture(scope="session")
def player(s):
    name = f"TEST_{uuid.uuid4().hex[:6]}"
    r = s.post(f"{API}/player", json={"name": name}, timeout=15)
    assert r.status_code == 200, r.text
    p = r.json()
    return p


def fund_player(s, player_id: str, target_coins: int):
    """Earn coins via match rewards (coin packs now require real Stripe checkout)."""
    while True:
        r = s.post(
            f"{API}/match/complete",
            json={"player_id": player_id, "map_id": "kurukshetra", "kills": 20, "survived_seconds": 10, "victory": True},
            timeout=10,
        )
        assert r.status_code == 200, r.text
        if r.json()["coins"] >= target_coins:
            return r.json()


# ---------- Health / Config ----------
class TestConfig:
    def test_root(self, s):
        r = s.get(f"{API}/", timeout=10)
        assert r.status_code == 200
        assert "Dharma Battle" in r.json().get("message", "")

    def test_game_config_structure(self, s):
        r = s.get(f"{API}/game/config", timeout=10)
        assert r.status_code == 200
        d = r.json()
        assert set(d.keys()) >= {"heroes", "weapons", "maps", "coin_packs"}
        assert len(d["heroes"]) == 4
        assert len(d["weapons"]) == 4
        assert len(d["maps"]) == 3
        assert "pack_small" in d["coin_packs"]
        # Free hero/weapon
        assert any(h["id"] == "arjuna" and h["price"] == 0 for h in d["heroes"])
        assert any(w["id"] == "brahmastra" and w["price"] == 0 for w in d["weapons"])


# ---------- Player CRUD ----------
class TestPlayer:
    def test_create_player_defaults(self, s):
        r = s.post(f"{API}/player", json={"name": "TEST_Warrior"}, timeout=10)
        assert r.status_code == 200
        p = r.json()
        assert p["name"] == "TEST_Warrior"
        assert p["level"] == 1
        assert p["xp"] == 0
        assert p["coins"] == 250
        assert p["owned_heroes"] == ["arjuna"]
        assert p["owned_weapons"] == ["brahmastra"]
        assert p["selected_hero"] == "arjuna"
        assert p["selected_weapon"] == "brahmastra"
        assert "_id" not in p  # ObjectId should be excluded

    def test_create_player_name_truncated_and_default(self, s):
        # Empty name -> default "Warrior"
        r = s.post(f"{API}/player", json={"name": "   "}, timeout=10)
        assert r.status_code == 200
        assert r.json()["name"] == "Warrior"
        # Overly long name -> truncated to 20
        long = "A" * 50
        r2 = s.post(f"{API}/player", json={"name": long}, timeout=10)
        assert r2.status_code == 200
        assert len(r2.json()["name"]) == 20

    def test_get_player(self, s, player):
        r = s.get(f"{API}/player/{player['id']}", timeout=10)
        assert r.status_code == 200
        assert r.json()["id"] == player["id"]

    def test_get_player_404(self, s):
        r = s.get(f"{API}/player/does-not-exist-{uuid.uuid4()}", timeout=10)
        assert r.status_code == 404


# ---------- Selection ----------
class TestSelect:
    def test_select_owned_weapon(self, s, player):
        # brahmastra is owned by default
        r = s.post(f"{API}/player/select", json={"player_id": player["id"], "weapon_id": "brahmastra"}, timeout=10)
        assert r.status_code == 200
        assert r.json()["selected_weapon"] == "brahmastra"

    def test_select_unowned_hero_ignored(self, s, player):
        # bhima not owned; selection should be ignored (still arjuna)
        r = s.post(f"{API}/player/select", json={"player_id": player["id"], "hero_id": "bhima"}, timeout=10)
        assert r.status_code == 200
        assert r.json()["selected_hero"] == "arjuna"


# ---------- Match Completion ----------
class TestMatch:
    def test_victory_awards(self, s):
        p = s.post(f"{API}/player", json={"name": "TEST_Match"}, timeout=10).json()
        before_coins = p["coins"]
        r = s.post(
            f"{API}/match/complete",
            json={"player_id": p["id"], "map_id": "kurukshetra", "kills": 5, "survived_seconds": 60, "victory": True},
            timeout=10,
        )
        assert r.status_code == 200
        after = r.json()
        # coin_reward = 5*10 + 50 = 100
        assert after["coins"] == before_coins + 100
        # xp = 5*15 + 100 = 175 (level-up possible: xp_for_next(1)=100)
        # after adjust: 175-100=75 xp at level 2
        assert after["level"] == 2
        assert after["xp"] == 75
        assert after["kills"] == 5
        assert after["matches"] == 1
        assert after["wins"] == 1
        # score = 5*100 + 60*2 + 500 = 1120
        assert after["best_score"] == 1120

    def test_defeat_awards(self, s):
        p = s.post(f"{API}/player", json={"name": "TEST_Defeat"}, timeout=10).json()
        r = s.post(
            f"{API}/match/complete",
            json={"player_id": p["id"], "map_id": "kurukshetra", "kills": 2, "survived_seconds": 30, "victory": False},
            timeout=10,
        )
        assert r.status_code == 200
        d = r.json()
        # coin_reward = 2*10 + 10 = 30
        assert d["coins"] == p["coins"] + 30
        assert d["wins"] == 0
        assert d["matches"] == 1


# ---------- Shop ----------
class TestShop:
    def test_coin_pack_requires_stripe(self, s):
        # Soft-currency coin pack purchase was replaced by real Stripe checkout
        p = s.post(f"{API}/player", json={"name": "TEST_ShopCoin"}, timeout=10).json()
        r = s.post(f"{API}/shop/purchase", json={"player_id": p["id"], "item_type": "coins", "item_id": "pack_small"}, timeout=10)
        assert r.status_code == 400
        assert "stripe" in r.text.lower()

    def test_buy_hero_insufficient_coins(self, s):
        p = s.post(f"{API}/player", json={"name": "TEST_Poor"}, timeout=10).json()
        # default 250 coins, bhima is 500
        r = s.post(f"{API}/shop/purchase", json={"player_id": p["id"], "item_type": "hero", "item_id": "bhima"}, timeout=10)
        assert r.status_code == 400
        assert "coins" in r.text.lower() or "enough" in r.text.lower()

    def test_buy_hero_and_double_purchase(self, s):
        p = s.post(f"{API}/player", json={"name": "TEST_HeroBuy"}, timeout=10).json()
        funded = fund_player(s, p["id"], 500)
        # Buy bhima (500)
        r = s.post(f"{API}/shop/purchase", json={"player_id": p["id"], "item_type": "hero", "item_id": "bhima"}, timeout=10)
        assert r.status_code == 200
        pd = r.json()
        assert "bhima" in pd["owned_heroes"]
        assert pd["coins"] == funded["coins"] - 500
        # Double purchase blocked
        r2 = s.post(f"{API}/shop/purchase", json={"player_id": p["id"], "item_type": "hero", "item_id": "bhima"}, timeout=10)
        assert r2.status_code == 400

    def test_buy_weapon(self, s):
        p = s.post(f"{API}/player", json={"name": "TEST_WpnBuy"}, timeout=10).json()
        fund_player(s, p["id"], 400)
        # vajra costs 400
        r = s.post(f"{API}/shop/purchase", json={"player_id": p["id"], "item_type": "weapon", "item_id": "vajra"}, timeout=10)
        assert r.status_code == 200
        assert "vajra" in r.json()["owned_weapons"]

    def test_select_after_purchase(self, s):
        # Full flow: buy hero, then select it
        p = s.post(f"{API}/player", json={"name": "TEST_SelectFlow"}, timeout=10).json()
        fund_player(s, p["id"], 500)
        s.post(f"{API}/shop/purchase", json={"player_id": p["id"], "item_type": "hero", "item_id": "bhima"}, timeout=10)
        r = s.post(f"{API}/player/select", json={"player_id": p["id"], "hero_id": "bhima"}, timeout=10)
        assert r.status_code == 200
        assert r.json()["selected_hero"] == "bhima"

    def test_bad_item_type(self, s, player):
        r = s.post(f"{API}/shop/purchase", json={"player_id": player["id"], "item_type": "banana", "item_id": "x"}, timeout=10)
        assert r.status_code == 400


# ---------- Leaderboard ----------
class TestLeaderboard:
    def test_leaderboard_sorted(self, s):
        # Create player and record a high score
        p = s.post(f"{API}/player", json={"name": "TEST_LB"}, timeout=10).json()
        s.post(
            f"{API}/match/complete",
            json={"player_id": p["id"], "map_id": "lanka", "kills": 10, "survived_seconds": 120, "victory": True},
            timeout=10,
        )
        r = s.get(f"{API}/leaderboard", timeout=10)
        assert r.status_code == 200
        rows = r.json()
        assert isinstance(rows, list) and len(rows) > 0
        # sorted desc by best_score
        scores = [row["best_score"] for row in rows]
        assert scores == sorted(scores, reverse=True)
        # no _id leaked
        for row in rows:
            assert "_id" not in row
            assert {"id", "name", "level", "kills", "wins", "best_score"} <= set(row.keys())
