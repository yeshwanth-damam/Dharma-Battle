import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, Dimensions, PanResponder, Platform } from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { FontAwesome5 } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";

import { COLORS, FONTS } from "@/src/game/theme";
import { useStore } from "@/src/game/store";
import { api } from "@/src/game/api";
import { soundService } from "@/src/game/sound";
import { ARENA_H, ARENA_W, CoopSnapshot, LobbyUpdate, RoomSocket } from "@/src/game/coop";

type V = { x: number; y: number };

const WIN = Dimensions.get("window");
const HUD_TOP = 90;
const HUD_BOTTOM = 190;
const INPUT_SEND_MS = 50; // ~20Hz, matches the server tick rate

function haptic(kind: "light" | "medium" | "heavy" | "success" | "error") {
  if (Platform.OS === "web") return;
  try {
    if (kind === "success") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    else if (kind === "error") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    else if (kind === "heavy") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    else if (kind === "medium") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    else Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  } catch { /* noop */ }
}

type FeedItem = { id: number; text: string; life: number };

export default function CoopBattle() {
  const router = useRouter();
  const { code } = useLocalSearchParams<{ code: string }>();
  const { player, config, refresh } = useStore();

  const socketRef = useRef(new RoomSocket());
  const [snapshot, setSnapshot] = useState<CoopSnapshot | null>(null);
  const [lobbyMsg, setLobbyMsg] = useState<LobbyUpdate | null>(null);
  const [connError, setConnError] = useState(false);
  const joystickRef = useRef<V>({ x: 0, y: 0 });
  const [joyKnob, setJoyKnob] = useState<V>({ x: 0, y: 0 });
  const feedRef = useRef<FeedItem[]>([]);
  const feedUniq = useRef(1);
  const [, setFeedTick] = useState(0);
  const [paused, setPaused] = useState(false);
  const finishHandledRef = useRef(false);
  const lastKnownStateRef = useRef<string>("waiting");

  const arenaTop = HUD_TOP;
  const arenaBottom = WIN.height - HUD_BOTTOM;
  const arenaW = WIN.width;
  const arenaH = arenaBottom - arenaTop;

  const scale = Math.min(arenaW / ARENA_W, arenaH / ARENA_H);
  const offsetX = (arenaW - ARENA_W * scale) / 2;
  const offsetY = (arenaH - ARENA_H * scale) / 2;
  const toScreen = useCallback((x: number, y: number) => ({ sx: offsetX + x * scale, sy: offsetY + y * scale }), [offsetX, offsetY, scale]);

  // ---- connect ----
  useEffect(() => {
    if (!player || !code) return;
    const socket = socketRef.current;
    socket.onSnapshot = (snap) => {
      setSnapshot(snap);
      lastKnownStateRef.current = snap.state;
      for (const ev of snap.events) {
        if (ev.type === "wave") feedRef.current.push({ id: feedUniq.current++, text: `WAVE ${ev.wave}`, life: 2.2 });
        else if (ev.type === "kill") {
          const isMe = ev.player_id === player.id;
          feedRef.current.push({ id: feedUniq.current++, text: `${isMe ? "YOU" : "ALLY"} +1 ${ev.enemy.toUpperCase()}`, life: 1.2 });
          if (isMe) { soundService.play("hit"); haptic("medium"); }
        } else if (ev.type === "ability") {
          feedRef.current.push({ id: feedUniq.current++, text: ev.text, life: 1.8 });
          if (ev.player_id === player.id) haptic("heavy");
        } else if (ev.type === "down") {
          feedRef.current.push({ id: feedUniq.current++, text: `${ev.player_id === player.id ? "YOU" : "ALLY"} DOWN!`, life: 2 });
          if (ev.player_id === player.id) { haptic("error"); soundService.play("defeat"); }
        } else if (ev.type === "match_end") {
          if (ev.victory) { haptic("success"); soundService.play("victory"); }
          else { haptic("error"); }
        }
      }
      feedRef.current = feedRef.current.filter((f) => f.life > 0);
      setFeedTick((t) => (t + 1) % 1000000);
    };
    socket.onLobby = (msg) => setLobbyMsg(msg);
    socket.onOpen = () => setConnError(false);
    socket.onError = () => setConnError(true);
    socket.onClose = () => {
      // A close before the match ever finished (server dropped us) is worth
      // surfacing; a close after "finished" is expected room teardown.
      if (lastKnownStateRef.current !== "finished") setConnError(true);
    };
    socket.connect(code, player.id);
    return () => socket.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, player?.id]);

  // ---- throttled input push ----
  useEffect(() => {
    if (snapshot?.state !== "playing" || paused) return;
    const id = setInterval(() => {
      socketRef.current.sendInput({ joystick: joystickRef.current });
    }, INPUT_SEND_MS);
    return () => clearInterval(id);
  }, [snapshot?.state, paused]);

  // decay kill-feed lifetimes on a light interval (purely cosmetic)
  useEffect(() => {
    const id = setInterval(() => {
      if (feedRef.current.length === 0) return;
      feedRef.current = feedRef.current.map((f) => ({ ...f, life: f.life - 0.1 })).filter((f) => f.life > 0);
      setFeedTick((t) => (t + 1) % 1000000);
    }, 100);
    return () => clearInterval(id);
  }, []);

  // ---- rewards refresh once the match ends ----
  useEffect(() => {
    if (snapshot?.state === "finished" && !finishHandledRef.current) {
      finishHandledRef.current = true;
      setTimeout(() => { refresh(); }, 1200);
    }
  }, [snapshot?.state, refresh]);

  // ---- joystick ----
  const joyBaseX = 80;
  const joyBaseY = WIN.height - 110;
  const joyPan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderMove: (_, g) => {
        const max = 44;
        const dist = Math.hypot(g.dx, g.dy);
        const k = dist > max ? max / dist : 1;
        const knob = { x: g.dx * k, y: g.dy * k };
        setJoyKnob(knob);
        joystickRef.current = { x: knob.x / max, y: knob.y / max };
      },
      onPanResponderRelease: () => { setJoyKnob({ x: 0, y: 0 }); joystickRef.current = { x: 0, y: 0 }; },
      onPanResponderTerminate: () => { setJoyKnob({ x: 0, y: 0 }); joystickRef.current = { x: 0, y: 0 }; },
    }),
  ).current;

  const arenaTapPan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderGrant: (evt) => {
        const sx = evt.nativeEvent.locationX;
        const sy = evt.nativeEvent.locationY;
        const lx = (sx - offsetX) / scale;
        const ly = (sy - offsetY) / scale;
        socketRef.current.sendInput({ fire: { x: lx, y: ly } });
      },
    }),
  ).current;

  const triggerAbility = () => socketRef.current.sendInput({ ability: true });

  const leaveMatch = async () => {
    socketRef.current.close();
    if (player && code) { try { await api.leaveRoom(code, player.id); } catch { /* ignore */ } }
    router.replace("/coop-lobby");
  };

  const me = useMemo(() => snapshot?.players.find((p) => p.id === player?.id), [snapshot, player?.id]);
  const weaponObj = useMemo(() => config?.weapons.find((w) => w.id === me?.weapon_id), [config, me?.weapon_id]);
  const mapObj = useMemo(
    () => config?.maps.find((m) => m.id === (snapshot?.map_id || lobbyMsg?.map_id)),
    [config, snapshot?.map_id, lobbyMsg?.map_id],
  );

  if (!player || !config || !code) return null;

  // Once the match has ever left "waiting", trust the (continuously ticking)
  // snapshot exclusively — lobbyMsg only updates on join/leave/(dis)connect
  // and can otherwise go stale.
  const state = snapshot && snapshot.state !== "waiting" ? snapshot.state : (lobbyMsg?.state ?? snapshot?.state ?? "waiting");

  // ---------- Waiting room ----------
  if (state === "waiting") {
    const roster = lobbyMsg?.players ?? snapshot?.players ?? [];
    const hostId = lobbyMsg?.host_id ?? snapshot?.host_id;
    const maxPlayers = lobbyMsg?.max_players ?? snapshot?.max_players ?? 4;
    const isHost = hostId === player.id;
    const startMatch = async () => {
      try { await api.startRoom(code, player.id); } catch { /* server will reject via REST error; ignore for MVP */ }
    };
    return (
      <View style={[styles.root, { backgroundColor: mapObj?.bg || COLORS.bg }]}>
        <SafeAreaView style={{ flex: 1, padding: 20 }} edges={["top", "bottom"]}>
          <View style={styles.waitHeader}>
            <TouchableOpacity onPress={leaveMatch} style={styles.back} testID="coop-leave-btn">
              <FontAwesome5 name="chevron-left" size={16} color={COLORS.gold} />
            </TouchableOpacity>
            <Text style={styles.waitTitle}>SQUAD LOBBY</Text>
            <View style={{ width: 40 }} />
          </View>

          <View style={styles.codeBox}>
            <Text style={styles.codeLbl}>ROOM CODE</Text>
            <Text style={styles.codeVal} testID="coop-room-code">{code}</Text>
            <Text style={styles.codeHint}>Share this code so allies can join</Text>
          </View>

          <Text style={styles.section}>WARRIORS ({roster.length}/{maxPlayers})</Text>
          {roster.map((p: any) => (
            <View key={p.id} style={styles.playerRow} testID={`coop-lobby-player-${p.id}`}>
              <View style={[styles.playerDot, { backgroundColor: config.heroes.find((h) => h.id === p.hero_id)?.color || COLORS.primary }]} />
              <Text style={styles.playerName}>{p.name}{p.id === player.id ? " (you)" : ""}</Text>
              {p.id === hostId && <FontAwesome5 name="crown" size={12} color={COLORS.gold} />}
              {p.connected === false && <Text style={styles.disconnTxt}>away</Text>}
            </View>
          ))}

          <View style={{ flex: 1 }} />

          {isHost ? (
            <TouchableOpacity style={styles.startBtn} onPress={startMatch} testID="coop-start-btn">
              <FontAwesome5 name="khanda" size={18} color="#fff" />
              <Text style={styles.startTxt}>START MATCH</Text>
            </TouchableOpacity>
          ) : (
            <Text style={styles.waitingHint}>Waiting for the host to start the match…</Text>
          )}
        </SafeAreaView>
      </View>
    );
  }

  // ---------- Countdown / Playing / Finished ----------
  if (!snapshot) {
    return (
      <View style={styles.root}>
        <SafeAreaView style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <Text style={styles.waitingHint}>{connError ? "Connecting…" : "Loading battle…"}</Text>
        </SafeAreaView>
      </View>
    );
  }

  const bg = mapObj?.bg || "#1A1A2E";
  const hpPct = me ? Math.max(0, (me.hp / me.max_hp) * 100) : 0;
  const abilityReady = me?.ability_ready ?? true;

  return (
    <View style={[styles.root, { backgroundColor: bg }]}>
      <View
        style={[styles.arena, { top: arenaTop, height: arenaH, backgroundColor: bg }]}
        {...(state === "playing" ? arenaTapPan.panHandlers : {})}
        testID="coop-arena"
      >
        {/* Drops */}
        {snapshot.drops.map((d) => {
          const { sx, sy } = toScreen(d.x, d.y);
          return (
            <View key={d.id} style={{ position: "absolute", left: sx - 14, top: sy - 14 }}>
              <View style={[styles.drop, { backgroundColor: d.kind === "hp" ? "rgba(76, 175, 80, 0.25)" : "rgba(255, 215, 0, 0.25)", borderColor: d.kind === "hp" ? COLORS.success : COLORS.gold }]}>
                <FontAwesome5 name={d.kind === "hp" ? "heart" : "coins"} size={12} color={d.kind === "hp" ? COLORS.success : COLORS.gold} />
              </View>
            </View>
          );
        })}

        {/* Bullets */}
        {snapshot.bullets.map((b) => {
          const { sx, sy } = toScreen(b.x, b.y);
          return <View key={b.id} style={{ position: "absolute", left: sx - 5, top: sy - 5, width: 10, height: 10, borderRadius: 5, backgroundColor: b.color }} />;
        })}

        {/* Enemies */}
        {snapshot.enemies.map((e) => {
          const { sx, sy } = toScreen(e.x, e.y);
          const r = e.radius * scale;
          return (
            <View key={e.id} style={{ position: "absolute", left: sx - r, top: sy - r }}>
              <View style={{ width: r * 2, height: r * 2, borderRadius: r, backgroundColor: e.color, borderWidth: 2, borderColor: "#000", alignItems: "center", justifyContent: "center" }}>
                <FontAwesome5 name={e.kind === "brute" ? "khanda" : e.kind === "swift" ? "wind" : "skull"} size={Math.max(6, r - 4)} color="#fff" />
              </View>
              <View style={{ width: r * 2, height: 3, marginTop: 2, backgroundColor: "rgba(0,0,0,0.6)" }}>
                <View style={{ width: `${Math.max(0, (e.hp / e.max_hp) * 100)}%`, height: "100%", backgroundColor: COLORS.danger }} />
              </View>
            </View>
          );
        })}

        {/* Players */}
        {snapshot.players.map((p) => {
          const { sx, sy } = toScreen(p.x, p.y);
          const heroInfo = config.heroes.find((h) => h.id === p.hero_id);
          const isMe = p.id === player.id;
          return (
            <View key={p.id} style={{ position: "absolute", left: sx - 22, top: sy - 22, alignItems: "center" }}>
              <Text style={[styles.tagName, { color: isMe ? COLORS.gold : COLORS.text }]}>{isMe ? "YOU" : p.name}</Text>
              <View style={{ width: 44, height: 3, marginBottom: 2, backgroundColor: "rgba(0,0,0,0.6)" }}>
                <View style={{ width: `${Math.max(0, (p.hp / p.max_hp) * 100)}%`, height: "100%", backgroundColor: p.alive ? COLORS.success : COLORS.danger }} />
              </View>
              <View
                style={[
                  styles.playerAvatar,
                  { backgroundColor: heroInfo?.color || COLORS.primary, opacity: !p.alive ? 0.25 : p.invuln ? 0.5 : 1, borderColor: isMe ? COLORS.gold : "rgba(255,255,255,0.5)" },
                ]}
              >
                <Text style={styles.playerLtr}>{heroInfo?.letter || "?"}</Text>
              </View>
            </View>
          );
        })}

        {/* Kill feed */}
        <View style={styles.killFeed} pointerEvents="none">
          {feedRef.current.slice(-4).map((k) => (
            <Text key={k.id} style={[styles.killFeedTxt, { opacity: Math.min(1, k.life) }]}>{k.text}</Text>
          ))}
        </View>

        {state === "countdown" && (
          <View style={styles.countdownOverlay} pointerEvents="none">
            <Text style={styles.countdownTxt}>{snapshot.countdown > 0 ? snapshot.countdown : "GO!"}</Text>
          </View>
        )}
      </View>

      {/* TOP HUD */}
      <SafeAreaView edges={["top"]} style={styles.hudTop} pointerEvents="box-none">
        <View style={styles.hudRow}>
          <View style={styles.hpBox} testID="coop-hp">
            <Text style={styles.hpLbl}>HP</Text>
            <View style={styles.hpBar}>
              <View style={[styles.hpFill, { width: `${hpPct}%` }]} />
            </View>
          </View>
          <View style={styles.center}>
            <Text style={styles.waveTxt} testID="coop-wave">WAVE {snapshot.wave}/{snapshot.total_waves}</Text>
            <Text style={styles.timeTxt}>{Math.floor(snapshot.elapsed)}s</Text>
          </View>
          <View style={styles.rightBox}>
            <View style={styles.killBox} testID="coop-kills">
              <FontAwesome5 name="skull-crossbones" size={12} color={COLORS.danger} />
              <Text style={styles.killTxt}>{me?.kills ?? 0}</Text>
            </View>
            <TouchableOpacity style={styles.pause} onPress={() => setPaused((p) => !p)} testID="coop-pause-btn">
              <FontAwesome5 name={paused ? "play" : "pause"} size={12} color={COLORS.text} />
            </TouchableOpacity>
          </View>
        </View>
        {/* Squad status strip */}
        <View style={styles.squadRow}>
          {snapshot.players.filter((p) => p.id !== player.id).map((p) => (
            <View key={p.id} style={styles.squadChip} testID={`coop-ally-${p.id}`}>
              <View style={[styles.squadDot, { backgroundColor: config.heroes.find((h) => h.id === p.hero_id)?.color || COLORS.primary, opacity: p.connected ? 1 : 0.3 }]} />
              <Text style={styles.squadName}>{p.name}</Text>
              <View style={styles.squadHpBar}>
                <View style={[styles.squadHpFill, { width: `${Math.max(0, (p.hp / p.max_hp) * 100)}%`, backgroundColor: p.alive ? COLORS.success : COLORS.danger }]} />
              </View>
            </View>
          ))}
        </View>
      </SafeAreaView>

      {state === "playing" && (
        <>
          <View style={[styles.joyBase, { left: joyBaseX - 60, top: joyBaseY - 60 }]} {...joyPan.panHandlers} testID="coop-joystick">
            <View style={[styles.joyKnob, { transform: [{ translateX: joyKnob.x }, { translateY: joyKnob.y }] }]} />
          </View>

          <TouchableOpacity
            style={[styles.abilityBtn, { right: 30, top: joyBaseY - 90, opacity: abilityReady ? 1 : 0.5, borderColor: abilityReady ? COLORS.gold : COLORS.border }]}
            onPress={triggerAbility}
            disabled={!abilityReady}
            testID="coop-ability-btn"
          >
            <FontAwesome5 name={me?.hero_id === "bhima" ? "hammer" : me?.hero_id === "hanuman" ? "wind" : me?.hero_id === "karna" ? "sun" : "bolt"} size={22} color={abilityReady ? COLORS.gold : COLORS.textDim} />
            {!abilityReady && <Text style={styles.abilityCd}>{Math.ceil(me?.ability_cd || 0)}s</Text>}
          </TouchableOpacity>

          <View style={[styles.fireBox, { right: 40, top: joyBaseY - 20 }]}>
            <View style={[styles.fireCircle, { borderColor: weaponObj?.color || COLORS.gold }]}>
              <FontAwesome5 name="fire" size={18} color={weaponObj?.color || COLORS.gold} />
            </View>
            <Text style={styles.fireLbl}>{weaponObj?.name || ""}</Text>
          </View>
        </>
      )}

      {paused && state === "playing" && (
        <View style={styles.pauseOverlay}>
          <Text style={styles.pauseTitle}>PAUSED</Text>
          <Text style={styles.pauseHint}>The battle continues for your squad while paused.</Text>
          <TouchableOpacity style={styles.pauseBtn} onPress={() => setPaused(false)} testID="coop-resume-btn">
            <Text style={styles.pauseBtnTxt}>RESUME</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.pauseBtn, { backgroundColor: COLORS.secondary }]} onPress={leaveMatch} testID="coop-quit-btn">
            <Text style={styles.pauseBtnTxt}>LEAVE SQUAD</Text>
          </TouchableOpacity>
        </View>
      )}

      {state === "finished" && (
        <View style={styles.pauseOverlay}>
          <Text style={[styles.pauseTitle, { color: snapshot.victory ? COLORS.gold : COLORS.danger }]}>
            {snapshot.victory ? "VICTORY" : "DEFEAT"}
          </Text>
          <View style={styles.resultsCard}>
            {snapshot.players.map((p) => (
              <View key={p.id} style={styles.resultRow} testID={`coop-result-${p.id}`}>
                <Text style={styles.resultName}>{p.name}{p.id === player.id ? " (you)" : ""}</Text>
                <Text style={styles.resultKills}>{p.kills} kills</Text>
              </View>
            ))}
          </View>
          <TouchableOpacity style={styles.pauseBtn} onPress={() => router.replace("/lobby")} testID="coop-continue-btn">
            <Text style={styles.pauseBtnTxt}>CONTINUE</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#1A1A2E" },
  arena: { position: "absolute", left: 0, right: 0, overflow: "hidden" },
  playerAvatar: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", borderWidth: 3, shadowColor: COLORS.gold, shadowOpacity: 0.6, shadowRadius: 10, elevation: 8 },
  playerLtr: { color: "#fff", fontSize: 20, fontFamily: "Cinzel-Black" },
  tagName: { fontSize: 10, fontFamily: "Exo2-Bold", marginBottom: 2, backgroundColor: "rgba(0,0,0,0.4)", paddingHorizontal: 4, borderRadius: 3 },
  drop: { width: 24, height: 24, borderRadius: 12, borderWidth: 2, alignItems: "center", justifyContent: "center" },
  killFeed: { position: "absolute", top: 20, right: 20, alignItems: "flex-end", gap: 4 },
  killFeedTxt: { color: COLORS.gold, fontSize: 12, fontFamily: "Exo2-Bold", letterSpacing: 1, backgroundColor: "rgba(0,0,0,0.5)", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 4 },
  countdownOverlay: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center" },
  countdownTxt: { color: COLORS.gold, fontSize: 90, fontFamily: "Cinzel-Black", textShadowColor: "rgba(255,140,0,0.8)", textShadowRadius: 24 },
  hudTop: { position: "absolute", left: 0, right: 0, top: 0 },
  hudRow: { flexDirection: "row", paddingHorizontal: 16, paddingVertical: 10, gap: 12, alignItems: "center" },
  hpBox: { flex: 1 },
  hpLbl: { ...FONTS.small, color: COLORS.danger, marginBottom: 4 },
  hpBar: { height: 14, backgroundColor: "rgba(0,0,0,0.5)", borderRadius: 7, borderWidth: 1, borderColor: COLORS.border, overflow: "hidden" },
  hpFill: { height: "100%", backgroundColor: COLORS.danger },
  center: { alignItems: "center" },
  waveTxt: { color: COLORS.gold, fontFamily: "Cinzel-Bold", fontSize: 14, letterSpacing: 1 },
  timeTxt: { color: COLORS.textDim, fontSize: 11, marginTop: 2 },
  rightBox: { flex: 1, flexDirection: "row", justifyContent: "flex-end", alignItems: "center", gap: 8 },
  killBox: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "rgba(0,0,0,0.5)", paddingHorizontal: 10, paddingVertical: 6, borderRadius: 12, borderWidth: 1, borderColor: COLORS.border },
  killTxt: { color: COLORS.text, fontFamily: "Exo2-Bold", fontSize: 13 },
  pause: { width: 34, height: 34, borderRadius: 17, backgroundColor: COLORS.secondary, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: COLORS.primary },
  squadRow: { flexDirection: "row", paddingHorizontal: 16, gap: 8, flexWrap: "wrap" },
  squadChip: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "rgba(0,0,0,0.4)", borderRadius: 10, paddingHorizontal: 8, paddingVertical: 4 },
  squadDot: { width: 8, height: 8, borderRadius: 4 },
  squadName: { color: COLORS.textDim, fontSize: 10, fontFamily: "Exo2-Bold" },
  squadHpBar: { width: 34, height: 4, borderRadius: 2, backgroundColor: "rgba(255,255,255,0.15)", overflow: "hidden" },
  squadHpFill: { height: "100%" },
  joyBase: { position: "absolute", width: 120, height: 120, borderRadius: 60, backgroundColor: "rgba(26, 26, 46, 0.55)", borderWidth: 2, borderColor: "rgba(255, 215, 0, 0.35)", alignItems: "center", justifyContent: "center" },
  joyKnob: { width: 48, height: 48, borderRadius: 24, backgroundColor: "rgba(255, 140, 0, 0.85)", borderWidth: 2, borderColor: COLORS.gold },
  abilityBtn: { position: "absolute", width: 68, height: 68, borderRadius: 34, borderWidth: 3, backgroundColor: "rgba(255, 87, 34, 0.2)", alignItems: "center", justifyContent: "center" },
  abilityCd: { position: "absolute", bottom: -18, color: COLORS.textDim, fontSize: 10, fontFamily: "Exo2-Bold" },
  fireBox: { position: "absolute", alignItems: "center" },
  fireCircle: { width: 56, height: 56, borderRadius: 28, borderWidth: 2, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255, 87, 34, 0.15)" },
  fireLbl: { color: COLORS.gold, fontSize: 9, fontFamily: "Exo2-Bold", letterSpacing: 1, marginTop: 4 },
  pauseOverlay: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.9)", alignItems: "center", justifyContent: "center", gap: 16, padding: 24 },
  pauseTitle: { color: COLORS.gold, fontSize: 44, fontFamily: "Cinzel-Black", letterSpacing: 6, marginBottom: 4 },
  pauseHint: { color: COLORS.textDim, fontSize: 12, textAlign: "center", marginBottom: 8 },
  pauseBtn: { paddingHorizontal: 40, paddingVertical: 14, borderRadius: 24, backgroundColor: COLORS.primary, borderWidth: 2, borderColor: COLORS.gold, minWidth: 220, alignItems: "center" },
  pauseBtnTxt: { color: "#fff", fontFamily: "Cinzel-Bold", letterSpacing: 2 },
  resultsCard: { width: "100%", maxWidth: 320, backgroundColor: COLORS.bg2, borderRadius: 14, padding: 16, borderWidth: 1, borderColor: COLORS.border, gap: 10 },
  resultRow: { flexDirection: "row", justifyContent: "space-between" },
  resultName: { color: COLORS.text, fontFamily: "Exo2-Bold", fontSize: 14 },
  resultKills: { color: COLORS.gold, fontFamily: "Exo2-Bold", fontSize: 14 },
  waitHeader: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 20 },
  back: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: COLORS.bg2, borderWidth: 1, borderColor: COLORS.border },
  waitTitle: { ...FONTS.h3, flex: 1, textAlign: "center", color: COLORS.gold },
  codeBox: { alignItems: "center", backgroundColor: COLORS.bg2, borderRadius: 16, padding: 20, borderWidth: 1, borderColor: COLORS.gold, marginBottom: 24 },
  codeLbl: { ...FONTS.small, color: COLORS.textDim },
  codeVal: { color: COLORS.gold, fontSize: 42, fontFamily: "Cinzel-Black", letterSpacing: 8, marginTop: 6 },
  codeHint: { color: COLORS.textDim, fontSize: 11, marginTop: 6, fontStyle: "italic" },
  section: { ...FONTS.small, marginBottom: 12, color: COLORS.textDim },
  playerRow: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: COLORS.bg2, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: COLORS.border, marginBottom: 8 },
  playerDot: { width: 14, height: 14, borderRadius: 7 },
  playerName: { color: COLORS.text, fontFamily: "Exo2-Bold", fontSize: 14, flex: 1 },
  disconnTxt: { color: COLORS.textDim, fontSize: 10, fontStyle: "italic" },
  startBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, backgroundColor: COLORS.primary, borderRadius: 28, paddingVertical: 16, borderWidth: 2, borderColor: COLORS.gold },
  startTxt: { color: "#fff", fontFamily: "Cinzel-Bold", fontSize: 16, letterSpacing: 1.5 },
  waitingHint: { color: COLORS.textDim, fontSize: 13, textAlign: "center", fontStyle: "italic" },
});
