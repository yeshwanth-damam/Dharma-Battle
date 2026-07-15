import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { View, Text, StyleSheet, TouchableOpacity, Dimensions, PanResponder, ActivityIndicator } from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { FontAwesome5 } from "@expo/vector-icons";

import { COLORS, FONTS } from "@/src/game/theme";
import { useStore } from "@/src/game/store";
import { soundService } from "@/src/game/sound";
import { RealtimeClient, StateMsg, WelcomeMsg, NetEvent } from "@/src/game/realtime";

const WIN = Dimensions.get("window");
const HUD_TOP = 90;
const HUD_BOTTOM = 190;
const INPUT_HZ = 20;

type FeedItem = { id: number; text: string; expiry: number };

function eventToText(ev: NetEvent, selfId: string): string | null {
  switch (ev.kind) {
    case "kill":
      return `+1 ${(String(ev.etype || "")).toUpperCase()}`;
    case "wave":
      return `WAVE ${ev.wave}`;
    case "ability":
      return `${String(ev.hero || "").toUpperCase()} SKILL!`;
    case "down":
      return ev.id === selfId ? "YOU ARE DOWN!" : `${ev.name} DOWN!`;
    case "player_join":
      return `${ev.name} JOINED`;
    case "player_leave":
      return `${ev.name} LEFT`;
    case "pickup":
      return ev.id === selfId ? (ev.drop === "hp" ? "+25% HP" : "+5 COINS") : null;
    default:
      return null;
  }
}

export default function Coop() {
  const router = useRouter();
  const { player, config, selectedMap } = useStore();

  const heroObj = useMemo(() => config?.heroes.find((h) => h.id === player?.selected_hero), [config, player]);
  const weaponObj = useMemo(() => config?.weapons.find((w) => w.id === player?.selected_weapon), [config, player]);

  const arenaTop = HUD_TOP;
  const arenaBottom = WIN.height - HUD_BOTTOM;
  const arenaW = WIN.width;
  const arenaH = arenaBottom - arenaTop;

  const [status, setStatus] = useState<"connecting" | "playing" | "error" | "closed">("connecting");
  const [errorMsg, setErrorMsg] = useState<string>("");
  const [welcome, setWelcome] = useState<WelcomeMsg | null>(null);
  const [snap, setSnap] = useState<StateMsg | null>(null);

  const clientRef = useRef<RealtimeClient | null>(null);
  const joystickRef = useRef({ x: 0, y: 0 });
  const abilityPendingRef = useRef(false);
  const selfIdRef = useRef<string>("");
  const finishedRef = useRef(false);
  const feedRef = useRef<FeedItem[]>([]);
  const feedIdRef = useRef(1);

  const [joyKnob, setJoyKnob] = useState({ x: 0, y: 0 });
  const joyBaseX = 80;
  const joyBaseY = WIN.height - 110;

  const scaleX = welcome ? arenaW / welcome.arena.w : 1;
  const scaleY = welcome ? arenaH / welcome.arena.h : 1;
  const avgScale = (scaleX + scaleY) / 2;

  const finish = useCallback(
    async (victory: boolean) => {
      if (finishedRef.current) return;
      finishedRef.current = true;
      soundService.play(victory ? "victory" : "defeat");
      const self = snap?.players.find((p) => p.id === selfIdRef.current);
      const kills = self?.kills ?? 0;
      const seconds = Math.floor(snap?.elapsed ?? 0);
      // Rewards are already persisted authoritatively by the server; results
      // screen refreshes the player from the API.
      router.replace({
        pathname: "/results",
        params: {
          victory: victory ? "1" : "0",
          kills: String(kills),
          seconds: String(seconds),
          bonusCoins: "0",
          newCoins: String(player?.coins ?? 0),
          newLevel: String(player?.level ?? 1),
          newXp: String(player?.xp ?? 0),
        },
      });
    },
    [router, snap, player],
  );

  // Establish the connection once we have loadout info.
  useEffect(() => {
    if (!player || !heroObj || !weaponObj) return;
    const client = new RealtimeClient(
      {
        name: player.name,
        hero: player.selected_hero,
        weapon: player.selected_weapon,
        map: selectedMap,
        player_id: player.id,
      },
      {
        onWelcome: (w) => {
          setWelcome(w);
          selfIdRef.current = w.self_id;
          setStatus("playing");
        },
        onState: (s) => {
          // append kill-feed events
          if (s.events?.length) {
            const now = Date.now();
            for (const ev of s.events) {
              const text = eventToText(ev, selfIdRef.current);
              if (text) feedRef.current.push({ id: feedIdRef.current++, text, expiry: now + 2500 });
            }
            if (feedRef.current.length > 30) feedRef.current = feedRef.current.slice(-30);
          }
          setSnap(s);
          if (s.status === "victory") finish(true);
          else if (s.status === "defeat") finish(false);
        },
        onError: (m) => {
          setErrorMsg(m);
          setStatus("error");
        },
        onClose: () => {
          if (!finishedRef.current) setStatus("closed");
        },
      },
    );
    clientRef.current = client;
    client.connect();

    const interval = setInterval(() => {
      const ability = abilityPendingRef.current;
      abilityPendingRef.current = false;
      client.sendInput(joystickRef.current, { fire: true, ability });
    }, 1000 / INPUT_HZ);

    return () => {
      clearInterval(interval);
      client.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [player?.id, heroObj?.id, weaponObj?.id, selectedMap]);

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
      onPanResponderRelease: () => {
        setJoyKnob({ x: 0, y: 0 });
        joystickRef.current = { x: 0, y: 0 };
      },
      onPanResponderTerminate: () => {
        setJoyKnob({ x: 0, y: 0 });
        joystickRef.current = { x: 0, y: 0 };
      },
    }),
  ).current;

  const triggerAbility = () => {
    abilityPendingRef.current = true;
  };

  const quit = () => {
    finishedRef.current = true;
    clientRef.current?.close();
    router.replace("/lobby");
  };

  if (!player || !heroObj || !weaponObj) return null;

  if (status === "connecting") {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={COLORS.gold} />
        <Text style={styles.connectingTxt}>FINDING WARRIORS…</Text>
      </View>
    );
  }

  if (status === "error" || status === "closed") {
    return (
      <View style={styles.center}>
        <FontAwesome5 name="wifi" size={40} color={COLORS.danger} />
        <Text style={styles.errTitle}>{status === "error" ? "CONNECTION FAILED" : "DISCONNECTED"}</Text>
        {!!errorMsg && <Text style={styles.errMsg}>{errorMsg}</Text>}
        <TouchableOpacity style={styles.retryBtn} onPress={() => router.replace("/lobby")} testID="coop-back-btn">
          <Text style={styles.retryTxt}>BACK TO LOBBY</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const bg = welcome?.map_bg || "#1A1A2E";
  const self = snap?.players.find((p) => p.id === selfIdRef.current);
  const hpPct = self ? Math.max(0, (self.hp / self.maxHp) * 100) : 0;
  const abilityReady = (self?.abilityCd ?? 1) <= 0;
  const now = Date.now();
  const feed = feedRef.current.filter((f) => f.expiry > now).slice(-4);
  const alivePlayers = snap?.players.filter((p) => p.connected).length ?? 1;

  const sx = (x: number) => x * scaleX;
  const sy = (y: number) => y * scaleY;

  return (
    <View style={[styles.root, { backgroundColor: bg }]}>
      <View style={[styles.arena, { top: arenaTop, height: arenaH, backgroundColor: bg }]} testID="coop-arena">
        {Array.from({ length: 8 }).map((_, i) => (
          <View key={`h${i}`} style={[styles.gridLine, { top: (arenaH / 8) * i, width: arenaW, height: 1 }]} />
        ))}
        {Array.from({ length: 8 }).map((_, i) => (
          <View key={`v${i}`} style={[styles.gridLine, { left: (arenaW / 8) * i, width: 1, height: arenaH }]} />
        ))}

        {/* Drops */}
        {snap?.drops.map((d) => (
          <View key={`d${d.id}`} style={{ position: "absolute", left: sx(d.x) - 14, top: sy(d.y) - 14 }}>
            <View style={[styles.drop, { backgroundColor: d.kind === "hp" ? "rgba(76, 175, 80, 0.25)" : "rgba(255, 215, 0, 0.25)", borderColor: d.kind === "hp" ? COLORS.success : COLORS.gold }]}>
              <FontAwesome5 name={d.kind === "hp" ? "heart" : "coins"} size={14} color={d.kind === "hp" ? COLORS.success : COLORS.gold} />
            </View>
          </View>
        ))}

        {/* Bullets */}
        {snap?.bullets.map((b) => (
          <View key={`b${b.id}`} style={{ position: "absolute", left: sx(b.x) - 5, top: sy(b.y) - 5, width: 10, height: 10, borderRadius: 5, backgroundColor: b.color, shadowColor: b.color, shadowOpacity: 1, shadowRadius: 8, elevation: 6 }} />
        ))}

        {/* Enemies */}
        {snap?.enemies.map((e) => {
          const r = Math.max(10, e.r * avgScale);
          return (
            <View key={`e${e.id}`} style={{ position: "absolute", left: sx(e.x) - r, top: sy(e.y) - r }}>
              <View style={{ width: r * 2, height: r * 2, borderRadius: r, backgroundColor: e.color, borderWidth: 2, borderColor: "#000", alignItems: "center", justifyContent: "center" }}>
                <FontAwesome5 name={e.type === "brute" ? "khanda" : e.type === "swift" ? "wind" : "skull"} size={Math.max(8, r - 4)} color="#fff" />
              </View>
              <View style={{ width: r * 2, height: 3, marginTop: 2, backgroundColor: "rgba(0,0,0,0.6)" }}>
                <View style={{ width: `${Math.max(0, (e.hp / e.maxHp) * 100)}%`, height: "100%", backgroundColor: COLORS.danger }} />
              </View>
            </View>
          );
        })}

        {/* Players (self + allies) */}
        {snap?.players.map((p) => {
          const isSelf = p.id === selfIdRef.current;
          if (!p.connected) return null;
          return (
            <View key={`p${p.id}`} style={{ position: "absolute", left: sx(p.x) - 22, top: sy(p.y) - 30, alignItems: "center" }}>
              <Text style={[styles.nameTag, { color: isSelf ? COLORS.gold : COLORS.text }]} numberOfLines={1}>
                {isSelf ? "YOU" : p.name}
              </Text>
              <View
                style={[
                  styles.playerAvatar,
                  {
                    backgroundColor: p.color,
                    opacity: !p.alive ? 0.3 : p.invuln > 0 ? 0.5 : 1,
                    borderColor: isSelf ? COLORS.gold : COLORS.text,
                  },
                ]}
              >
                <Text style={styles.playerLtr}>{p.letter}</Text>
              </View>
              {/* ally hp bar */}
              <View style={styles.allyHpBar}>
                <View style={{ width: `${Math.max(0, (p.hp / p.maxHp) * 100)}%`, height: "100%", backgroundColor: p.alive ? COLORS.success : COLORS.danger }} />
              </View>
            </View>
          );
        })}

        {/* Kill feed */}
        <View style={styles.killFeed} pointerEvents="none">
          {feed.map((k) => (
            <Text key={k.id} style={styles.killFeedTxt}>{k.text}</Text>
          ))}
        </View>
      </View>

      {/* TOP HUD */}
      <SafeAreaView edges={["top"]} style={styles.hudTop} pointerEvents="box-none">
        <View style={styles.hudRow}>
          <View style={styles.hpBox} testID="coop-hp">
            <Text style={styles.hpLbl}>{self?.alive ? "HP" : "DOWNED"}</Text>
            <View style={styles.hpBar}>
              <View style={[styles.hpFill, { width: `${hpPct}%` }]} />
            </View>
          </View>
          <View style={styles.centerBox}>
            <Text style={styles.waveTxt} testID="coop-wave">WAVE {snap?.wave ?? 1}/{welcome?.total_waves ?? snap?.totalWaves ?? 1}</Text>
            <Text style={styles.timeTxt}>{Math.floor(snap?.elapsed ?? 0)}s</Text>
          </View>
          <View style={styles.rightBox}>
            <View style={styles.pill} testID="coop-players">
              <FontAwesome5 name="users" size={12} color={COLORS.gold} />
              <Text style={styles.pillTxt}>{alivePlayers}/{welcome?.max_players ?? 4}</Text>
            </View>
            <View style={styles.pill} testID="coop-kills">
              <FontAwesome5 name="skull-crossbones" size={12} color={COLORS.danger} />
              <Text style={styles.pillTxt}>{self?.kills ?? 0}</Text>
            </View>
            <TouchableOpacity style={styles.quitBtn} onPress={quit} testID="coop-quit-btn">
              <FontAwesome5 name="sign-out-alt" size={12} color={COLORS.text} />
            </TouchableOpacity>
          </View>
        </View>
      </SafeAreaView>

      {/* Joystick */}
      <View style={[styles.joyBase, { left: joyBaseX - 60, top: joyBaseY - 60 }]} {...joyPan.panHandlers} testID="coop-joystick">
        <View style={[styles.joyKnob, { transform: [{ translateX: joyKnob.x }, { translateY: joyKnob.y }] }]} />
      </View>

      {/* Ability */}
      <TouchableOpacity
        style={[styles.abilityBtn, { right: 30, top: joyBaseY - 90, opacity: abilityReady ? 1 : 0.5, borderColor: abilityReady ? COLORS.gold : COLORS.border }]}
        onPress={triggerAbility}
        disabled={!abilityReady}
        testID="coop-ability-btn"
      >
        <FontAwesome5 name={heroObj.id === "bhima" ? "hammer" : heroObj.id === "hanuman" ? "wind" : heroObj.id === "karna" ? "sun" : "bolt"} size={22} color={abilityReady ? COLORS.gold : COLORS.textDim} />
        {!abilityReady && <Text style={styles.abilityCd}>{Math.ceil(self?.abilityCd ?? 0)}s</Text>}
      </TouchableOpacity>

      {/* Weapon label */}
      <View style={[styles.fireBox, { right: 40, top: joyBaseY - 20 }]}>
        <View style={[styles.fireCircle, { borderColor: weaponObj.color }]}>
          <FontAwesome5 name="fire" size={18} color={weaponObj.color} />
        </View>
        <Text style={styles.fireLbl}>{weaponObj.name}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#1A1A2E" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: COLORS.bg, gap: 16, padding: 24 },
  connectingTxt: { color: COLORS.gold, fontFamily: "Cinzel-Bold", letterSpacing: 3, fontSize: 16 },
  errTitle: { color: COLORS.danger, fontFamily: "Cinzel-Black", letterSpacing: 3, fontSize: 22 },
  errMsg: { color: COLORS.textDim, fontSize: 13, textAlign: "center" },
  retryBtn: { marginTop: 12, paddingHorizontal: 30, paddingVertical: 14, borderRadius: 24, backgroundColor: COLORS.primary, borderWidth: 2, borderColor: COLORS.gold },
  retryTxt: { color: "#fff", fontFamily: "Cinzel-Bold", letterSpacing: 2 },
  arena: { position: "absolute", left: 0, right: 0, overflow: "hidden" },
  gridLine: { position: "absolute", backgroundColor: "rgba(255,255,255,0.03)" },
  playerAvatar: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", borderWidth: 3, shadowColor: COLORS.gold, shadowOpacity: 0.8, shadowRadius: 12, elevation: 10 },
  playerLtr: { color: "#fff", fontSize: 22, fontFamily: "Cinzel-Black" },
  nameTag: { fontSize: 10, fontFamily: "Exo2-Bold", letterSpacing: 1, marginBottom: 2, maxWidth: 80 },
  allyHpBar: { width: 40, height: 3, marginTop: 3, backgroundColor: "rgba(0,0,0,0.6)", borderRadius: 2, overflow: "hidden" },
  drop: { width: 28, height: 28, borderRadius: 14, borderWidth: 2, alignItems: "center", justifyContent: "center" },
  killFeed: { position: "absolute", top: 20, right: 20, alignItems: "flex-end", gap: 4 },
  killFeedTxt: { color: COLORS.gold, fontSize: 12, fontFamily: "Exo2-Bold", letterSpacing: 1, backgroundColor: "rgba(0,0,0,0.5)", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 4 },
  hudTop: { position: "absolute", left: 0, right: 0, top: 0 },
  hudRow: { flexDirection: "row", paddingHorizontal: 16, paddingVertical: 10, gap: 12, alignItems: "center" },
  hpBox: { flex: 1 },
  hpLbl: { ...FONTS.small, color: COLORS.danger, marginBottom: 4 },
  hpBar: { height: 14, backgroundColor: "rgba(0,0,0,0.5)", borderRadius: 7, borderWidth: 1, borderColor: COLORS.border, overflow: "hidden" },
  hpFill: { height: "100%", backgroundColor: COLORS.danger },
  centerBox: { alignItems: "center" },
  waveTxt: { color: COLORS.gold, fontFamily: "Cinzel-Bold", fontSize: 14, letterSpacing: 1 },
  timeTxt: { color: COLORS.textDim, fontSize: 11, marginTop: 2 },
  rightBox: { flex: 1, flexDirection: "row", justifyContent: "flex-end", alignItems: "center", gap: 8 },
  pill: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "rgba(0,0,0,0.5)", paddingHorizontal: 10, paddingVertical: 6, borderRadius: 12, borderWidth: 1, borderColor: COLORS.border },
  pillTxt: { color: COLORS.text, fontFamily: "Exo2-Bold", fontSize: 13 },
  quitBtn: { width: 34, height: 34, borderRadius: 17, backgroundColor: COLORS.secondary, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: COLORS.primary },
  joyBase: { position: "absolute", width: 120, height: 120, borderRadius: 60, backgroundColor: "rgba(26, 26, 46, 0.55)", borderWidth: 2, borderColor: "rgba(255, 215, 0, 0.35)", alignItems: "center", justifyContent: "center" },
  joyKnob: { width: 48, height: 48, borderRadius: 24, backgroundColor: "rgba(255, 140, 0, 0.85)", borderWidth: 2, borderColor: COLORS.gold },
  abilityBtn: { position: "absolute", width: 68, height: 68, borderRadius: 34, borderWidth: 3, backgroundColor: "rgba(255, 87, 34, 0.2)", alignItems: "center", justifyContent: "center" },
  abilityCd: { position: "absolute", bottom: -18, color: COLORS.textDim, fontSize: 10, fontFamily: "Exo2-Bold" },
  fireBox: { position: "absolute", alignItems: "center" },
  fireCircle: { width: 56, height: 56, borderRadius: 28, borderWidth: 2, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255, 87, 34, 0.15)" },
  fireLbl: { color: COLORS.gold, fontSize: 9, fontFamily: "Exo2-Bold", letterSpacing: 1, marginTop: 4 },
});
