/**
 * Client for the authoritative real-time co-op server (backend `realtime.py`).
 *
 * The server owns all game state; this client only:
 *   1. opens a WebSocket and sends a `join`,
 *   2. streams local input intent (`input` messages),
 *   3. renders the `state` snapshots the server broadcasts.
 *
 * World coordinates are in the server's fixed arena space (see `arena` in the
 * welcome payload); callers scale them to their own screen.
 */

const BASE = process.env.EXPO_PUBLIC_BACKEND_URL || "";

export function battleWsUrl(): string {
  let base = BASE;
  if (!base && typeof window !== "undefined" && window.location) {
    base = window.location.origin;
  }
  const normalized = base
    .replace(/^https:\/\//i, "wss://")
    .replace(/^http:\/\//i, "ws://")
    .replace(/\/$/, "");
  return `${normalized}/api/ws/battle`;
}

// ---------- Wire types ----------
export type Vec = { x: number; y: number };

export type NetPlayer = {
  id: string;
  name: string;
  hero: string;
  color: string;
  letter: string;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  alive: boolean;
  kills: number;
  abilityCd: number;
  invuln: number;
  connected: boolean;
};

export type NetEnemy = {
  id: number;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  r: number;
  type: "grunt" | "brute" | "swift";
  color: string;
};

export type NetBullet = { id: number; x: number; y: number; color: string };
export type NetDrop = { id: number; x: number; y: number; kind: "hp" | "coin" };

export type NetEvent = {
  kind: string;
  [key: string]: unknown;
};

export type WelcomeMsg = {
  t: "welcome";
  self_id: string;
  room_id: string;
  map: string;
  map_bg: string;
  tick_rate: number;
  arena: { w: number; h: number };
  total_waves: number;
  max_players: number;
};

export type StateMsg = {
  t: "state";
  seq: number;
  status: "playing" | "victory" | "defeat";
  wave: number;
  totalWaves: number;
  elapsed: number;
  players: NetPlayer[];
  enemies: NetEnemy[];
  bullets: NetBullet[];
  drops: NetDrop[];
  events: NetEvent[];
};

export type JoinPayload = {
  name: string;
  hero: string;
  weapon: string;
  map: string;
  player_id?: string;
};

type Handlers = {
  onWelcome?: (msg: WelcomeMsg) => void;
  onState?: (msg: StateMsg) => void;
  onPong?: (ts: number) => void;
  onError?: (message: string) => void;
  onClose?: () => void;
};

export class RealtimeClient {
  private ws: WebSocket | null = null;
  private handlers: Handlers = {};
  private join: JoinPayload;
  private closed = false;

  constructor(join: JoinPayload, handlers: Handlers = {}) {
    this.join = join;
    this.handlers = handlers;
  }

  connect() {
    const url = battleWsUrl();
    try {
      this.ws = new WebSocket(url);
    } catch (e) {
      this.handlers.onError?.(`Failed to open socket: ${String(e)}`);
      return;
    }

    this.ws.onopen = () => {
      this.send({ t: "join", ...this.join });
    };
    this.ws.onmessage = (ev) => {
      let msg: any;
      try {
        msg = JSON.parse(typeof ev.data === "string" ? ev.data : "");
      } catch {
        return;
      }
      switch (msg?.t) {
        case "welcome":
          this.handlers.onWelcome?.(msg as WelcomeMsg);
          break;
        case "state":
          this.handlers.onState?.(msg as StateMsg);
          break;
        case "pong":
          this.handlers.onPong?.(msg.ts);
          break;
        case "error":
          this.handlers.onError?.(msg.message || "server error");
          break;
      }
    };
    this.ws.onerror = () => {
      if (!this.closed) this.handlers.onError?.("connection error");
    };
    this.ws.onclose = () => {
      if (!this.closed) this.handlers.onClose?.();
    };
  }

  private send(obj: unknown) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(obj));
    }
  }

  /** Send the current input intent. `move` is a vector in [-1, 1]. */
  sendInput(move: Vec, opts: { fire?: boolean; aim?: Vec | null; ability?: boolean } = {}) {
    this.send({
      t: "input",
      move,
      fire: !!opts.fire,
      aim: opts.aim ?? null,
      ability: !!opts.ability,
    });
  }

  sendAbility() {
    this.send({ t: "input", move: { x: 0, y: 0 }, ability: true });
  }

  ping() {
    this.send({ t: "ping", ts: Date.now() });
  }

  close() {
    this.closed = true;
    try {
      this.send({ t: "leave" });
    } catch {
      /* ignore */
    }
    try {
      this.ws?.close();
    } catch {
      /* ignore */
    }
    this.ws = null;
  }
}
