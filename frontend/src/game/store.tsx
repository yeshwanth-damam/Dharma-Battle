import React, { createContext, useContext, useEffect, useState, useCallback, ReactNode } from "react";
import { storage } from "@/src/utils/storage";
import { api, Player, GameConfig, TOKEN_STORAGE_KEY } from "./api";
import { soundService } from "./sound";
import { settingsService } from "./settings";

type Ctx = {
  player: Player | null;
  config: GameConfig | null;
  selectedMap: string;
  loading: boolean;
  setSelectedMap: (id: string) => void;
  setPlayer: (p: Player) => void;
  createPlayer: (name: string) => Promise<Player>;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
  saveSession: (token: string) => Promise<void>;
};

const StoreContext = createContext<Ctx | null>(null);
const PLAYER_KEY = "dharma_player_id";
const MAP_KEY = "dharma_selected_map";

export function StoreProvider({ children }: { children: ReactNode }) {
  const [player, setPlayer] = useState<Player | null>(null);
  const [config, setConfig] = useState<GameConfig | null>(null);
  const [selectedMap, setSelectedMap] = useState<string>("kurukshetra");
  const [loading, setLoading] = useState(true);

  const boot = useCallback(async () => {
    setLoading(true);
    try {
      await soundService.init();
      await settingsService.init();
      const savedMap = await storage.getItem<string>(MAP_KEY, "");
      if (savedMap) setSelectedMap(savedMap);
      const cfg = await api.config();
      setConfig(cfg);

      // Try authenticated Google session first
      const token = await storage.secureGet<string>(TOKEN_STORAGE_KEY, "");
      if (token) {
        try {
          const me = await api.me();
          setPlayer(me);
          await storage.setItem(PLAYER_KEY, me.id);
          return;
        } catch {
          await storage.secureRemove(TOKEN_STORAGE_KEY);
        }
      }

      const savedId = await storage.getItem<string>(PLAYER_KEY, "");
      if (savedId) {
        try {
          const p = await api.getPlayer(savedId);
          setPlayer(p);
        } catch {
          await storage.removeItem(PLAYER_KEY);
        }
      }
    } catch (e) {
      console.log("boot error", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { boot(); }, [boot]);

  const createPlayer = async (name: string) => {
    const p = await api.createPlayer(name);
    await storage.setItem(PLAYER_KEY, p.id);
    setPlayer(p);
    return p;
  };

  const refresh = async () => {
    if (!player) return;
    try {
      const p = await api.getPlayer(player.id);
      setPlayer(p);
    } catch {
      // ignore
    }
  };

  const logout = async () => {
    try { await api.logout(); } catch { /* ignore */ }
    await storage.removeItem(PLAYER_KEY);
    await storage.secureRemove(TOKEN_STORAGE_KEY);
    setPlayer(null);
  };

  const saveSession = async (token: string) => {
    await storage.secureSet(TOKEN_STORAGE_KEY, token);
  };

  const persistMap = (id: string) => {
    setSelectedMap(id);
    storage.setItem(MAP_KEY, id).catch(() => {});
  };

  return (
    <StoreContext.Provider
      value={{ player, config, selectedMap, loading, setSelectedMap: persistMap, setPlayer, createPlayer, refresh, logout, saveSession }}
    >
      {children}
    </StoreContext.Provider>
  );
}

export function useStore() {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useStore must be used within StoreProvider");
  return ctx;
}
