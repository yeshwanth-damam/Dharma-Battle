"""Shared, static game configuration used by both the REST API (server.py)
and the real-time multiplayer room simulation (game_rooms.py).

Kept dependency-free (no FastAPI / Mongo imports) so it can be imported from
anywhere, including tests, without pulling in the rest of the stack.
"""

HEROES = [
    {"id": "arjuna", "name": "Arjuna", "title": "The Peerless Archer", "hp": 100, "atk": 22, "spd": 6, "skill": "Rapid Fire Astra", "price": 0, "color": "#4FC3F7", "letter": "अ"},
    {"id": "bhima", "name": "Bhima", "title": "The Mighty Mace", "hp": 160, "atk": 30, "spd": 4, "skill": "Ground Slam", "price": 500, "color": "#FF7043", "letter": "भ"},
    {"id": "hanuman", "name": "Hanuman", "title": "Son of Wind", "hp": 130, "atk": 26, "spd": 8, "skill": "Divine Leap", "price": 800, "color": "#FFD54F", "letter": "ह"},
    {"id": "karna", "name": "Karna", "title": "The Radiant", "hp": 120, "atk": 28, "spd": 6, "skill": "Sun Blast", "price": 1200, "color": "#EF5350", "letter": "क"},
]

WEAPONS = [
    {"id": "brahmastra", "name": "Brahmastra", "desc": "Divine cosmic missile", "damage": 20, "cooldown": 0.35, "price": 0, "color": "#FFD700"},
    {"id": "vajra", "name": "Vajra", "desc": "Thunderbolt of Indra", "damage": 35, "cooldown": 0.6, "price": 400, "color": "#4FC3F7"},
    {"id": "gada", "name": "Gada", "desc": "Bhima's crushing mace", "damage": 55, "cooldown": 1.1, "price": 700, "color": "#FF7043"},
    {"id": "sudarshan", "name": "Sudarshan Chakra", "desc": "Krishna's discus, pierces all", "damage": 45, "cooldown": 0.5, "price": 1500, "color": "#FF5722"},
]

MAPS = [
    {"id": "kurukshetra", "name": "Kurukshetra", "desc": "The great battlefield of the Mahabharata", "difficulty": 1, "waves": 5, "bg": "#2B1810"},
    {"id": "lanka", "name": "Lanka", "desc": "The golden fortress of Ravana", "difficulty": 2, "waves": 7, "bg": "#3E1A0C"},
    {"id": "dwaraka", "name": "Dwaraka", "desc": "Krishna's city on the ocean", "difficulty": 3, "waves": 10, "bg": "#0D2540"},
]

# Server-side price catalog (SSOT). Prices in USD.
STRIPE_CATALOG = {
    "pack_small": {"amount": 1.99, "coins": 500, "label": "Handful of Coins", "kind": "coins"},
    "pack_medium": {"amount": 4.99, "coins": 1500, "label": "Pouch of Gold", "kind": "coins"},
    "pack_large": {"amount": 14.99, "coins": 5000, "label": "Chest of Wealth", "kind": "coins"},
    "premium_warrior": {"amount": 9.99, "coins": 0, "label": "Premium Warrior Pack", "kind": "bundle"},
}

# Legacy in-game (soft-currency) coin packs shown alongside real IAP
COIN_PACKS = {k: {"coins": v["coins"], "label": v["label"], "usd": v["amount"]} for k, v in STRIPE_CATALOG.items() if v["kind"] == "coins"}

HEROES_BY_ID = {h["id"]: h for h in HEROES}
WEAPONS_BY_ID = {w["id"]: w for w in WEAPONS}
MAPS_BY_ID = {m["id"]: m for m in MAPS}


def xp_for_next(level: int) -> int:
    return 100 + (level - 1) * 75
