# Dharma Battle — Unity Rewrite

Unity is the recommended engine for this project (2D top-down mobile wave shooter).

## You installed Unity Hub + Unity 6 — do this next

### 1. Open the project
1. **Unity Hub** → **Add** → **Add project from disk**
2. Select the folder: `unity/DharmaBattle/` (inside this repo)
3. Use **Unity 6** (6000.0.x). If Hub asks to upgrade the project, accept.

### 2. One-click setup (first time only)
After scripts compile:
1. Menu bar → **Dharma Battle** → **1. Setup Project (Run Once)**
2. Wait for the dialog: *"Setup complete!"*
3. **Dharma Battle** → **2. Open Bootstrap Scene**
4. Press **Play** ▶

You should see: Bootstrap loads → Battle scene → joystick moves player → enemies spawn in waves.

> **Offline mode:** Battle works without the FastAPI backend. Cloud save needs the API (step 3).

### 3. Connect backend (optional, for coins/XP/leaderboard)
In a terminal from the repo root:
```bash
cd backend
# create .env with MONGO_URL, DB_NAME, STRIPE_API_KEY, EMERGENT_AUTH_URL, DEV_MODE=true
PYTHONPATH=. uvicorn server:app --host 0.0.0.0 --port 8001
```

In Unity Editor:
1. Open **Bootstrap** scene
2. Select **App** → **Api Client** component
3. Set **Base Url** to `http://localhost:8001` (Editor) or `http://YOUR_LAN_IP:8001` (phone build)

### 4. Build Android APK
1. **File → Build Settings → Android → Switch Platform**
2. **Player Settings → Other Settings → Package Name:** `com.emergent.dharmacombat.xwhm9b`
3. **Build** (APK for testing, or App Bundle for Play Store)

### 5. iOS (Mac only)
Switch platform to iOS → Build → open Xcode → Archive.

---

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

## Quick start (summary)

1. Unity Hub → open `unity/DharmaBattle/`
2. **Dharma Battle → Setup Project (Run Once)**
3. Open Bootstrap scene → **Play**
4. Point ApiClient at FastAPI when ready for cloud save

## What's ported from Expo

| Expo / React Native | Unity |
|---------------------|-------|
| `backend/server.py` config | `Assets/Resources/GameData.json` |
| `frontend/app/battle.tsx` loop | `BattleManager`, `PlayerController`, `EnemyController`, `Bullet` |
| `frontend/src/game/api.ts` | `ApiClient.cs` |
| `frontend/src/game/store.tsx` | `GameSession.cs` |
| Virtual joystick | `VirtualJoystick.cs` |
| Hero abilities | `PlayerController.TriggerAbility()` |

## Scene setup

**Automatic:** Run **Dharma Battle → Setup Project** (creates Bootstrap + Battle scenes, prefabs, UI).

**Manual reference** (if you prefer to wire yourself):
### Bootstrap (`Assets/DharmaBattle/Scenes/Bootstrap.unity`)
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

## Troubleshooting

### Safe Mode / red compile errors on open

Usually caused by a corrupted `Library/` cache or the old Netcode package pulling invalid modules.

1. **Close Unity completely**
2. Delete these folders inside `unity/DharmaBattle/`:
   - `Library/`
   - `Temp/`
   - `obj/`
3. If present, delete `Assets/DefaultNetworkPrefabs` (leftover from Netcode — not used in Phase 1)
4. Pull latest repo (manifest fix removes Netcode until multiplayer phase)
5. Reopen the project in Unity Hub

### "Dharma Battle" menu missing

Wait for script compile to finish (spinner bottom-right). Check Console for errors.

### Battle works but no cloud save

Start FastAPI backend and set ApiClient Base Url. Offline mode is intentional when API is unreachable.

---

## Multiplayer path (Unity — later phase)

Netcode for GameObjects was **removed from the default manifest** because it caused compile errors before multiplayer is implemented. When you reach Phase 4, add via Package Manager:

`com.unity.netcode.gameobjects`

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
