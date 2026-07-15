from fastapi import FastAPI, APIRouter, HTTPException, Request, Header
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List, Optional
import uuid
from datetime import datetime, timezone, timedelta
import httpx

from emergentintegrations.payments.stripe.checkout import (
    StripeCheckout,
    CheckoutSessionRequest,
)

import multiplayer

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

mongo_url = os.environ["MONGO_URL"]
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ["DB_NAME"]]

STRIPE_API_KEY = os.environ["STRIPE_API_KEY"]
EMERGENT_AUTH_URL = os.environ["EMERGENT_AUTH_URL"]
GAME_URL = os.environ.get("GAME_URL", "")

app = FastAPI(title="Dharma Battle API")
api_router = APIRouter(prefix="/api")


# ---------- Game Config ----------
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
    premium_warrior: bool = False
    email: Optional[str] = None
    google_linked: bool = False
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
    item_type: str  # "hero" | "weapon"
    item_id: str


class SelectRequest(BaseModel):
    player_id: str
    hero_id: Optional[str] = None
    weapon_id: Optional[str] = None


class CheckoutRequest(BaseModel):
    player_id: str
    pack_id: str
    origin_url: str


class GoogleLinkRequest(BaseModel):
    player_id: str  # existing anon player id
    session_token: str  # from Emergent auth


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
    return {"message": "Dharma Battle API is live", "version": "2.0"}


@api_router.get("/game/config")
async def game_config():
    return {"heroes": HEROES, "weapons": WEAPONS, "maps": MAPS, "coin_packs": COIN_PACKS, "premium_pack": STRIPE_CATALOG["premium_warrior"]}


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
    """In-game soft-currency purchase (heroes/weapons via coins)."""
    doc = await _fetch(req.player_id)
    coins = doc.get("coins", 0)

    if req.item_type == "hero":
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
        raise HTTPException(400, "Bad item_type (use /stripe/checkout for coin packs)")

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


# ---------- Stripe ----------
def _stripe(webhook_url: Optional[str] = None) -> StripeCheckout:
    return StripeCheckout(api_key=STRIPE_API_KEY, webhook_url=webhook_url)


@api_router.post("/stripe/checkout")
async def stripe_create_checkout(req: CheckoutRequest):
    if req.pack_id not in STRIPE_CATALOG:
        raise HTTPException(400, "Unknown pack_id")
    await _fetch(req.player_id)  # ensure player exists

    pack = STRIPE_CATALOG[req.pack_id]

    # Build success/cancel URLs based on caller's origin
    origin = req.origin_url.rstrip("/")
    success_url = f"{origin}/payment-return?session_id={{CHECKOUT_SESSION_ID}}"
    cancel_url = f"{origin}/payment-return?cancelled=1"

    session_req = CheckoutSessionRequest(
        amount=pack["amount"],
        currency="usd",
        success_url=success_url,
        cancel_url=cancel_url,
        metadata={
            "player_id": req.player_id,
            "pack_id": req.pack_id,
            "kind": pack["kind"],
        },
    )
    stripe = _stripe()
    resp = await stripe.create_checkout_session(session_req)

    await db.payments.insert_one({
        "session_id": resp.session_id,
        "player_id": req.player_id,
        "pack_id": req.pack_id,
        "amount": pack["amount"],
        "kind": pack["kind"],
        "payment_status": "unpaid",
        "coins_granted": False,
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    return {"session_id": resp.session_id, "url": resp.url}


async def _grant_payment(session_id: str) -> dict:
    """Idempotently grant the reward for a paid session. Returns updated payment doc."""
    pay = await db.payments.find_one({"session_id": session_id}, {"_id": 0})
    if not pay:
        raise HTTPException(404, "Unknown session")
    if pay.get("coins_granted"):
        return pay
    pack = STRIPE_CATALOG.get(pay["pack_id"])
    if not pack:
        return pay

    if pack["kind"] == "coins":
        await db.players.update_one(
            {"id": pay["player_id"]},
            {"$inc": {"coins": pack["coins"]}},
        )
    elif pack["kind"] == "bundle":
        hero_ids = [h["id"] for h in HEROES]
        weapon_ids = [w["id"] for w in WEAPONS]
        await db.players.update_one(
            {"id": pay["player_id"]},
            {
                "$set": {"premium_warrior": True, "owned_heroes": hero_ids, "owned_weapons": weapon_ids},
            },
        )

    await db.payments.update_one(
        {"session_id": session_id},
        {"$set": {"coins_granted": True, "payment_status": "paid", "paid_at": datetime.now(timezone.utc).isoformat()}},
    )
    pay["coins_granted"] = True
    pay["payment_status"] = "paid"
    return pay


@api_router.get("/stripe/status/{session_id}")
async def stripe_status(session_id: str):
    stripe = _stripe()
    status = await stripe.get_checkout_status(session_id)
    if status.payment_status == "paid":
        await _grant_payment(session_id)
    pay = await db.payments.find_one({"session_id": session_id}, {"_id": 0}) or {}
    return {
        "session_id": session_id,
        "status": status.status,
        "payment_status": status.payment_status,
        "coins_granted": pay.get("coins_granted", False),
        "pack_id": pay.get("pack_id"),
    }


@api_router.post("/stripe/webhook")
async def stripe_webhook(request: Request, stripe_signature: Optional[str] = Header(None)):
    body = await request.body()
    stripe = _stripe()
    try:
        event = await stripe.handle_webhook(body, stripe_signature or "")
    except Exception as e:
        raise HTTPException(400, f"Webhook error: {e}")
    if event.event_type in ("checkout.session.completed", "checkout.session.async_payment_succeeded"):
        # session_id is on event.session_id in the emergentintegrations wrapper
        sid = getattr(event, "session_id", None) or (event.metadata or {}).get("session_id")
        if sid:
            try:
                await _grant_payment(sid)
            except HTTPException:
                pass
    return {"ok": True}


# ---------- Emergent Google Auth ----------
@api_router.post("/auth/google/link")
async def google_link(req: GoogleLinkRequest):
    """After Emergent Google auth completes, exchange session_token for user data
    and merge into an existing anon player (or switch to a Google-linked player)."""
    anon = await _fetch(req.player_id)

    async with httpx.AsyncClient(timeout=15.0) as h:
        r = await h.get(
            f"{EMERGENT_AUTH_URL}/auth/v1/env/oauth/session-data",
            headers={"X-Session-ID": req.session_token},
        )
    if r.status_code != 200:
        raise HTTPException(401, "Emergent session invalid")
    data = r.json()
    email = data.get("email")
    name = data.get("name") or anon.get("name")
    session_token = data.get("session_token")
    if not email or not session_token:
        raise HTTPException(401, "Missing email/token from Emergent")

    # Is there an existing google-linked player with this email?
    existing = await db.players.find_one({"email": email, "google_linked": True}, {"_id": 0})

    if existing:
        # Switch to existing account; leave anon record intact.
        active_id = existing["id"]
        active_doc = existing
    else:
        # Attach email/name to anon player.
        await db.players.update_one(
            {"id": req.player_id},
            {"$set": {"email": email, "name": name, "google_linked": True}},
        )
        active_doc = await db.players.find_one({"id": req.player_id}, {"_id": 0})
        active_id = req.player_id

    # Store session
    expires_at = datetime.now(timezone.utc) + timedelta(days=7)
    await db.user_sessions.update_one(
        {"session_token": session_token},
        {
            "$set": {
                "session_token": session_token,
                "player_id": active_id,
                "email": email,
                "expires_at": expires_at.isoformat(),
                "created_at": datetime.now(timezone.utc).isoformat(),
            }
        },
        upsert=True,
    )

    return {"player": Player(**active_doc).model_dump(), "session_token": session_token, "email": email}


@api_router.get("/auth/me")
async def auth_me(authorization: Optional[str] = Header(None)):
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(401, "Missing bearer token")
    token = authorization.split(" ", 1)[1]
    sess = await db.user_sessions.find_one({"session_token": token}, {"_id": 0})
    if not sess:
        raise HTTPException(401, "Session not found")
    try:
        exp = datetime.fromisoformat(sess["expires_at"])
        if exp.tzinfo is None:
            exp = exp.replace(tzinfo=timezone.utc)
        if exp < datetime.now(timezone.utc):
            raise HTTPException(401, "Session expired")
    except (KeyError, ValueError):
        pass
    player = await db.players.find_one({"id": sess["player_id"]}, {"_id": 0})
    if not player:
        raise HTTPException(401, "Player not found")
    return Player(**player)


@api_router.post("/auth/logout")
async def auth_logout(authorization: Optional[str] = Header(None)):
    if authorization and authorization.lower().startswith("bearer "):
        token = authorization.split(" ", 1)[1]
        await db.user_sessions.delete_one({"session_token": token})
    return {"ok": True}


app.include_router(api_router)

# Real-time squad co-op battle server (WebSocket at /api/ws/battle)
battle_server = multiplayer.attach(app, db, HEROES, WEAPONS, MAPS, xp_for_next)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
logger = logging.getLogger(__name__)


@app.on_event("startup")
async def _init_indexes():
    try:
        await db.players.create_index("id", unique=True)
        await db.players.create_index("email", sparse=True)
        await db.payments.create_index("session_id", unique=True)
        await db.user_sessions.create_index("session_token", unique=True)
    except Exception as e:  # noqa
        logger.warning("index setup: %s", e)


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
