# Dharma Battle — Unity Rewrite

Unity is the recommended engine for this project (2D top-down mobile wave shooter). Unreal is viable for a 3D reboot but adds unnecessary complexity for the current design.

**This folder cannot be opened or run inside the Emergent cloud sandbox** — there is no Unity Editor here. Clone the repo on a machine with [Unity Hub](https://unity.com/download) installed.

## Why Unity over Unreal (for Dharma Battle)

| | Unity | Unreal |
|---|-------|--------|
| 2D mobile arcade | Excellent (2D physics, UI, mobile export) | Possible but heavier |
| Learning curve | C#, large mobile community | C++/Blueprints, steeper for 2D mobile |
| Store builds | Android + iOS well documented | Yes, but larger binaries |
| Multiplayer | Netcode for GO, Photon, FishNet | Replication system, dedicated servers |
| Fit for current PRD | **Best match** | Overkill unless going 3D |

## Requirements (local machine)

- **Unity 6** (6000.0.38f1 or newer LTS) with modules:
  - Android Build Support (+ NDK, SDK)
  - iOS Build Support (macOS only for IPA)
- **Unity Hub** for project management
- Disk: ~10 GB for Editor + platforms
- Existing **FastAPI backend** (this repo's `backend/`) for player progress, shop, leaderboard

## Quick start

1. Open Unity Hub → **Add project from disk** → select `unity/DharmaBattle/`
2. Let Unity import packages (Input System, Netcode, UGUI).
3. Create scenes (see Scene setup below).
4. Start FastAPI: `uvicorn server:app --port 8001`
5. Set API URL on `ApiClient` component: `http://YOUR_LAN_IP:8001` (not localhost on device builds).

## What's ported from Expo

| Expo / React Native | Unity |
|---------------------|-------|
| `backend/server.py` config | `Assets/Resources/GameData.json` |
| `frontend/app/battle.tsx` loop | `BattleManager`, `PlayerController`, `EnemyController`, `Bullet` |
| `frontend/src/game/api.ts` | `ApiClient.cs` |
| `frontend/src/game/store.tsx` | `GameSession.cs` |
| Virtual joystick | `VirtualJoystick.cs` |
| Hero abilities | `PlayerController.TriggerAbility()` |

## Scene setup (manual in Editor)

### 1. Bootstrap (`Scenes/Bootstrap.unity`)
- Empty GameObject `App` with:
  - `ApiClient`
  - `GameSession`

### 2. Battle (`Scenes/Battle.unity`)
- `BattleManager` — assign `enemyPrefab`, `player`, `arenaBounds`
- `Player` — tag `Player`, `Rigidbody2D` (kinematic), `CircleCollider2D`, `PlayerController`, sprite child
- `Enemy` prefab — `EnemyController`, `CircleCollider2D` (trigger), `Rigidbody2D` (kinematic)
- `Bullet` prefab — `Bullet`, `CircleCollider2D` (trigger), small sprite
- `Arena` — `BoxCollider2D` defining play area (assign to BattleManager)
- Canvas with `VirtualJoystick` + ability button (`BattleHUD`)

### 3. Build Settings
Add scenes: Bootstrap → MainMenu (TODO) → Battle

## APK / IPA builds (local only)

### Android APK / AAB
1. File → Build Settings → Android → Switch Platform
2. Player Settings → Package: `com.emergent.dharmacombat.xwhm9b` (match `frontend/app.json`)
3. Publishing Settings → create/use keystore
4. Build App Bundle (Play Store) or APK (testing)

### iOS IPA
Requires **macOS + Xcode**:
1. Switch platform to iOS
2. Bundle ID: `com.emergent.dharmacombat.xwhm9b`
3. Build → open Xcode → Archive → Distribute

## Multiplayer path (Unity)

`com.unity.netcode.gameobjects` is included in `Packages/manifest.json`.

**Recommended v1:** 2–4 player co-op wave survival
1. Extract wave spawning to server-authoritative `NetworkBattleManager`
2. Headless Linux dedicated server build
3. Clients send input only; server simulates enemies
4. On match end, host calls existing `POST /api/match/complete`

See `Assets/Scripts/Multiplayer/MultiplayerNotes.cs`.

Alternatives: **Photon Fusion** (relay, faster prototype), **FishNet** (open source).

## Backend reuse

Keep the FastAPI + MongoDB backend from this repo:
- Player creation, coins, XP, level-up
- Shop (heroes/weapons)
- Leaderboard
- Stripe IAP (optional)

Unity replaces only the **client rendering + input + battle simulation**. No need to rewrite backend unless you add real-time multiplayer sync (then add WebSocket room endpoints).

## Migration phases

1. **Phase 1 — Playable battle** (this scaffold): single-player waves in Unity Editor
2. **Phase 2 — Meta screens**: lobby, hero/weapon/map select UI
3. **Phase 3 — Mobile builds**: Android APK, then iOS on Mac
4. **Phase 4 — Multiplayer**: Netcode dedicated server co-op
5. **Phase 5 — Polish**: VFX, sprites, audio, haptics

## Unreal option

If you still want Unreal:
- Use **top-down template** + **Lyra** or custom C++ character
- Re-implement wave logic in C++ or Blueprints
- Keep FastAPI as REST backend (Unreal `HTTP` module)
- Expect longer timeline and larger team/tooling needs

This repo's Unity scaffold is the faster path to parity with the existing Expo MVP.
