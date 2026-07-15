// Lightweight sound service using expo-audio.
// Uses public CDN sound URLs (no assets bundled).
// Safe to call on web — falls back to no-op if audio fails.

import { AudioPlayer, createAudioPlayer } from "expo-audio";
import { Platform } from "react-native";
import { storage } from "@/src/utils/storage";

const SOUNDS = {
  shoot: "https://cdn.pixabay.com/download/audio/2022/03/24/audio_57e28d5c93.mp3?filename=laser-shoot-38126.mp3",
  hit: "https://cdn.pixabay.com/download/audio/2022/03/15/audio_8cb749e451.mp3?filename=hit-hurt-6295.mp3",
  pickup: "https://cdn.pixabay.com/download/audio/2022/03/10/audio_9de3e42d1e.mp3?filename=coin-collect-retro-8bit-sound-effect-145251.mp3",
  victory: "https://cdn.pixabay.com/download/audio/2022/03/15/audio_1f10d5b70b.mp3?filename=success-1-6297.mp3",
  defeat: "https://cdn.pixabay.com/download/audio/2022/03/10/audio_a7c15f0f83.mp3?filename=violin-lose-1-185125.mp3",
};

const players: Partial<Record<keyof typeof SOUNDS, AudioPlayer>> = {};
let sfxEnabled = true;
const KEY = "dharma_sfx_enabled";

export const soundService = {
  async init() {
    const saved = await storage.getItem<boolean>(KEY, true);
    sfxEnabled = saved !== false;
  },
  async toggle() {
    sfxEnabled = !sfxEnabled;
    await storage.setItem(KEY, sfxEnabled);
    return sfxEnabled;
  },
  isEnabled() {
    return sfxEnabled;
  },
  play(name: keyof typeof SOUNDS) {
    if (!sfxEnabled) return;
    try {
      let p = players[name];
      if (!p) {
        p = createAudioPlayer({ uri: SOUNDS[name] });
        players[name] = p;
      }
      p.seekTo(0);
      p.volume = Platform.OS === "web" ? 0.4 : 0.7;
      p.play();
    } catch {
      // silent fail — sound is non-critical
    }
  },
};
