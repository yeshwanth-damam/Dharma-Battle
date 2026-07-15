"""Match-reward computation shared by the solo `/api/match/complete` endpoint
and the co-op multiplayer room lifecycle (see multiplayer.py).

Depends only on Mongo (via a passed-in `db`) and game_data — no Stripe /
emergentintegrations import, so it stays importable (and testable) even
where those optional integrations aren't installed.
"""
from fastapi import HTTPException

from game_data import xp_for_next


async def fetch_player(db, player_id: str) -> dict:
    doc = await db.players.find_one({"id": player_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Player not found")
    return doc


def compute_match_reward(kills: int, survived_seconds: int, victory: bool) -> dict:
    coin_reward = kills * 10 + (50 if victory else 10)
    xp_reward = kills * 15 + (100 if victory else 25)
    score = kills * 100 + survived_seconds * 2 + (500 if victory else 0)
    return {"coin_reward": coin_reward, "xp_reward": xp_reward, "score": score}


async def apply_match_result(db, player_id: str, kills: int, survived_seconds: int, victory: bool) -> dict:
    """Idempotent-per-call reward application: fetches the player, computes
    reward, persists updates, and returns the merged player document."""
    doc = await fetch_player(db, player_id)
    reward = compute_match_reward(kills, survived_seconds, victory)

    new_xp = doc.get("xp", 0) + reward["xp_reward"]
    new_level = doc.get("level", 1)
    while new_xp >= xp_for_next(new_level):
        new_xp -= xp_for_next(new_level)
        new_level += 1

    updates = {
        "coins": doc.get("coins", 0) + reward["coin_reward"],
        "xp": new_xp,
        "level": new_level,
        "kills": doc.get("kills", 0) + kills,
        "matches": doc.get("matches", 0) + 1,
        "wins": doc.get("wins", 0) + (1 if victory else 0),
        "best_score": max(doc.get("best_score", 0), reward["score"]),
    }
    await db.players.update_one({"id": player_id}, {"$set": updates})
    doc.update(updates)
    return doc
