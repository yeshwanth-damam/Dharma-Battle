from fastapi import FastAPI, APIRouter, HTTPException
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List, Optional
import uuid
from datetime import datetime, timezone


ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

app = FastAPI(title="Dharma Battle API")
api_router = APIRouter(prefix="/api")


# ---------- Game Config (static) ----------
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


# ---------- Models ----------
class Player(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str
    level: int = 1
    xp: int = 0
    coins: int = 250
    kills: int = 0
    matches: int = 0
    wins: int = 0
    best_score: int = 0
    owned_heroes: List[str] = Field(default_factory=lambda: ["arjuna"])
    owned_weapons: List[str] = Field(default_factory=lambda: ["brahmastra"])
    selected_hero: str = "arjuna"
    selected_weapon: str = "brahmastra"
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


class PlayerCreate(BaseModel):
    name: str


class MatchResult(BaseModel):
    player_id: str
    map_id: str
    kills: int
    survived_seconds: int
    victory: bool


class PurchaseRequest(BaseModel):
    player_id: str
    item_type: str  # "hero" | "weapon" | "coins"
    item_id: str


class SelectRequest(BaseModel):
    player_id: str
    hero_id: Optional[str] = None
    weapon_id: Optional[str] = None


COIN_PACKS = {
    "pack_small": {"coins": 500, "label": "Handful of Coins"},
    "pack_medium": {"coins": 1500, "label": "Pouch of Gold"},
    "pack_large": {"coins": 5000, "label": "Chest of Wealth"},
}


# ---------- Helpers ----------
def xp_for_next(level: int) -> int:
    return 100 + (level - 1) * 75


async def _fetch(player_id: str) -> dict:
    doc = await db.players.find_one({"id": player_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Player not found")
    return doc


# ---------- Routes ----------
@api_router.get("/")
async def root():
    return {"message": "Dharma Battle API is live", "version": "1.0"}


@api_router.get("/game/config")
async def game_config():
    return {"heroes": HEROES, "weapons": WEAPONS, "maps": MAPS, "coin_packs": COIN_PACKS}


@api_router.post("/player", response_model=Player)
async def create_player(payload: PlayerCreate):
    name = payload.name.strip()[:20] or "Warrior"
    player = Player(name=name)
    await db.players.insert_one(player.model_dump())
    return player


@api_router.get("/player/{player_id}", response_model=Player)
async def get_player(player_id: str):
    doc = await _fetch(player_id)
    return Player(**doc)


@api_router.post("/player/select", response_model=Player)
async def select_gear(payload: SelectRequest):
    doc = await _fetch(payload.player_id)
    updates = {}
    if payload.hero_id and payload.hero_id in doc.get("owned_heroes", []):
        updates["selected_hero"] = payload.hero_id
    if payload.weapon_id and payload.weapon_id in doc.get("owned_weapons", []):
        updates["selected_weapon"] = payload.weapon_id
    if updates:
        await db.players.update_one({"id": payload.player_id}, {"$set": updates})
        doc.update(updates)
    return Player(**doc)


@api_router.post("/match/complete", response_model=Player)
async def complete_match(res: MatchResult):
    doc = await _fetch(res.player_id)
    # Compute rewards
    coin_reward = res.kills * 10 + (50 if res.victory else 10)
    xp_reward = res.kills * 15 + (100 if res.victory else 25)
    score = res.kills * 100 + res.survived_seconds * 2 + (500 if res.victory else 0)

    new_xp = doc.get("xp", 0) + xp_reward
    new_level = doc.get("level", 1)
    while new_xp >= xp_for_next(new_level):
        new_xp -= xp_for_next(new_level)
        new_level += 1

    updates = {
        "coins": doc.get("coins", 0) + coin_reward,
        "xp": new_xp,
        "level": new_level,
        "kills": doc.get("kills", 0) + res.kills,
        "matches": doc.get("matches", 0) + 1,
        "wins": doc.get("wins", 0) + (1 if res.victory else 0),
        "best_score": max(doc.get("best_score", 0), score),
    }
    await db.players.update_one({"id": res.player_id}, {"$set": updates})
    doc.update(updates)
    return Player(**doc)


@api_router.post("/shop/purchase", response_model=Player)
async def purchase(req: PurchaseRequest):
    doc = await _fetch(req.player_id)
    coins = doc.get("coins", 0)

    if req.item_type == "coins":
        pack = COIN_PACKS.get(req.item_id)
        if not pack:
            raise HTTPException(400, "Unknown coin pack")
        # Mock IAP: grant coins
        updates = {"coins": coins + pack["coins"]}
    elif req.item_type == "hero":
        hero = next((h for h in HEROES if h["id"] == req.item_id), None)
        if not hero:
            raise HTTPException(400, "Unknown hero")
        if req.item_id in doc.get("owned_heroes", []):
            raise HTTPException(400, "Already owned")
        if coins < hero["price"]:
            raise HTTPException(400, "Not enough coins")
        updates = {
            "coins": coins - hero["price"],
            "owned_heroes": doc.get("owned_heroes", []) + [req.item_id],
        }
    elif req.item_type == "weapon":
        wpn = next((w for w in WEAPONS if w["id"] == req.item_id), None)
        if not wpn:
            raise HTTPException(400, "Unknown weapon")
        if req.item_id in doc.get("owned_weapons", []):
            raise HTTPException(400, "Already owned")
        if coins < wpn["price"]:
            raise HTTPException(400, "Not enough coins")
        updates = {
            "coins": coins - wpn["price"],
            "owned_weapons": doc.get("owned_weapons", []) + [req.item_id],
        }
    else:
        raise HTTPException(400, "Bad item_type")

    await db.players.update_one({"id": req.player_id}, {"$set": updates})
    doc.update(updates)
    return Player(**doc)


@api_router.get("/leaderboard")
async def leaderboard(limit: int = 20):
    cursor = db.players.find({}, {"_id": 0}).sort("best_score", -1).limit(limit)
    docs = await cursor.to_list(limit)
    return [
        {
            "id": d["id"],
            "name": d["name"],
            "level": d.get("level", 1),
            "kills": d.get("kills", 0),
            "wins": d.get("wins", 0),
            "best_score": d.get("best_score", 0),
        }
        for d in docs
    ]


app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
