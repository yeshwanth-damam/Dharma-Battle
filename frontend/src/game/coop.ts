// Thin WebSocket client for the co-op multiplayer room protocol.
// The server (backend/game_rooms.py) is authoritative: we only ever send
// input and render whatever snapshot comes back — no local simulation here.
import { wsRoomUrl } from "./api";

// Must match ARENA_W / ARENA_H in backend/game_rooms.py — the server
// simulates in this fixed logical space; clients scale it to their screen.
export const ARENA_W = 390;
export const ARENA_H = 640;

export type RoomLifecycle = "waiting" | "countdown" | "playing" | "finished";

export type CoopVec = { x: number; y: number };

export type CoopPlayer = {
  id: string;
  name: string;
  hero_id: string;
  weapon_id: string;
  x: number;
  y: number;
  hp: number;
  max_hp: number;
  alive: boolean;
  connected: boolean;
  kills: number;
  ability_ready: boolean;
  ability_cd: number;
  invuln: boolean;
};

export type CoopEnemy = { id: number; x: number; y: number; hp: number; max_hp: number; radius: number; color: string; kind: "grunt" | "swift" | "brute" };
export type CoopBullet = { id: number; x: number; y: number; color: string };
export type CoopDrop = { id: number; x: number; y: number; kind: "hp" | "coin" };
export type CoopEvent =
  | { type: "wave"; wave: number }
  | { type: "kill"; player_id: string; enemy: string }
  | { type: "ability"; player_id: string; text: string }
  | { type: "down"; player_id: string }
  | { type: "match_end"; victory: boolean };

export type CoopSnapshot = {
  type: "state";
  code: string;
  state: RoomLifecycle;
  map_id: string;
  wave: number;
  total_waves: number;
  elapsed: number;
  countdown: number;
  victory: boolean | null;
  players: CoopPlayer[];
  enemies: CoopEnemy[];
  bullets: CoopBullet[];
  drops: CoopDrop[];
  events: CoopEvent[];
  host_id: string;
  max_players: number;
};

// Lighter-weight roster update pushed whenever someone joins/leaves/(dis)connects
// while the room hasn't started ticking yet (no full simulation is running,
// so there's no CoopSnapshot to broadcast).
export type RoomRosterPlayer = { id: string; name: string; hero_id: string; connected: boolean };

export type LobbyUpdate = {
  type: "lobby";
  code: string;
  state: RoomLifecycle;
  map_id: string;
  host_id: string;
  max_players: number;
  players: RoomRosterPlayer[];
};

export class RoomSocket {
  private ws: WebSocket | null = null;
  onSnapshot: (s: CoopSnapshot) => void = () => {};
  onLobby: (l: LobbyUpdate) => void = () => {};
  onOpen: () => void = () => {};
  onClose: () => void = () => {};
  onError: () => void = () => {};

  connect(code: string, playerId: string) {
    this.close();
    const ws = new WebSocket(wsRoomUrl(code, playerId));
    this.ws = ws;
    ws.onopen = () => this.onOpen();
    ws.onmessage = (evt) => {
      try {
        const data = JSON.parse(evt.data as string);
        if (data && data.type === "state") this.onSnapshot(data as CoopSnapshot);
        else if (data && data.type === "lobby") this.onLobby(data as LobbyUpdate);
      } catch {
        // ignore malformed frames
      }
    };
    ws.onerror = () => this.onError();
    ws.onclose = () => this.onClose();
  }

  get connected() {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  sendInput(opts: { joystick?: CoopVec; fire?: CoopVec | null; ability?: boolean }) {
    if (!this.connected) return;
    const payload: Record<string, unknown> = { type: "input" };
    if (opts.joystick) payload.joystick = opts.joystick;
    if (opts.fire) payload.fire = opts.fire;
    if (opts.ability) payload.ability = true;
    this.ws!.send(JSON.stringify(payload));
  }

  close() {
    if (this.ws) {
      try {
        this.ws.onclose = null;
        this.ws.close();
      } catch {
        // ignore
      }
    }
    this.ws = null;
  }
}
