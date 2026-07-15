import { storage } from "@/src/utils/storage";

export type GraphicsQuality = "low" | "high";

export type GameSettings = {
  sfxVolume: number;
  musicVolume: number;
  sensitivity: number;
  graphics: GraphicsQuality;
};

const KEY = "dharma_game_settings";

const DEFAULTS: GameSettings = {
  sfxVolume: 0.7,
  musicVolume: 0.5,
  sensitivity: 1,
  graphics: "high",
};

let cache: GameSettings = { ...DEFAULTS };

export const settingsService = {
  async init() {
    const raw = await storage.getItem<string>(KEY, "");
    if (raw) {
      try {
        cache = { ...DEFAULTS, ...JSON.parse(raw) };
      } catch {
        cache = { ...DEFAULTS };
      }
    }
    return cache;
  },

  get(): GameSettings {
    return { ...cache };
  },

  async update(patch: Partial<GameSettings>) {
    cache = { ...cache, ...patch };
    await storage.setItem(KEY, JSON.stringify(cache));
    return cache;
  },
};
