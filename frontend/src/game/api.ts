const BASE = process.env.EXPO_PUBLIC_BACKEND_URL || "";

async function req<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE}/api${path}`, {
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status}: ${body}`);
  }
  return res.json();
}

export type Hero = { id: string; name: string; title: string; hp: number; atk: number; spd: number; skill: string; price: number; color: string; letter: string };
export type Weapon = { id: string; name: string; desc: string; damage: number; cooldown: number; price: number; color: string };
export type GameMap = { id: string; name: string; desc: string; difficulty: number; waves: number; bg: string };
export type CoinPack = { coins: number; label: string };

export type Player = {
  id: string;
  name: string;
  level: number;
  xp: number;
  coins: number;
  kills: number;
  matches: number;
  wins: number;
  best_score: number;
  owned_heroes: string[];
  owned_weapons: string[];
  selected_hero: string;
  selected_weapon: string;
};

export type GameConfig = {
  heroes: Hero[];
  weapons: Weapon[];
  maps: GameMap[];
  coin_packs: Record<string, CoinPack>;
};

export type LeaderboardEntry = {
  id: string;
  name: string;
  level: number;
  kills: number;
  wins: number;
  best_score: number;
};

export const api = {
  config: () => req<GameConfig>("/game/config"),
  createPlayer: (name: string) =>
    req<Player>("/player", { method: "POST", body: JSON.stringify({ name }) }),
  getPlayer: (id: string) => req<Player>(`/player/${id}`),
  select: (player_id: string, hero_id?: string, weapon_id?: string) =>
    req<Player>("/player/select", {
      method: "POST",
      body: JSON.stringify({ player_id, hero_id, weapon_id }),
    }),
  completeMatch: (player_id: string, map_id: string, kills: number, survived_seconds: number, victory: boolean) =>
    req<Player>("/match/complete", {
      method: "POST",
      body: JSON.stringify({ player_id, map_id, kills, survived_seconds, victory }),
    }),
  purchase: (player_id: string, item_type: "hero" | "weapon" | "coins", item_id: string) =>
    req<Player>("/shop/purchase", {
      method: "POST",
      body: JSON.stringify({ player_id, item_type, item_id }),
    }),
  leaderboard: () => req<LeaderboardEntry[]>("/leaderboard"),
};
