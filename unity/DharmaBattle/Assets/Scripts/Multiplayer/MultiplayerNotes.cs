// Placeholder for Unity Netcode for GameObjects integration.
// Multiplayer v1: dedicated server build + client builds, 2-4 player co-op waves.
//
// Netcode for GameObjects — add in Phase 4 via Package Manager when implementing multiplayer.
// Removed from default manifest.json because it pulled invalid module deps on Unity 6.0.79f1.
// Architecture:
//   1. Host or dedicated Linux headless server runs wave logic (BattleManager authoritative).
//   2. Clients send movement input via ServerRpc; server broadcasts enemy positions.
//   3. Match results still POST to FastAPI /match/complete for coins/XP/leaderboard.
//
// Alternative: Photon Fusion / FishNet if you need relay without dedicated servers.
//
// This file documents the path — implement NetworkBattleManager : NetworkBehaviour
// once core single-player battle is validated in Editor.

namespace DharmaBattle.Multiplayer
{
    public static class MultiplayerNotes
    {
        public const string RecommendedStack = "Netcode for GameObjects + dedicated headless server";
        public const int TargetPlayers = 4;
    }
}
