import React, { createContext, useContext, useEffect, useState, useCallback, ReactNode } from "react";
import { storage } from "@/src/utils/storage";
import { api, Player, GameConfig } from "./api";

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
};

const StoreContext = createContext<Ctx | null>(null);
const KEY = "dharma_player_id";

export function StoreProvider({ children }: { children: ReactNode }) {
  const [player, setPlayer] = useState<Player | null>(null);
  const [config, setConfig] = useState<GameConfig | null>(null);
  const [selectedMap, setSelectedMap] = useState<string>("kurukshetra");
  const [loading, setLoading] = useState(true);

  const boot = useCallback(async () => {
    setLoading(true);
    try {
      const cfg = await api.config();
      setConfig(cfg);
      const savedId = await storage.getItem<string>(KEY, "");
      if (savedId) {
        try {
          const p = await api.getPlayer(savedId);
          setPlayer(p);
        } catch {
          await storage.removeItem(KEY);
        }
      }
    } catch (e) {
      console.log("boot error", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    boot();
  }, [boot]);

  const createPlayer = async (name: string) => {
    const p = await api.createPlayer(name);
    await storage.setItem(KEY, p.id);
    setPlayer(p);
    return p;
  };

  const refresh = async () => {
    if (!player) return;
    const p = await api.getPlayer(player.id);
    setPlayer(p);
  };

  const logout = async () => {
    await storage.removeItem(KEY);
    setPlayer(null);
  };

  return (
    <StoreContext.Provider
      value={{ player, config, selectedMap, loading, setSelectedMap, setPlayer, createPlayer, refresh, logout }}
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
