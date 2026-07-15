/**
 * WebSocket client for Dharma Battle co-op rooms.
 * REST creates/joins; WS syncs lobby + authoritative snapshots.
 */

const BASE = process.env.EXPO_PUBLIC_BACKEND_URL || "";

export type MpPlayerInfo = {
  player_id: string;
  name: string;
  hero_id: string;
  weapon_id: string;
  ready: boolean;
  connected: boolean;
  color: string;
  letter: string;
};

export type RoomSummary = {
  code: string;
  map_id: string;
  map_name?: string;
  host_id: string;
  phase: string;
  player_count: number;
  max_players: number;
  players: MpPlayerInfo[];
};

export type SnapshotPlayer = {
  id: string;
  name: string;
  x: number;
  y: number;
  hp: number;
  max_hp: number;
  alive: boolean;
  kills: number;
  color: string;
  letter: string;
  ability_cd: number;
  invuln: boolean;
};

export type SnapshotEnemy = {
  id: number;
  x: number;
  y: number;
  hp: number;
  max_hp: number;
  radius: number;
  color: string;
  type: string;
};

export type GameSnapshot = {
  type: "snapshot";
  phase: string;
  wave: number;
  total_waves: number;
  elapsed: number;
  arena: { w: number; h: number; bg: string };
  feed: string[];
  players: SnapshotPlayer[];
  enemies: SnapshotEnemy[];
  bullets: { id: number; x: number; y: number; color: string }[];
  drops: { id: number; x: number; y: number; kind: string }[];
};

export type MatchEndMsg = {
  type: "match_end";
  victory: boolean;
  elapsed: number;
  results: { player_id: string; name: string; kills: number; alive: boolean }[];
  snapshot: GameSnapshot;
};

type Listener = (msg: any) => void;

async function rest<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE}/api/mp${path}`, {
    ...opts,
    headers: { "Content-Type": "application/json", ...(opts.headers as any) },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status}: ${body}`);
  }
  return res.json();
}

function wsUrl(code: string, playerId: string): string {
  const root = BASE.replace(/\/$/, "");
  const proto = root.startsWith("https") ? "wss" : "ws";
  const host = root.replace(/^https?:\/\//, "");
  return `${proto}://${host}/api/mp/ws/${code}?player_id=${encodeURIComponent(playerId)}`;
}

export const mpApi = {
  createRoom: (body: {
    player_id: string;
    player_name: string;
    hero_id: string;
    weapon_id: string;
    map_id: string;
  }) => rest<RoomSummary>("/rooms", { method: "POST", body: JSON.stringify(body) }),

  joinRoom: (body: {
    player_id: string;
    player_name: string;
    hero_id: string;
    weapon_id: string;
    code: string;
  }) => rest<RoomSummary>("/rooms/join", { method: "POST", body: JSON.stringify(body) }),

  listRooms: () => rest<RoomSummary[]>("/rooms"),
  getRoom: (code: string) => rest<RoomSummary>(`/rooms/${code}`),
};

export class MpClient {
  private ws: WebSocket | null = null;
  private listeners = new Set<Listener>();
  private inputTimer: ReturnType<typeof setInterval> | null = null;
  private pendingInput: {
    mx: number;
    my: number;
    fire_x?: number | null;
    fire_y?: number | null;
    ability?: boolean;
  } = { mx: 0, my: 0 };

  room: RoomSummary | null = null;
  snapshot: GameSnapshot | null = null;
  lastMatchEnd: MatchEndMsg | null = null;
  connected = false;

  on(fn: Listener) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(msg: any) {
    for (const fn of this.listeners) fn(msg);
  }

  connect(code: string, playerId: string): Promise<void> {
    this.disconnect();
    return new Promise((resolve, reject) => {
      const url = wsUrl(code, playerId);
      const ws = new WebSocket(url);
      this.ws = ws;
      let settled = false;

      ws.onopen = () => {
        this.connected = true;
        // Send inputs at 20Hz
        this.inputTimer = setInterval(() => this.flushInput(), 50);
        if (!settled) {
          settled = true;
          resolve();
        }
      };
      ws.onerror = () => {
        if (!settled) {
          settled = true;
          reject(new Error("WebSocket failed"));
        }
      };
      ws.onclose = () => {
        this.connected = false;
        if (this.inputTimer) {
          clearInterval(this.inputTimer);
          this.inputTimer = null;
        }
        this.emit({ type: "disconnected" });
      };
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(typeof ev.data === "string" ? ev.data : "");
          if (msg.type === "room_state") this.room = msg.room;
          if (msg.type === "snapshot" || msg.type === "match_start") {
            if (msg.type === "match_start") this.snapshot = msg as any;
            else this.snapshot = msg;
          }
          if (msg.type === "match_end") this.lastMatchEnd = msg;
          this.emit(msg);
        } catch {
          /* ignore */
        }
      };
    });
  }

  disconnect() {
    if (this.inputTimer) {
      clearInterval(this.inputTimer);
      this.inputTimer = null;
    }
    if (this.ws) {
      try {
        this.ws.send(JSON.stringify({ type: "leave" }));
      } catch {
        /* ignore */
      }
      try {
        this.ws.close();
      } catch {
        /* ignore */
      }
    }
    this.ws = null;
    this.connected = false;
  }

  setReady(ready = true, start = false) {
    this.ws?.send(JSON.stringify({ type: "ready", ready, start }));
  }

  setMove(mx: number, my: number) {
    this.pendingInput.mx = mx;
    this.pendingInput.my = my;
  }

  fireAt(x: number, y: number) {
    this.pendingInput.fire_x = x;
    this.pendingInput.fire_y = y;
  }

  useAbility() {
    this.pendingInput.ability = true;
  }

  private flushInput() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const payload: any = {
      type: "input",
      mx: this.pendingInput.mx,
      my: this.pendingInput.my,
    };
    if (this.pendingInput.fire_x != null) {
      payload.fire_x = this.pendingInput.fire_x;
      payload.fire_y = this.pendingInput.fire_y;
      this.pendingInput.fire_x = null;
      this.pendingInput.fire_y = null;
    }
    if (this.pendingInput.ability) {
      payload.ability = true;
      this.pendingInput.ability = false;
    }
    try {
      this.ws.send(JSON.stringify(payload));
    } catch {
      /* ignore */
    }
  }
}

/** Shared singleton for lobby → battle handoff */
export const mpSession = {
  client: null as MpClient | null,
  code: "" as string,
};
