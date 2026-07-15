// Placeholder for Unity Netcode for GameObjects integration.
// Multiplayer v1: dedicated server build + client builds, 2-4 player co-op waves.
//
// Recommended packages (already in Packages/manifest.json):
//   com.unity.netcode.gameobjects
//
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
