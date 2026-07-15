import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { View, Text, StyleSheet, TouchableOpacity, TextInput, Dimensions, PanResponder, ScrollView, Platform } from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { FontAwesome5 } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";

import { COLORS, FONTS } from "@/src/game/theme";
import { useStore } from "@/src/game/store";
import { soundService } from "@/src/game/sound";
import {
  BattleSocket, StateMsg, LobbyMsg, JoinedMsg, EndMsg, JoinMode,
} from "@/src/game/multiplayer";

const WIN = Dimensions.get("window");
const HUD_TOP = 90;
const HUD_BOTTOM = 190;
// The server simulates on a fixed logical arena; we scale it to this screen.
const LOGICAL_W = 800;
const LOGICAL_H = 520;

type Phase = "menu" | "connecting" | "lobby" | "battle" | "end";

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

export default function Squad() {
  const router = useRouter();
  const { player, config, selectedMap, refresh } = useStore();

  const [phase, setPhase] = useState<Phase>("menu");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [joinCode, setJoinCode] = useState("");
  const [joined, setJoined] = useState<JoinedMsg | null>(null);
  const [lobby, setLobby] = useState<LobbyMsg | null>(null);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [end, setEnd] = useState<EndMsg | null>(null);
  const [snap, setSnap] = useState<StateMsg | null>(null);
  const snapRef = useRef<StateMsg | null>(null);
  const feedRef = useRef<{ id: number; text: string; life: number }[]>([]);
  const feedIdRef = useRef(1);
  const wavePrevRef = useRef(0);

  const socketRef = useRef<BattleSocket | null>(null);
  const phaseRef = useRef<Phase>("menu");
  phaseRef.current = phase;

  // arena geometry
  const arenaTop = HUD_TOP;
  const arenaW = WIN.width;
  const arenaH = WIN.height - HUD_TOP - HUD_BOTTOM;
  const sx = arenaW / LOGICAL_W;
  const sy = arenaH / LOGICAL_H;

  // inputs (mutable refs, flushed to the server at 10 Hz)
  const joystickRef = useRef({ x: 0, y: 0 });
  const tapFireRef = useRef<{ x: number; y: number } | null>(null);
  const abilityRef = useRef(false);
  const [joyKnob, setJoyKnob] = useState({ x: 0, y: 0 });

  const mapObj = useMemo(() => config?.maps.find((m) => m.id === selectedMap), [config, selectedMap]);

  const disconnect = useCallback(() => {
    socketRef.current?.leave();
    socketRef.current = null;
  }, []);

  useEffect(() => () => disconnect(), [disconnect]);

  const connect = useCallback((mode: JoinMode, code?: string) => {
    if (!player) return;
    setErrorMsg(null);
    setEnd(null);
    setSnap(null);
    setLobby(null);
    feedRef.current = [];
    wavePrevRef.current = 0;
    setPhase("connecting");

    const sock = new BattleSocket({
      onJoined: (m) => setJoined(m),
      onLobby: (m) => {
        setLobby(m);
        setCountdown(m.countdown);
        if (phaseRef.current === "connecting") setPhase("lobby");
      },
      onStart: () => {
        haptic("success");
        setPhase("battle");
      },
      onState: (m) => {
        snapRef.current = m;
        for (const t of m.feed) {
          feedRef.current.push({ id: feedIdRef.current++, text: t, life: 1.6 });
        }
        feedRef.current = feedRef.current.slice(-6);
        if (m.wave !== wavePrevRef.current) {
          wavePrevRef.current = m.wave;
        }
        setSnap(m);
      },
      onEnd: (m) => {
        haptic(m.victory ? "success" : "error");
        soundService.play(m.victory ? "victory" : "defeat");
        setEnd(m);
        setPhase("end");
        refresh();
      },
      onError: (message) => {
        setErrorMsg(message);
        if (phaseRef.current === "connecting" || phaseRef.current === "lobby") setPhase("menu");
      },
      onClose: () => {
        if (phaseRef.current === "battle" || phaseRef.current === "lobby" || phaseRef.current === "connecting") {
          setErrorMsg("Disconnected from battle server");
          setPhase("menu");
        }
      },
    });
    socketRef.current = sock;
    sock.connect(player.id, mode, { code, mapId: selectedMap });
  }, [player, selectedMap, refresh]);

  // input flush loop (10 Hz while battling)
  useEffect(() => {
    if (phase !== "battle") return;
    const iv = setInterval(() => {
      const sock = socketRef.current;
      if (!sock) return;
      sock.sendInput(
        { x: joystickRef.current.x, y: joystickRef.current.y },
        tapFireRef.current,
        abilityRef.current,
      );
      tapFireRef.current = null;
      abilityRef.current = false;
    }, 100);
    return () => clearInterval(iv);
  }, [phase]);

  // lobby countdown ticks down locally between server updates
  useEffect(() => {
    if (phase !== "lobby" || countdown == null) return;
    const iv = setInterval(() => {
      setCountdown((c) => (c != null && c > 0 ? Math.max(0, c - 1) : c));
    }, 1000);
    return () => clearInterval(iv);
  }, [phase, countdown == null]); // eslint-disable-line react-hooks/exhaustive-deps

  // feed decay ticker
  const [, setFeedTick] = useState(0);
  useEffect(() => {
    if (phase !== "battle") return;
    const iv = setInterval(() => {
      feedRef.current = feedRef.current.map((f) => ({ ...f, life: f.life - 0.25 })).filter((f) => f.life > 0);
      setFeedTick((t) => t + 1);
    }, 250);
    return () => clearInterval(iv);
  }, [phase]);

  // joystick
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

  // tap-to-fire: convert screen coords to the server's logical arena
  const arenaTapPan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderGrant: (evt) => {
        tapFireRef.current = {
          x: evt.nativeEvent.locationX / sx,
          y: evt.nativeEvent.locationY / sy,
        };
        soundService.play("shoot");
      },
    }),
  ).current;

  if (!player || !config) return null;

  const me = snap?.players.find((p) => p.id === player.id);
  const isHost = joined?.host === player.id || lobby?.host === player.id;

  // ---------- MENU ----------
  if (phase === "menu" || phase === "connecting") {
    return (
      <View style={styles.root}>
        <LinearGradient colors={["#1A0A05", "#0A0C16"]} style={StyleSheet.absoluteFill} />
        <SafeAreaView style={{ flex: 1 }} edges={["top", "bottom"]}>
          <View style={styles.header}>
            <TouchableOpacity onPress={() => { disconnect(); router.back(); }} style={styles.back} testID="squad-back-btn">
              <FontAwesome5 name="chevron-left" size={16} color={COLORS.gold} />
            </TouchableOpacity>
            <Text style={styles.title}>SQUAD CO-OP</Text>
            <View style={{ width: 40 }} />
          </View>

          <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
            <Text style={styles.tagline}>
              Battle the asura hordes together — up to 4 warriors, one arena, real-time.
            </Text>
            <View style={styles.mapPill}>
              <FontAwesome5 name="map-marked-alt" size={12} color={COLORS.gold} />
              <Text style={styles.mapPillTxt}>{mapObj?.name || "Kurukshetra"}</Text>
              <TouchableOpacity onPress={() => router.push("/map-select")} testID="squad-change-map">
                <Text style={styles.mapChange}>CHANGE</Text>
              </TouchableOpacity>
            </View>

            {errorMsg && (
              <View style={styles.errorBox} testID="squad-error">
                <FontAwesome5 name="exclamation-triangle" size={13} color={COLORS.danger} />
                <Text style={styles.errorTxt}>{errorMsg}</Text>
              </View>
            )}

            <TouchableOpacity
              style={styles.bigBtn}
              onPress={() => connect("quick")}
              disabled={phase === "connecting"}
              testID="squad-quick-btn"
            >
              <LinearGradient colors={[COLORS.primary, COLORS.primaryDark]} style={styles.bigBtnGrad}>
                <FontAwesome5 name="bolt" size={20} color="#fff" />
                <View style={{ flex: 1 }}>
                  <Text style={styles.bigBtnTitle}>QUICK MATCH</Text>
                  <Text style={styles.bigBtnSub}>Join the next open squad</Text>
                </View>
              </LinearGradient>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.bigBtn, styles.bigBtnAlt]}
              onPress={() => connect("create")}
              disabled={phase === "connecting"}
              testID="squad-create-btn"
            >
              <FontAwesome5 name="users" size={20} color={COLORS.gold} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.bigBtnTitle, { color: COLORS.gold }]}>CREATE ROOM</Text>
                <Text style={styles.bigBtnSub}>Get a code, invite your friends</Text>
              </View>
            </TouchableOpacity>

            <View style={styles.joinRow}>
              <TextInput
                style={styles.codeInput}
                value={joinCode}
                onChangeText={(t) => setJoinCode(t.toUpperCase().slice(0, 6))}
                placeholder="ROOM CODE"
                placeholderTextColor={COLORS.textDim}
                autoCapitalize="characters"
                testID="squad-code-input"
              />
              <TouchableOpacity
                style={[styles.joinBtn, { opacity: joinCode.length === 6 ? 1 : 0.4 }]}
                disabled={joinCode.length !== 6 || phase === "connecting"}
                onPress={() => connect("code", joinCode)}
                testID="squad-join-btn"
              >
                <Text style={styles.joinBtnTxt}>JOIN</Text>
              </TouchableOpacity>
            </View>

            {phase === "connecting" && (
              <Text style={styles.connecting} testID="squad-connecting">Summoning the battleground…</Text>
            )}
          </ScrollView>
        </SafeAreaView>
      </View>
    );
  }

  // ---------- LOBBY ----------
  if (phase === "lobby") {
    const slots = Array.from({ length: 4 });
    return (
      <View style={styles.root}>
        <LinearGradient colors={["#1A0A05", "#0A0C16"]} style={StyleSheet.absoluteFill} />
        <SafeAreaView style={{ flex: 1 }} edges={["top", "bottom"]}>
          <View style={styles.header}>
            <TouchableOpacity onPress={() => { disconnect(); setPhase("menu"); }} style={styles.back} testID="squad-lobby-leave">
              <FontAwesome5 name="chevron-left" size={16} color={COLORS.gold} />
            </TouchableOpacity>
            <Text style={styles.title}>WAR ROOM</Text>
            <View style={{ width: 40 }} />
          </View>

          <View style={{ padding: 20, flex: 1 }}>
            <View style={styles.codeCard} testID="squad-room-code">
              <Text style={styles.codeLbl}>ROOM CODE</Text>
              <Text style={styles.codeVal}>{lobby?.code || joined?.code}</Text>
              <Text style={styles.codeHint}>Share this code so friends can join</Text>
            </View>

            {countdown != null && (
              <Text style={styles.countdown} testID="squad-countdown">
                Battle begins in {Math.ceil(countdown)}s…
              </Text>
            )}

            <Text style={styles.section}>WARRIORS {lobby?.players.length || 1}/4</Text>
            <View style={styles.slotGrid}>
              {slots.map((_, i) => {
                const p = lobby?.players[i];
                return (
                  <View key={i} style={[styles.pSlot, !p && styles.pSlotEmpty]}>
                    {p ? (
                      <>
                        <View style={[styles.pAvatar, { backgroundColor: p.color }]}>
                          <Text style={styles.pLetter}>{p.letter}</Text>
                        </View>
                        <Text style={styles.pName} numberOfLines={1}>{p.name}</Text>
                        {(lobby?.host === p.id) && <Text style={styles.hostTag}>HOST</Text>}
                      </>
                    ) : (
                      <>
                        <View style={[styles.pAvatar, styles.pAvatarEmpty]}>
                          <FontAwesome5 name="user-plus" size={16} color={COLORS.textDim} />
                        </View>
                        <Text style={[styles.pName, { color: COLORS.textDim }]}>Waiting…</Text>
                      </>
                    )}
                  </View>
                );
              })}
            </View>

            <View style={{ flex: 1 }} />

            {isHost ? (
              <TouchableOpacity style={styles.startBtn} onPress={() => socketRef.current?.requestStart()} testID="squad-start-btn">
                <LinearGradient colors={[COLORS.primary, COLORS.primaryDark]} style={styles.startGrad}>
                  <FontAwesome5 name="khanda" size={20} color="#fff" />
                  <Text style={styles.startTxt}>START BATTLE</Text>
                </LinearGradient>
              </TouchableOpacity>
            ) : (
              <Text style={styles.waitHost}>Waiting for the host to begin…</Text>
            )}
          </View>
        </SafeAreaView>
      </View>
    );
  }

  // ---------- END ----------
  if (phase === "end" && end) {
    const myReward = end.rewards[player.id];
    return (
      <View style={styles.root}>
        <LinearGradient colors={end.victory ? ["#3E2723", "#0A0C16"] : ["#3E0A0A", "#0A0C16"]} style={StyleSheet.absoluteFill} />
        <SafeAreaView style={{ flex: 1 }} edges={["top", "bottom"]}>
          <View style={styles.endWrap}>
            <FontAwesome5 name={end.victory ? "crown" : "khanda"} size={54} color={end.victory ? COLORS.gold : COLORS.danger} />
            <Text style={[styles.endTitle, { color: end.victory ? COLORS.gold : COLORS.danger }]} testID="squad-result-title">
              {end.victory ? "SQUAD VICTORY" : "SQUAD DEFEAT"}
            </Text>

            <View style={styles.board}>
              {end.stats.map((s, i) => (
                <View key={s.id} style={[styles.boardRow, s.id === player.id && styles.boardRowMe]}>
                  <Text style={styles.boardRank}>#{i + 1}</Text>
                  <Text style={[styles.boardName, s.id === player.id && { color: COLORS.gold }]} numberOfLines={1}>
                    {s.name}{s.id === player.id ? " (you)" : ""}
                  </Text>
                  <View style={styles.boardKills}>
                    <FontAwesome5 name="skull-crossbones" size={11} color={COLORS.danger} />
                    <Text style={styles.boardKillsTxt}>{s.kills}</Text>
                  </View>
                </View>
              ))}
            </View>

            {myReward && (
              <View style={styles.rewardRow}>
                <View style={styles.rewardBox}>
                  <FontAwesome5 name="coins" size={18} color={COLORS.gold} />
                  <Text style={styles.rewardVal}>+{myReward.coins}</Text>
                  <Text style={styles.rewardLbl}>COINS</Text>
                </View>
                <View style={styles.rewardBox}>
                  <FontAwesome5 name="star" size={18} color={COLORS.primary} />
                  <Text style={styles.rewardVal}>+{myReward.xp}</Text>
                  <Text style={styles.rewardLbl}>XP</Text>
                </View>
                <View style={styles.rewardBox}>
                  <FontAwesome5 name="trophy" size={18} color={COLORS.gold} />
                  <Text style={styles.rewardVal}>{myReward.score}</Text>
                  <Text style={styles.rewardLbl}>SCORE</Text>
                </View>
              </View>
            )}

            <View style={styles.endBtnRow}>
              <TouchableOpacity style={[styles.endBtn, styles.endBtnSec]} onPress={() => { disconnect(); router.replace("/lobby"); }} testID="squad-end-home">
                <Text style={styles.endBtnSecTxt}>LOBBY</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.endBtn} onPress={() => { disconnect(); setPhase("menu"); }} testID="squad-end-again">
                <LinearGradient colors={[COLORS.primary, COLORS.primaryDark]} style={styles.endBtnGrad}>
                  <Text style={styles.endBtnTxt}>PLAY AGAIN</Text>
                </LinearGradient>
              </TouchableOpacity>
            </View>
          </View>
        </SafeAreaView>
      </View>
    );
  }

  // ---------- BATTLE ----------
  const bg = joined?.map?.bg || "#1A1A2E";
  const hpPct = me ? Math.max(0, (me.hp / me.max_hp) * 100) : 0;
  const abilityReady = me ? me.ability_cd <= 0 : false;

  return (
    <View style={[styles.root, { backgroundColor: bg }]}>
      <View style={[styles.arena, { top: arenaTop, height: arenaH, backgroundColor: bg }]} {...arenaTapPan.panHandlers} testID="squad-arena">
        {Array.from({ length: 8 }).map((_, i) => (
          <View key={`h${i}`} style={[styles.gridLine, { top: (arenaH / 8) * i, width: arenaW, height: 1 }]} />
        ))}
        {Array.from({ length: 8 }).map((_, i) => (
          <View key={`v${i}`} style={[styles.gridLine, { left: (arenaW / 8) * i, width: 1, height: arenaH }]} />
        ))}

        {/* Drops */}
        {snap?.drops.map((d) => (
          <View key={d.id} style={{ position: "absolute", left: d.x * sx - 14, top: d.y * sy - 14 }}>
            <View style={[styles.drop, { borderColor: d.kind === "hp" ? COLORS.success : COLORS.gold, backgroundColor: d.kind === "hp" ? "rgba(76,175,80,0.25)" : "rgba(255,215,0,0.25)" }]}>
              <FontAwesome5 name={d.kind === "hp" ? "heart" : "coins"} size={14} color={d.kind === "hp" ? COLORS.success : COLORS.gold} />
            </View>
          </View>
        ))}

        {/* Bullets */}
        {snap?.bullets.map((b) => (
          <View key={b.id} style={{ position: "absolute", left: b.x * sx - 5, top: b.y * sy - 5, width: 10, height: 10, borderRadius: 5, backgroundColor: b.color, shadowColor: b.color, shadowOpacity: 1, shadowRadius: 8, elevation: 6 }} />
        ))}

        {/* Enemies */}
        {snap?.enemies.map((e) => (
          <View key={e.id} style={{ position: "absolute", left: e.x * sx - e.r, top: e.y * sy - e.r }}>
            <View style={{ width: e.r * 2, height: e.r * 2, borderRadius: e.r, backgroundColor: e.color, borderWidth: 2, borderColor: "#000", alignItems: "center", justifyContent: "center" }}>
              <FontAwesome5 name={e.type === "brute" ? "khanda" : e.type === "swift" ? "wind" : "skull"} size={e.r - 4} color="#fff" />
            </View>
            <View style={{ width: e.r * 2, height: 3, marginTop: 2, backgroundColor: "rgba(0,0,0,0.6)" }}>
              <View style={{ width: `${Math.max(0, (e.hp / e.max_hp) * 100)}%`, height: "100%", backgroundColor: COLORS.danger }} />
            </View>
          </View>
        ))}

        {/* Players (squadmates + me) */}
        {snap?.players.map((p) => (
          <View key={p.id} style={{ position: "absolute", left: p.x * sx - 22, top: p.y * sy - 22, opacity: p.alive ? 1 : 0.25 }}>
            <View style={[styles.playerAvatar, { backgroundColor: p.color, opacity: p.invuln ? 0.5 : 1, borderColor: p.id === player.id ? COLORS.gold : "#fff" }]}>
              <Text style={styles.playerLtr}>{p.letter}</Text>
            </View>
            <Text style={[styles.playerTag, p.id === player.id && { color: COLORS.gold }]} numberOfLines={1}>{p.name}</Text>
            <View style={{ width: 44, height: 3, marginTop: 1, backgroundColor: "rgba(0,0,0,0.6)" }}>
              <View style={{ width: `${Math.max(0, (p.hp / p.max_hp) * 100)}%`, height: "100%", backgroundColor: p.id === player.id ? COLORS.success : COLORS.primary }} />
            </View>
          </View>
        ))}

        {/* Kill feed */}
        <View style={styles.killFeed} pointerEvents="none">
          {feedRef.current.slice(-4).map((k) => (
            <Text key={k.id} style={[styles.killFeedTxt, { opacity: Math.min(1, k.life) }]}>{k.text}</Text>
          ))}
        </View>

        {me && !me.alive && (
          <View style={styles.spectate} pointerEvents="none">
            <Text style={styles.spectateTxt}>YOU HAVE FALLEN — YOUR SQUAD FIGHTS ON</Text>
          </View>
        )}
      </View>

      {/* TOP HUD */}
      <SafeAreaView edges={["top"]} style={styles.hudTop} pointerEvents="box-none">
        <View style={styles.hudRow}>
          <View style={styles.hpBox} testID="squad-hp">
            <Text style={styles.hpLbl}>HP</Text>
            <View style={styles.hpBar}>
              <View style={[styles.hpFill, { width: `${hpPct}%` }]} />
            </View>
          </View>
          <View style={styles.center}>
            <Text style={styles.waveTxt} testID="squad-wave">WAVE {snap?.wave || 1}/{snap?.waves_total || mapObj?.waves || 5}</Text>
            <Text style={styles.timeTxt}>{Math.floor(snap?.elapsed || 0)}s</Text>
          </View>
          <View style={styles.rightBox}>
            <View style={styles.killBox} testID="squad-kills">
              <FontAwesome5 name="skull-crossbones" size={12} color={COLORS.danger} />
              <Text style={styles.killTxt}>{me?.kills || 0}</Text>
            </View>
            <TouchableOpacity style={styles.quitBtn} onPress={() => { disconnect(); router.replace("/lobby"); }} testID="squad-quit-btn">
              <FontAwesome5 name="times" size={12} color={COLORS.text} />
            </TouchableOpacity>
          </View>
        </View>
      </SafeAreaView>

      {/* Joystick */}
      <View style={[styles.joyBase, { left: joyBaseX - 60, top: joyBaseY - 60 }]} {...joyPan.panHandlers} testID="squad-joystick">
        <View style={[styles.joyKnob, { transform: [{ translateX: joyKnob.x }, { translateY: joyKnob.y }] }]} />
      </View>

      {/* Ability button */}
      <TouchableOpacity
        style={[styles.abilityBtn, { right: 30, top: joyBaseY - 90, opacity: abilityReady ? 1 : 0.5, borderColor: abilityReady ? COLORS.gold : COLORS.border }]}
        onPress={() => { abilityRef.current = true; haptic("heavy"); }}
        disabled={!abilityReady}
        testID="squad-ability-btn"
      >
        <FontAwesome5 name="bolt" size={22} color={abilityReady ? COLORS.gold : COLORS.textDim} />
        {!abilityReady && me && <Text style={styles.abilityCd}>{Math.ceil(me.ability_cd)}s</Text>}
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12, gap: 12 },
  back: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: COLORS.bg2, borderWidth: 1, borderColor: COLORS.border },
  title: { ...FONTS.h3, flex: 1, textAlign: "center", color: COLORS.gold },
  tagline: { color: COLORS.textDim, fontSize: 14, fontFamily: "Exo2-Regular", textAlign: "center", marginBottom: 16, lineHeight: 20 },
  mapPill: { flexDirection: "row", alignItems: "center", gap: 8, alignSelf: "center", backgroundColor: COLORS.bg2, borderWidth: 1, borderColor: COLORS.border, borderRadius: 18, paddingHorizontal: 14, paddingVertical: 8, marginBottom: 20 },
  mapPillTxt: { color: COLORS.text, fontFamily: "Exo2-Bold", fontSize: 13 },
  mapChange: { color: COLORS.primary, fontSize: 11, fontFamily: "Exo2-Bold", letterSpacing: 1, marginLeft: 6 },
  errorBox: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "rgba(220,20,60,0.12)", borderWidth: 1, borderColor: COLORS.danger, borderRadius: 10, padding: 12, marginBottom: 16 },
  errorTxt: { color: COLORS.danger, fontSize: 13, fontFamily: "Exo2-Bold", flex: 1 },
  bigBtn: { borderRadius: 16, overflow: "hidden", marginBottom: 14, borderWidth: 2, borderColor: COLORS.gold },
  bigBtnGrad: { flexDirection: "row", alignItems: "center", gap: 14, padding: 18 },
  bigBtnAlt: { flexDirection: "row", alignItems: "center", gap: 14, padding: 18, backgroundColor: COLORS.bg2, borderColor: COLORS.border },
  bigBtnTitle: { color: "#fff", fontFamily: "Cinzel-Bold", fontSize: 17, letterSpacing: 1.5 },
  bigBtnSub: { color: "rgba(255,255,255,0.7)", fontSize: 12, fontFamily: "Exo2-Regular", marginTop: 2 },
  joinRow: { flexDirection: "row", gap: 10, marginTop: 4 },
  codeInput: { flex: 1, backgroundColor: COLORS.bg2, borderWidth: 1, borderColor: COLORS.border, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 14, color: COLORS.gold, fontFamily: "Exo2-Bold", fontSize: 16, letterSpacing: 4 },
  joinBtn: { backgroundColor: COLORS.primary, borderRadius: 12, paddingHorizontal: 22, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: COLORS.gold },
  joinBtnTxt: { color: "#fff", fontFamily: "Cinzel-Bold", letterSpacing: 1 },
  connecting: { color: COLORS.gold, textAlign: "center", marginTop: 20, fontFamily: "Exo2-Bold", letterSpacing: 1 },

  codeCard: { alignItems: "center", backgroundColor: COLORS.bg2, borderRadius: 14, borderWidth: 1, borderColor: COLORS.gold, padding: 18 },
  codeLbl: { ...FONTS.small, color: COLORS.textDim },
  codeVal: { color: COLORS.gold, fontSize: 38, fontFamily: "Cinzel-Black", letterSpacing: 8, marginTop: 4 },
  codeHint: { color: COLORS.textDim, fontSize: 11, marginTop: 4 },
  countdown: { color: COLORS.primary, textAlign: "center", marginTop: 14, fontFamily: "Exo2-Bold", letterSpacing: 1 },
  section: { ...FONTS.small, marginTop: 22, marginBottom: 12, color: COLORS.textDim },
  slotGrid: { flexDirection: "row", gap: 10 },
  pSlot: { flex: 1, alignItems: "center", backgroundColor: COLORS.bg2, borderRadius: 12, borderWidth: 1, borderColor: COLORS.border, paddingVertical: 14, paddingHorizontal: 4 },
  pSlotEmpty: { opacity: 0.55, borderStyle: "dashed" },
  pAvatar: { width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: COLORS.gold },
  pAvatarEmpty: { backgroundColor: "transparent", borderColor: COLORS.border },
  pLetter: { color: "#fff", fontSize: 22, fontFamily: "Cinzel-Black" },
  pName: { color: COLORS.text, fontSize: 11, fontFamily: "Exo2-Bold", marginTop: 8, maxWidth: 70 },
  hostTag: { color: COLORS.primary, fontSize: 9, fontFamily: "Exo2-Bold", letterSpacing: 1, marginTop: 2 },
  startBtn: { borderRadius: 30, overflow: "hidden", borderWidth: 2, borderColor: COLORS.gold },
  startGrad: { flexDirection: "row", alignItems: "center", justifyContent: "center", paddingVertical: 18, gap: 12 },
  startTxt: { color: "#fff", fontFamily: "Cinzel-Bold", fontSize: 18, letterSpacing: 2 },
  waitHost: { color: COLORS.textDim, textAlign: "center", fontFamily: "Exo2-Bold", letterSpacing: 1, paddingVertical: 18 },

  arena: { position: "absolute", left: 0, right: 0, overflow: "hidden" },
  gridLine: { position: "absolute", backgroundColor: "rgba(255,255,255,0.03)" },
  drop: { width: 28, height: 28, borderRadius: 14, borderWidth: 2, alignItems: "center", justifyContent: "center" },
  playerAvatar: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", borderWidth: 3, shadowColor: COLORS.gold, shadowOpacity: 0.8, shadowRadius: 12, elevation: 10 },
  playerLtr: { color: "#fff", fontSize: 22, fontFamily: "Cinzel-Black" },
  playerTag: { color: "#fff", fontSize: 9, fontFamily: "Exo2-Bold", textAlign: "center", marginTop: 2, width: 44 },
  killFeed: { position: "absolute", top: 20, right: 20, alignItems: "flex-end", gap: 4 },
  killFeedTxt: { color: COLORS.gold, fontSize: 12, fontFamily: "Exo2-Bold", letterSpacing: 1, backgroundColor: "rgba(0,0,0,0.5)", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 4 },
  spectate: { position: "absolute", top: "45%", left: 0, right: 0, alignItems: "center" },
  spectateTxt: { color: COLORS.danger, fontFamily: "Cinzel-Bold", fontSize: 15, letterSpacing: 2, backgroundColor: "rgba(0,0,0,0.7)", paddingHorizontal: 16, paddingVertical: 8, borderRadius: 8 },

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
  quitBtn: { width: 34, height: 34, borderRadius: 17, backgroundColor: COLORS.secondary, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: COLORS.primary },
  joyBase: { position: "absolute", width: 120, height: 120, borderRadius: 60, backgroundColor: "rgba(26, 26, 46, 0.55)", borderWidth: 2, borderColor: "rgba(255, 215, 0, 0.35)", alignItems: "center", justifyContent: "center" },
  joyKnob: { width: 48, height: 48, borderRadius: 24, backgroundColor: "rgba(255, 140, 0, 0.85)", borderWidth: 2, borderColor: COLORS.gold },
  abilityBtn: { position: "absolute", width: 68, height: 68, borderRadius: 34, borderWidth: 3, backgroundColor: "rgba(255, 87, 34, 0.2)", alignItems: "center", justifyContent: "center" },
  abilityCd: { position: "absolute", bottom: -18, color: COLORS.textDim, fontSize: 10, fontFamily: "Exo2-Bold" },

  endWrap: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  endTitle: { fontSize: 34, fontFamily: "Cinzel-Black", letterSpacing: 4, marginTop: 12, textAlign: "center" },
  board: { width: "100%", backgroundColor: COLORS.bg2, borderRadius: 14, borderWidth: 1, borderColor: COLORS.border, padding: 8, marginTop: 20 },
  boardRow: { flexDirection: "row", alignItems: "center", paddingVertical: 10, paddingHorizontal: 12, borderRadius: 10, gap: 12 },
  boardRowMe: { backgroundColor: "rgba(255,215,0,0.08)" },
  boardRank: { color: COLORS.textDim, fontFamily: "Cinzel-Bold", width: 30 },
  boardName: { color: COLORS.text, fontFamily: "Exo2-Bold", flex: 1 },
  boardKills: { flexDirection: "row", alignItems: "center", gap: 6 },
  boardKillsTxt: { color: COLORS.text, fontFamily: "Exo2-Bold" },
  rewardRow: { flexDirection: "row", gap: 10, marginTop: 16, width: "100%" },
  rewardBox: { flex: 1, alignItems: "center", backgroundColor: COLORS.bg2, borderRadius: 12, borderWidth: 1, borderColor: COLORS.border, paddingVertical: 14 },
  rewardVal: { color: COLORS.gold, fontSize: 20, fontFamily: "Cinzel-Black", marginTop: 6 },
  rewardLbl: { color: COLORS.textDim, fontSize: 9, letterSpacing: 1.5, fontFamily: "Exo2-Bold", marginTop: 2 },
  endBtnRow: { flexDirection: "row", gap: 12, marginTop: 24, width: "100%" },
  endBtn: { flex: 1, borderRadius: 26, overflow: "hidden", borderWidth: 2, borderColor: COLORS.gold },
  endBtnSec: { backgroundColor: COLORS.bg2, alignItems: "center", justifyContent: "center", paddingVertical: 14 },
  endBtnSecTxt: { color: COLORS.gold, fontFamily: "Cinzel-Bold", letterSpacing: 1 },
  endBtnGrad: { alignItems: "center", justifyContent: "center", paddingVertical: 14 },
  endBtnTxt: { color: "#fff", fontFamily: "Cinzel-Bold", letterSpacing: 1 },
});
