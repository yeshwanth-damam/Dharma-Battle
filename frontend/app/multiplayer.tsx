import React, { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ScrollView,
  ActivityIndicator,
} from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { FontAwesome5 } from "@expo/vector-icons";

import { COLORS, FONTS } from "@/src/game/theme";
import { useStore } from "@/src/game/store";
import { MpClient, mpApi, mpSession, RoomSummary } from "@/src/game/multiplayer";

export default function MultiplayerLobby() {
  const router = useRouter();
  const { player, config, selectedMap } = useStore();
  const [rooms, setRooms] = useState<RoomSummary[]>([]);
  const [joinCode, setJoinCode] = useState("");
  const [active, setActive] = useState<RoomSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [client, setClient] = useState<MpClient | null>(null);

  const refreshRooms = useCallback(async () => {
    try {
      const list = await mpApi.listRooms();
      setRooms(list);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    refreshRooms();
    const t = setInterval(refreshRooms, 4000);
    return () => {
      clearInterval(t);
      // Don't disconnect if navigating to battle — session keeps client
      if (!mpSession.client) {
        client?.disconnect();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!client) return;
    return client.on((msg) => {
      if (msg.type === "room_state") setActive(msg.room);
      if (msg.type === "match_start") {
        mpSession.client = client;
        mpSession.code = active?.code || mpSession.code;
        router.replace("/mp-battle");
      }
      if (msg.type === "error") setError(msg.message || "Error");
    });
  }, [client, active?.code, router]);

  if (!player || !config) return null;

  const attach = async (code: string) => {
    const c = new MpClient();
    await c.connect(code, player.id);
    setClient(c);
    mpSession.code = code;
    return c;
  };

  const onCreate = async () => {
    setBusy(true);
    setError("");
    try {
      const room = await mpApi.createRoom({
        player_id: player.id,
        player_name: player.name,
        hero_id: player.selected_hero,
        weapon_id: player.selected_weapon,
        map_id: selectedMap,
      });
      setActive(room);
      await attach(room.code);
      await refreshRooms();
    } catch (e: any) {
      setError(e?.message || "Failed to create room");
    } finally {
      setBusy(false);
    }
  };

  const onJoin = async (code: string) => {
    const c = code.trim().toUpperCase();
    if (!c) return;
    setBusy(true);
    setError("");
    try {
      const room = await mpApi.joinRoom({
        player_id: player.id,
        player_name: player.name,
        hero_id: player.selected_hero,
        weapon_id: player.selected_weapon,
        code: c,
      });
      setActive(room);
      await attach(room.code);
    } catch (e: any) {
      setError(e?.message || "Failed to join");
    } finally {
      setBusy(false);
    }
  };

  const onReady = () => client?.setReady(true, false);
  const onStart = () => client?.setReady(true, true);

  const me = active?.players.find((p) => p.player_id === player.id);
  const isHost = active?.host_id === player.id;
  const mapName = config.maps.find((m) => m.id === (active?.map_id || selectedMap))?.name;

  return (
    <View style={styles.root}>
      <LinearGradient colors={["#1A0A05", "#0A0C16", "#0A0C16"]} style={StyleSheet.absoluteFill} />
      <SafeAreaView style={{ flex: 1 }} edges={["top", "bottom"]}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => { client?.disconnect(); mpSession.client = null; router.back(); }} testID="mp-back">
            <FontAwesome5 name="arrow-left" size={18} color={COLORS.gold} />
          </TouchableOpacity>
          <Text style={styles.title}>CO-OP ARENA</Text>
          <View style={{ width: 18 }} />
        </View>

        <Text style={styles.sub}>
          2–4 warriors · shared waves · server-authoritative
        </Text>

        {error ? <Text style={styles.err} testID="mp-error">{error}</Text> : null}

        {!active ? (
          <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
            <TouchableOpacity
              style={styles.createBtn}
              onPress={onCreate}
              disabled={busy}
              testID="mp-create-btn"
            >
              <LinearGradient colors={[COLORS.primary, COLORS.primaryDark]} style={styles.createGrad}>
                {busy ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <>
                    <FontAwesome5 name="plus" size={16} color="#fff" />
                    <Text style={styles.createTxt}>CREATE ROOM · {mapName || selectedMap}</Text>
                  </>
                )}
              </LinearGradient>
            </TouchableOpacity>

            <Text style={styles.section}>JOIN WITH CODE</Text>
            <View style={styles.joinRow}>
              <TextInput
                style={styles.codeInput}
                value={joinCode}
                onChangeText={(t) => setJoinCode(t.toUpperCase())}
                placeholder="ABCDE"
                placeholderTextColor={COLORS.textDim}
                autoCapitalize="characters"
                maxLength={6}
                testID="mp-join-input"
              />
              <TouchableOpacity
                style={styles.joinBtn}
                onPress={() => onJoin(joinCode)}
                disabled={busy}
                testID="mp-join-btn"
              >
                <Text style={styles.joinBtnTxt}>JOIN</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.sectionRow}>
              <Text style={styles.section}>OPEN ROOMS</Text>
              <TouchableOpacity onPress={refreshRooms} testID="mp-refresh">
                <FontAwesome5 name="sync" size={14} color={COLORS.gold} />
              </TouchableOpacity>
            </View>

            {rooms.length === 0 ? (
              <Text style={styles.empty}>No open rooms — create one.</Text>
            ) : (
              rooms.map((r) => (
                <TouchableOpacity
                  key={r.code}
                  style={styles.roomCard}
                  onPress={() => onJoin(r.code)}
                  testID={`mp-room-${r.code}`}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={styles.roomCode}>{r.code}</Text>
                    <Text style={styles.roomMeta}>
                      {r.map_id} · {r.player_count}/{r.max_players}
                    </Text>
                  </View>
                  <FontAwesome5 name="sign-in-alt" size={16} color={COLORS.gold} />
                </TouchableOpacity>
              ))
            )}
          </ScrollView>
        ) : (
          <View style={styles.lobbyBody}>
            <View style={styles.codeBanner} testID="mp-active-code">
              <Text style={styles.codeLbl}>ROOM CODE</Text>
              <Text style={styles.codeBig}>{active.code}</Text>
              <Text style={styles.codeHint}>Share with allies · Map: {mapName}</Text>
            </View>

            <Text style={styles.section}>WARRIORS ({active.player_count}/{active.max_players})</Text>
            {active.players.map((p) => (
              <View key={p.player_id} style={styles.playerRow} testID={`mp-player-${p.player_id}`}>
                <View style={[styles.avatar, { backgroundColor: p.color }]}>
                  <Text style={styles.avatarLtr}>{p.letter}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.playerName}>
                    {p.name}
                    {p.player_id === active.host_id ? " · HOST" : ""}
                    {p.player_id === player.id ? " · YOU" : ""}
                  </Text>
                  <Text style={styles.playerMeta}>
                    {p.hero_id} · {p.weapon_id}
                    {!p.connected ? " · reconnecting…" : ""}
                  </Text>
                </View>
                <Text style={[styles.readyPill, { color: p.ready ? COLORS.success : COLORS.textDim }]}>
                  {p.ready ? "READY" : "…"}
                </Text>
              </View>
            ))}

            <View style={styles.actions}>
              {!me?.ready ? (
                <TouchableOpacity style={styles.readyBtn} onPress={onReady} testID="mp-ready-btn">
                  <Text style={styles.readyBtnTxt}>I'M READY</Text>
                </TouchableOpacity>
              ) : (
                <Text style={styles.waiting}>Waiting for host…</Text>
              )}
              {isHost && (
                <TouchableOpacity style={styles.startBtn} onPress={onStart} testID="mp-start-btn">
                  <LinearGradient colors={[COLORS.primary, COLORS.primaryDark]} style={styles.startGrad}>
                    <FontAwesome5 name="khanda" size={18} color="#fff" />
                    <Text style={styles.startTxt}>START BATTLE</Text>
                  </LinearGradient>
                </TouchableOpacity>
              )}
              <TouchableOpacity
                style={styles.leaveBtn}
                onPress={() => {
                  client?.disconnect();
                  setClient(null);
                  setActive(null);
                  mpSession.client = null;
                }}
                testID="mp-leave-btn"
              >
                <Text style={styles.leaveTxt}>LEAVE ROOM</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 4,
  },
  title: { ...FONTS.h3, color: COLORS.gold, letterSpacing: 3 },
  sub: { ...FONTS.small, color: COLORS.textDim, textAlign: "center", marginBottom: 8 },
  err: { color: COLORS.danger, textAlign: "center", marginHorizontal: 20, marginBottom: 8 },
  createBtn: { borderRadius: 16, overflow: "hidden", marginBottom: 24 },
  createGrad: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    paddingVertical: 18,
  },
  createTxt: { color: "#fff", fontFamily: "Cinzel-Bold", letterSpacing: 2, fontSize: 14 },
  section: { ...FONTS.small, color: COLORS.gold, marginBottom: 10, marginTop: 8 },
  sectionRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  joinRow: { flexDirection: "row", gap: 10, marginBottom: 20 },
  codeInput: {
    flex: 1,
    backgroundColor: COLORS.bg2,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    color: COLORS.gold,
    fontFamily: "Cinzel-Bold",
    fontSize: 20,
    letterSpacing: 6,
    textAlign: "center",
  },
  joinBtn: {
    backgroundColor: COLORS.secondary,
    borderWidth: 1,
    borderColor: COLORS.gold,
    borderRadius: 12,
    paddingHorizontal: 20,
    justifyContent: "center",
  },
  joinBtnTxt: { color: COLORS.gold, fontFamily: "Cinzel-Bold", letterSpacing: 2 },
  empty: { color: COLORS.textDim, marginTop: 8 },
  roomCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: COLORS.bg2,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
  },
  roomCode: { color: COLORS.gold, fontFamily: "Cinzel-Bold", fontSize: 18, letterSpacing: 3 },
  roomMeta: { color: COLORS.textDim, marginTop: 4, fontSize: 12 },
  lobbyBody: { flex: 1, paddingHorizontal: 20 },
  codeBanner: {
    alignItems: "center",
    backgroundColor: COLORS.bg2,
    borderWidth: 1,
    borderColor: COLORS.gold,
    borderRadius: 16,
    padding: 20,
    marginVertical: 12,
  },
  codeLbl: { ...FONTS.small, color: COLORS.textDim },
  codeBig: { color: COLORS.gold, fontFamily: "Cinzel-Black", fontSize: 40, letterSpacing: 8, marginTop: 4 },
  codeHint: { color: COLORS.textDim, marginTop: 6, fontSize: 12 },
  playerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: COLORS.bg2,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 12,
    marginBottom: 8,
  },
  avatar: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  avatarLtr: { color: "#fff", fontFamily: "Cinzel-Black", fontSize: 18 },
  playerName: { color: COLORS.text, fontFamily: "Exo2-Bold", fontSize: 15 },
  playerMeta: { color: COLORS.textDim, fontSize: 11, marginTop: 2, textTransform: "uppercase" },
  readyPill: { fontFamily: "Exo2-Bold", fontSize: 12, letterSpacing: 1 },
  actions: { marginTop: "auto", paddingBottom: 16, gap: 12 },
  readyBtn: {
    backgroundColor: COLORS.success,
    borderRadius: 24,
    paddingVertical: 16,
    alignItems: "center",
  },
  readyBtnTxt: { color: "#fff", fontFamily: "Cinzel-Bold", letterSpacing: 2 },
  waiting: { textAlign: "center", color: COLORS.textDim, fontFamily: "Exo2-Bold" },
  startBtn: { borderRadius: 24, overflow: "hidden" },
  startGrad: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingVertical: 16,
  },
  startTxt: { color: "#fff", fontFamily: "Cinzel-Bold", letterSpacing: 2 },
  leaveBtn: { alignItems: "center", paddingVertical: 10 },
  leaveTxt: { color: COLORS.danger, fontFamily: "Exo2-Bold", letterSpacing: 1 },
});
