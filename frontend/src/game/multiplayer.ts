// WebSocket client for the authoritative squad co-op battle server.
// The server simulates everything at 20 Hz; this client only sends inputs
// and consumes state snapshots.

const BASE = process.env.EXPO_PUBLIC_BACKEND_URL || "";

export type JoinMode = "quick" | "create" | "code";

export type LobbyPlayer = { id: string; name: string; hero: string; color: string; letter: string };

export type NetPlayer = {
  id: string;
  name: string;
  hero: string;
  color: string;
  letter: string;
  x: number;
  y: number;
  hp: number;
  max_hp: number;
  kills: number;
  alive: boolean;
  invuln: boolean;
  ability_cd: number;
};

export type NetEnemy = { id: number; x: number; y: number; hp: number; max_hp: number; r: number; type: string; color: string };
export type NetBullet = { id: number; x: number; y: number; color: string };
export type NetDrop = { id: number; x: number; y: number; kind: "hp" | "coin" };

export type StateMsg = {
  type: "state";
  wave: number;
  waves_total: number;
  elapsed: number;
  players: NetPlayer[];
  enemies: NetEnemy[];
  bullets: NetBullet[];
  drops: NetDrop[];
  feed: string[];
};

export type JoinedMsg = { type: "joined"; room_id: string; code: string; you: string; map: any; host: string };
export type LobbyMsg = { type: "lobby"; players: LobbyPlayer[]; host: string; code: string; countdown: number | null };
export type StartMsg = { type: "start"; arena: { w: number; h: number }; map: any; waves_total: number };
export type EndMsg = {
  type: "end";
  victory: boolean;
  stats: { id: string; name: string; kills: number; alive: boolean }[];
  rewards: Record<string, { coins: number; xp: number; score: number; kills: number; bonus_coins: number; survived: number }>;
};
export type ErrorMsg = { type: "error"; message: string };

export type ServerMsg = JoinedMsg | LobbyMsg | StartMsg | StateMsg | EndMsg | ErrorMsg | { type: "pong" };

type Handlers = {
  onJoined?: (m: JoinedMsg) => void;
  onLobby?: (m: LobbyMsg) => void;
  onStart?: (m: StartMsg) => void;
  onState?: (m: StateMsg) => void;
  onEnd?: (m: EndMsg) => void;
  onError?: (message: string) => void;
  onClose?: () => void;
};

function wsUrl(): string {
  const base = BASE.replace(/^http/, "ws").replace(/\/+$/, "");
  return `${base}/api/ws/battle`;
}

export class BattleSocket {
  private ws: WebSocket | null = null;
  private handlers: Handlers;
  private closedByUs = false;

  constructor(handlers: Handlers) {
    this.handlers = handlers;
  }

  connect(playerId: string, mode: JoinMode, opts: { code?: string; mapId?: string } = {}) {
    this.closedByUs = false;
    const ws = new WebSocket(wsUrl());
    this.ws = ws;

    ws.onopen = () => {
      this.send({ type: "join", player_id: playerId, mode, code: opts.code, map_id: opts.mapId });
    };

    ws.onmessage = (ev) => {
      let msg: ServerMsg;
      try {
        msg = JSON.parse(ev.data as string);
      } catch {
        return;
      }
      switch (msg.type) {
        case "joined": this.handlers.onJoined?.(msg); break;
        case "lobby": this.handlers.onLobby?.(msg); break;
        case "start": this.handlers.onStart?.(msg); break;
        case "state": this.handlers.onState?.(msg); break;
        case "end": this.handlers.onEnd?.(msg); break;
        case "error": this.handlers.onError?.(msg.message); break;
      }
    };

    ws.onerror = () => {
      if (!this.closedByUs) this.handlers.onError?.("Connection error");
    };

    ws.onclose = () => {
      if (!this.closedByUs) this.handlers.onClose?.();
    };
  }

  private send(obj: object) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(obj));
    }
  }

  sendInput(move: { x: number; y: number }, fire: { x: number; y: number } | null, ability: boolean) {
    this.send({ type: "input", move, fire: fire ?? undefined, ability: ability || undefined });
  }

  requestStart() {
    this.send({ type: "start" });
  }

  leave() {
    this.closedByUs = true;
    this.send({ type: "leave" });
    try { this.ws?.close(); } catch { /* noop */ }
    this.ws = null;
  }
}
