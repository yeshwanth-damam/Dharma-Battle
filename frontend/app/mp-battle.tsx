import React, { useEffect, useMemo, useRef, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, Dimensions, PanResponder } from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { FontAwesome5 } from "@expo/vector-icons";

import { COLORS, FONTS } from "@/src/game/theme";
import { useStore } from "@/src/game/store";
import { GameSnapshot, mpSession } from "@/src/game/multiplayer";

const WIN = Dimensions.get("window");
const HUD_TOP = 90;
const HUD_BOTTOM = 190;

type V = { x: number; y: number };

export default function MpBattle() {
  const router = useRouter();
  const { player, refresh } = useStore();
  const client = mpSession.client;
  const [snap, setSnap] = useState<GameSnapshot | null>(client?.snapshot || null);
  const [ended, setEnded] = useState(false);

  const arenaTop = HUD_TOP;
  const arenaBottom = WIN.height - HUD_BOTTOM;
  const arenaW = WIN.width;
  const arenaH = arenaBottom - arenaTop;

  const joyBaseX = 80;
  const joyBaseY = WIN.height - 110;
  const [joyKnob, setJoyKnob] = useState<V>({ x: 0, y: 0 });

  const scale = useMemo(() => {
    const aw = snap?.arena?.w || 800;
    const ah = snap?.arena?.h || 500;
    return { sx: arenaW / aw, sy: arenaH / ah, aw, ah };
  }, [snap?.arena?.w, snap?.arena?.h, arenaW, arenaH]);

  useEffect(() => {
    if (!client) {
      router.replace("/multiplayer");
      return;
    }
    const off = client.on((msg) => {
      if (msg.type === "snapshot" || msg.type === "match_start") {
        setSnap(msg.type === "match_start" ? (msg as any) : msg);
      }
      if (msg.type === "match_end") {
        setEnded(true);
        setSnap(msg.snapshot);
        refresh().catch(() => undefined);
        setTimeout(() => {
          const me = msg.results?.find((r: any) => r.player_id === player?.id);
          client.disconnect();
          mpSession.client = null;
          router.replace({
            pathname: "/results",
            params: {
              victory: msg.victory ? "1" : "0",
              kills: String(me?.kills ?? 0),
              seconds: String(msg.elapsed ?? 0),
              bonusCoins: "0",
              newCoins: String(player?.coins ?? 0),
              newLevel: String(player?.level ?? 1),
              newXp: String(player?.xp ?? 0),
              mode: "coop",
            },
          });
        }, 1800);
      }
      if (msg.type === "disconnected" && !ended) {
        router.replace("/multiplayer");
      }
    });
    return () => {
      off();
    };
  }, [client, router, player, refresh, ended]);

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
        client?.setMove(knob.x / max, knob.y / max);
      },
      onPanResponderRelease: () => {
        setJoyKnob({ x: 0, y: 0 });
        client?.setMove(0, 0);
      },
      onPanResponderTerminate: () => {
        setJoyKnob({ x: 0, y: 0 });
        client?.setMove(0, 0);
      },
    }),
  ).current;

  const arenaTap = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderGrant: (evt) => {
        const lx = evt.nativeEvent.locationX;
        const ly = evt.nativeEvent.locationY;
        const worldX = lx / (scale.sx || 1);
        const worldY = ly / (scale.sy || 1);
        client?.fireAt(worldX, worldY);
      },
    }),
  ).current;

  if (!player || !client) return null;

  const me = snap?.players.find((p) => p.id === player.id);
  const hpPct = me ? Math.max(0, (me.hp / me.max_hp) * 100) : 100;
  const bg = snap?.arena?.bg || "#1A1A2E";
  const abilityReady = (me?.ability_cd ?? 0) <= 0;

  const toScreen = (x: number, y: number) => ({
    left: x * scale.sx,
    top: y * scale.sy,
  });

  return (
    <View style={[styles.root, { backgroundColor: bg }]}>
      <View
        style={[styles.arena, { top: arenaTop, height: arenaH, backgroundColor: bg }]}
        {...arenaTap.panHandlers}
        testID="mp-battle-arena"
      >
        {Array.from({ length: 8 }).map((_, i) => (
          <View key={`h${i}`} style={[styles.gridLine, { top: (arenaH / 8) * i, width: arenaW, height: 1 }]} />
        ))}
        {Array.from({ length: 8 }).map((_, i) => (
          <View key={`v${i}`} style={[styles.gridLine, { left: (arenaW / 8) * i, width: 1, height: arenaH }]} />
        ))}

        {snap?.drops.map((d) => {
          const pos = toScreen(d.x, d.y);
          return (
            <View key={d.id} style={{ position: "absolute", left: pos.left - 14, top: pos.top - 14 }}>
              <View
                style={[
                  styles.drop,
                  {
                    backgroundColor: d.kind === "hp" ? "rgba(76, 175, 80, 0.25)" : "rgba(255, 215, 0, 0.25)",
                    borderColor: d.kind === "hp" ? COLORS.success : COLORS.gold,
                  },
                ]}
              >
                <FontAwesome5 name={d.kind === "hp" ? "heart" : "coins"} size={14} color={d.kind === "hp" ? COLORS.success : COLORS.gold} />
              </View>
            </View>
          );
        })}

        {snap?.bullets.map((b) => {
          const pos = toScreen(b.x, b.y);
          return (
            <View
              key={b.id}
              style={{
                position: "absolute",
                left: pos.left - 5,
                top: pos.top - 5,
                width: 10,
                height: 10,
                borderRadius: 5,
                backgroundColor: b.color,
              }}
            />
          );
        })}

        {snap?.enemies.map((e) => {
          const pos = toScreen(e.x, e.y);
          const r = e.radius * Math.min(scale.sx, scale.sy);
          return (
            <View key={e.id} style={{ position: "absolute", left: pos.left - r, top: pos.top - r }}>
              <View
                style={{
                  width: r * 2,
                  height: r * 2,
                  borderRadius: r,
                  backgroundColor: e.color,
                  borderWidth: 2,
                  borderColor: "#000",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <FontAwesome5
                  name={e.type === "brute" ? "khanda" : e.type === "swift" ? "wind" : "skull"}
                  size={Math.max(8, r - 4)}
                  color="#fff"
                />
              </View>
            </View>
          );
        })}

        {snap?.players.map((p) => {
          const pos = toScreen(p.x, p.y);
          const mine = p.id === player.id;
          return (
            <View key={p.id} style={{ position: "absolute", left: pos.left - 22, top: pos.top - 22 }}>
              <View
                style={[
                  styles.playerAvatar,
                  {
                    backgroundColor: p.color,
                    opacity: !p.alive ? 0.25 : p.invuln ? 0.5 : 1,
                    borderColor: mine ? COLORS.gold : COLORS.border,
                  },
                ]}
              >
                <Text style={styles.playerLtr}>{p.letter}</Text>
              </View>
              <Text style={[styles.nameTag, mine && { color: COLORS.gold }]} numberOfLines={1}>
                {p.name}
              </Text>
            </View>
          );
        })}

        <View style={styles.killFeed} pointerEvents="none">
          {(snap?.feed || []).slice(-4).map((t, i) => (
            <Text key={`${t}-${i}`} style={styles.killFeedTxt}>
              {t}
            </Text>
          ))}
        </View>
      </View>

      <SafeAreaView edges={["top"]} style={styles.hudTop} pointerEvents="box-none">
        <View style={styles.hudRow}>
          <View style={styles.hpBox} testID="mp-battle-hp">
            <Text style={styles.hpLbl}>HP</Text>
            <View style={styles.hpBar}>
              <View style={[styles.hpFill, { width: `${hpPct}%` }]} />
            </View>
          </View>
          <View style={styles.center}>
            <Text style={styles.waveTxt} testID="mp-battle-wave">
              WAVE {snap?.wave || 1}/{snap?.total_waves || "?"}
            </Text>
            <Text style={styles.timeTxt}>{Math.floor(snap?.elapsed || 0)}s · CO-OP</Text>
          </View>
          <View style={styles.rightBox}>
            <View style={styles.killBox} testID="mp-battle-kills">
              <FontAwesome5 name="skull-crossbones" size={12} color={COLORS.danger} />
              <Text style={styles.killTxt}>{me?.kills ?? 0}</Text>
            </View>
            <TouchableOpacity
              style={styles.pause}
              onPress={() => {
                client.disconnect();
                mpSession.client = null;
                router.replace("/lobby");
              }}
              testID="mp-battle-quit"
            >
              <FontAwesome5 name="times" size={12} color={COLORS.text} />
            </TouchableOpacity>
          </View>
        </View>
        {/* Ally HP strip */}
        <View style={styles.allyRow}>
          {(snap?.players || [])
            .filter((p) => p.id !== player.id)
            .map((p) => (
              <View key={p.id} style={styles.allyChip}>
                <Text style={[styles.allyName, { color: p.color }]}>{p.name}</Text>
                <View style={styles.allyBar}>
                  <View
                    style={[
                      styles.allyFill,
                      { width: `${Math.max(0, (p.hp / p.max_hp) * 100)}%`, backgroundColor: p.alive ? COLORS.success : COLORS.danger },
                    ]}
                  />
                </View>
              </View>
            ))}
        </View>
      </SafeAreaView>

      <View style={[styles.joyBase, { left: joyBaseX - 60, top: joyBaseY - 60 }]} {...joyPan.panHandlers} testID="mp-battle-joystick">
        <View style={[styles.joyKnob, { transform: [{ translateX: joyKnob.x }, { translateY: joyKnob.y }] }]} />
      </View>

      <TouchableOpacity
        style={[
          styles.abilityBtn,
          {
            right: 30,
            top: joyBaseY - 90,
            opacity: abilityReady ? 1 : 0.5,
            borderColor: abilityReady ? COLORS.gold : COLORS.border,
          },
        ]}
        onPress={() => client.useAbility()}
        disabled={!abilityReady || !me?.alive}
        testID="mp-battle-ability"
      >
        <FontAwesome5 name="bolt" size={22} color={abilityReady ? COLORS.gold : COLORS.textDim} />
        {!abilityReady && <Text style={styles.abilityCd}>{Math.ceil(me?.ability_cd || 0)}s</Text>}
      </TouchableOpacity>

      {ended && (
        <View style={styles.endOverlay} pointerEvents="none">
          <Text style={styles.endTitle}>{client.lastMatchEnd?.victory ? "VICTORY" : "DEFEAT"}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#1A1A2E" },
  arena: { position: "absolute", left: 0, right: 0, overflow: "hidden" },
  gridLine: { position: "absolute", backgroundColor: "rgba(255,255,255,0.03)" },
  playerAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 3,
    elevation: 10,
  },
  playerLtr: { color: "#fff", fontSize: 20, fontFamily: "Cinzel-Black" },
  nameTag: {
    position: "absolute",
    top: -16,
    left: -20,
    width: 84,
    textAlign: "center",
    color: COLORS.text,
    fontSize: 10,
    fontFamily: "Exo2-Bold",
  },
  drop: { width: 28, height: 28, borderRadius: 14, borderWidth: 2, alignItems: "center", justifyContent: "center" },
  killFeed: { position: "absolute", top: 20, right: 20, alignItems: "flex-end", gap: 4 },
  killFeedTxt: {
    color: COLORS.gold,
    fontSize: 12,
    fontFamily: "Exo2-Bold",
    letterSpacing: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
  },
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
  killBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "rgba(0,0,0,0.5)",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  killTxt: { color: COLORS.text, fontFamily: "Exo2-Bold", fontSize: 13 },
  pause: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: COLORS.secondary,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: COLORS.primary,
  },
  allyRow: { flexDirection: "row", paddingHorizontal: 16, gap: 8, flexWrap: "wrap" },
  allyChip: { minWidth: 80 },
  allyName: { fontSize: 10, fontFamily: "Exo2-Bold", marginBottom: 2 },
  allyBar: { height: 4, backgroundColor: "rgba(0,0,0,0.5)", borderRadius: 2, overflow: "hidden", width: 80 },
  allyFill: { height: "100%" },
  joyBase: {
    position: "absolute",
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: "rgba(26, 26, 46, 0.55)",
    borderWidth: 2,
    borderColor: "rgba(255, 215, 0, 0.35)",
    alignItems: "center",
    justifyContent: "center",
  },
  joyKnob: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: "rgba(255, 140, 0, 0.85)",
    borderWidth: 2,
    borderColor: COLORS.gold,
  },
  abilityBtn: {
    position: "absolute",
    width: 68,
    height: 68,
    borderRadius: 34,
    borderWidth: 3,
    backgroundColor: "rgba(255, 87, 34, 0.2)",
    alignItems: "center",
    justifyContent: "center",
  },
  abilityCd: { position: "absolute", bottom: -18, color: COLORS.textDim, fontSize: 10, fontFamily: "Exo2-Bold" },
  endOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.55)",
    alignItems: "center",
    justifyContent: "center",
  },
  endTitle: { color: COLORS.gold, fontFamily: "Cinzel-Black", fontSize: 48, letterSpacing: 6 },
});
