import { storage } from "@/src/utils/storage";

const BASE = process.env.EXPO_PUBLIC_BACKEND_URL || "";
const TOKEN_KEY = "dharma_session_token";

async function req<T>(path: string, opts: RequestInit = {}, authenticated = false): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json", ...(opts.headers as any) };
  if (authenticated) {
    const t = await storage.secureGet<string>(TOKEN_KEY, "");
    if (t) headers["Authorization"] = `Bearer ${t}`;
  }
  const res = await fetch(`${BASE}/api${path}`, { ...opts, headers });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status}: ${body}`);
  }
  return res.json();
}

export type Hero = { id: string; name: string; title: string; hp: number; atk: number; spd: number; skill: string; price: number; color: string; letter: string };
export type Weapon = { id: string; name: string; desc: string; damage: number; cooldown: number; price: number; color: string };
export type GameMap = { id: string; name: string; desc: string; difficulty: number; waves: number; bg: string };
export type CoinPack = { coins: number; label: string; usd: number };
export type PremiumPack = { amount: number; label: string; kind: string };

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
  premium_warrior: boolean;
  email?: string | null;
  google_linked: boolean;
};

export type GameConfig = {
  heroes: Hero[];
  weapons: Weapon[];
  maps: GameMap[];
  coin_packs: Record<string, CoinPack>;
  premium_pack: PremiumPack;
};

export type LeaderboardEntry = {
  id: string;
  name: string;
  level: number;
  kills: number;
  wins: number;
  best_score: number;
};

export type CheckoutResp = { session_id: string; url: string };
export type CheckoutStatus = {
  session_id: string;
  status: string;
  payment_status: string;
  coins_granted: boolean;
  pack_id: string | null;
};

export const api = {
  config: () => req<GameConfig>("/game/config"),
  createPlayer: (name: string) => req<Player>("/player", { method: "POST", body: JSON.stringify({ name }) }),
  getPlayer: (id: string) => req<Player>(`/player/${id}`),
  select: (player_id: string, hero_id?: string, weapon_id?: string) =>
    req<Player>("/player/select", { method: "POST", body: JSON.stringify({ player_id, hero_id, weapon_id }) }),
  completeMatch: (player_id: string, map_id: string, kills: number, survived_seconds: number, victory: boolean, bonus_coins = 0) =>
    req<Player>("/match/complete", { method: "POST", body: JSON.stringify({ player_id, map_id, kills, survived_seconds, victory, bonus_coins }) }),
  purchase: (player_id: string, item_type: "hero" | "weapon", item_id: string) =>
    req<Player>("/shop/purchase", { method: "POST", body: JSON.stringify({ player_id, item_type, item_id }) }),
  leaderboard: () => req<LeaderboardEntry[]>("/leaderboard"),
  stripeCheckout: (player_id: string, pack_id: string, origin_url: string) =>
    req<CheckoutResp>("/stripe/checkout", { method: "POST", body: JSON.stringify({ player_id, pack_id, origin_url }) }),
  stripeStatus: (session_id: string) => req<CheckoutStatus>(`/stripe/status/${session_id}`),
  googleLink: (player_id: string, session_token: string) =>
    req<{ player: Player; session_token: string; email: string }>("/auth/google/link", {
      method: "POST",
      body: JSON.stringify({ player_id, session_token }),
    }),
  me: () => req<Player>("/auth/me", {}, true),
  logout: () => req<{ ok: boolean }>("/auth/logout", { method: "POST" }, true),
};

export const TOKEN_STORAGE_KEY = TOKEN_KEY;
