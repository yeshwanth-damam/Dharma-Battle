# Dharma Battle — Product Requirements Document

## Product
**Dharma Battle** — a 2D top-down single-player arena shooter mobile game inspired by Indian mythology, built with Expo React Native + FastAPI + MongoDB. PUBG-like arcade action, no online multiplayer.

## Target Users
Casual mobile gamers, Indian mythology enthusiasts, arcade shooter fans. Play Store + App Store distribution.

## Core Gameplay Loop
1. Enter warrior name → 2. Pick hero + astra + map in lobby → 3. Battle waves of AI enemies → 4. Earn coins + XP → 5. Unlock new heroes/astras → 6. Climb leaderboard.

## Features Implemented (MVP)
- **Splash / Home**: cinematic branding, tap-to-begin, quick nav to ranks/shop/profile.
- **Onboarding**: warrior name entry, creates backend player record with 250 starter coins.
- **Lobby**: player card (level, XP bar, coins), loadout slots (hero / astra / map), play button, quick nav.
- **Hero Selection**: 4 mythology heroes — Arjuna, Bhima, Hanuman, Karna. Stats (HP, ATK, SPD). Unlock via coins.
- **Weapon (Astra) Selection**: 4 divine astras — Brahmastra, Vajra, Gada, Sudarshan Chakra. Damage/cooldown stats. Unlock via coins.
- **Map Selection**: 3 mythological maps — Kurukshetra, Lanka, Dwaraka. Difficulty & wave counts.
- **Battle (2D arena)**: virtual joystick movement, auto-fire at nearest enemy, wave-based bot spawns (grunt/swift/brute), HP system, particles, pause/quit.
- **Results**: victory/defeat screen with kills, survival time, score, coin+XP rewards.
- **Shop**: 3 tabs — Coins (mock IAP packs 500/1500/5000), Heroes (unlock with coins), Astras (unlock with coins).
- **Leaderboard**: podium top-3 + full ranking by best score.
- **Profile**: hero portrait, level/XP, kills, wins, winrate, best score, logout.

## Backend API (`/api/*`)
- `GET /game/config` — heroes/weapons/maps/coin_packs
- `POST /player` — create player
- `GET /player/{id}` — fetch player
- `POST /player/select` — equip hero/weapon
- `POST /match/complete` — submit match result, awards coins/XP, updates level & best score
- `POST /shop/purchase` — buy hero/weapon/coin pack
- `GET /leaderboard` — top players by best score

## Monetization Path
- **Now (MVP)**: mock IAP coin packs functional; heroes/weapons buyable with coins.
- **Next**: wire real Stripe checkout to coin pack "CLAIM" buttons. Ad rewarded video for bonus coins. Premium hero/skin bundles.

## Technical Notes
- Storage: `@/src/utils/storage` (AsyncStorage under the hood) for player id persistence.
- No authentication — player id = anonymous device-local identity.
- Battle loop runs at 60fps via `requestAnimationFrame` with mutable refs (no per-frame re-renders except for HUD).
- MongoDB collection: `players`. All responses exclude `_id`.

## Publish
Play Store + App Store via Emergent Publish button (top-right).
