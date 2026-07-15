import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, TextInput, ActivityIndicator, RefreshControl } from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { FontAwesome5 } from "@expo/vector-icons";

import { COLORS, FONTS } from "@/src/game/theme";
import { useStore } from "@/src/game/store";
import { api, RoomSummary } from "@/src/game/api";

const ROOM_LIST_POLL_MS = 3000;

export default function CoopLobby() {
  const router = useRouter();
  const { player, config, selectedMap } = useStore();

  const [rooms, setRooms] = useState<RoomSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [joinCode, setJoinCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const mapObj = config?.maps.find((m) => m.id === selectedMap);

  const loadRooms = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const list = await api.listRooms();
      setRooms(list);
    } catch {
      // ignore transient poll failures
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadRooms();
    const id = setInterval(() => loadRooms(true), ROOM_LIST_POLL_MS);
    return () => clearInterval(id);
  }, [loadRooms]);

  const goToRoom = (code: string) => router.push({ pathname: "/coop-battle", params: { code } });

  const createRoom = async () => {
    if (!player || busy) return;
    setBusy(true);
    setError("");
    try {
      const room = await api.createRoom(player.id, selectedMap, 4);
      goToRoom(room.code);
    } catch {
      setError("Could not create room. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const joinByCode = async () => {
    const code = joinCode.trim().toUpperCase();
    if (!player || !code || busy) return;
    setBusy(true);
    setError("");
    try {
      await api.joinRoom(code, player.id);
      goToRoom(code);
    } catch {
      setError("Room not found, full, or already started.");
    } finally {
      setBusy(false);
    }
  };

  const joinRoom = async (code: string) => {
    if (!player || busy) return;
    setBusy(true);
    setError("");
    try {
      await api.joinRoom(code, player.id);
      goToRoom(code);
    } catch {
      setError("Could not join that squad.");
    } finally {
      setBusy(false);
    }
  };

  if (!player || !config) return null;

  return (
    <View style={styles.root}>
      <LinearGradient colors={["#0C1A2E", "#0A0C16"]} style={StyleSheet.absoluteFill} />
      <SafeAreaView style={{ flex: 1 }} edges={["top", "bottom"]}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.back} testID="coop-back-btn">
            <FontAwesome5 name="chevron-left" size={16} color={COLORS.gold} />
          </TouchableOpacity>
          <Text style={styles.title}>CO-OP SQUAD</Text>
          <View style={{ width: 40 }} />
        </View>

        <ScrollView
          contentContainerStyle={{ padding: 20, paddingBottom: 40 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); loadRooms(); }} tintColor={COLORS.gold} />}
        >
          <Text style={styles.subtitle}>
            Team up on <Text style={{ color: COLORS.gold }}>{mapObj?.name || "the battlefield"}</Text> — up to 4 warriors, one shared wave gauntlet.
          </Text>

          {error ? <Text style={styles.errorTxt}>{error}</Text> : null}

          <TouchableOpacity style={styles.createBtn} onPress={createRoom} disabled={busy} testID="coop-create-btn">
            <LinearGradient colors={[COLORS.primary, COLORS.primaryDark]} style={styles.createGrad}>
              <FontAwesome5 name="users" size={18} color="#fff" />
              <Text style={styles.createTxt}>{busy ? "STARTING…" : "CREATE SQUAD"}</Text>
            </LinearGradient>
          </TouchableOpacity>

          <View style={styles.joinRow}>
            <TextInput
              style={styles.joinInput}
              placeholder="ENTER ROOM CODE"
              placeholderTextColor={COLORS.textDim}
              autoCapitalize="characters"
              maxLength={5}
              value={joinCode}
              onChangeText={setJoinCode}
              testID="coop-code-input"
            />
            <TouchableOpacity style={styles.joinBtn} onPress={joinByCode} disabled={busy || !joinCode.trim()} testID="coop-join-code-btn">
              <Text style={styles.joinBtnTxt}>JOIN</Text>
            </TouchableOpacity>
          </View>

          <Text style={styles.section}>OPEN SQUADS</Text>
          {loading ? (
            <ActivityIndicator color={COLORS.gold} style={{ marginTop: 20 }} />
          ) : rooms.length === 0 ? (
            <Text style={styles.empty}>No open squads right now. Create one and invite others with the code!</Text>
          ) : (
            rooms.map((r) => (
              <View key={r.code} style={styles.roomCard} testID={`coop-room-${r.code}`}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.roomCode}>{r.code}</Text>
                  <Text style={styles.roomMeta}>
                    {config.maps.find((m) => m.id === r.map_id)?.name || r.map_id} · {r.players.length}/{r.max_players} warriors
                  </Text>
                </View>
                <TouchableOpacity
                  style={[styles.joinRoomBtn, r.players.length >= r.max_players && styles.joinRoomBtnDisabled]}
                  onPress={() => joinRoom(r.code)}
                  disabled={busy || r.players.length >= r.max_players}
                  testID={`coop-join-${r.code}`}
                >
                  <Text style={styles.joinRoomBtnTxt}>{r.players.length >= r.max_players ? "FULL" : "JOIN"}</Text>
                </TouchableOpacity>
              </View>
            ))
          )}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12, gap: 12 },
  back: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: COLORS.bg2, borderWidth: 1, borderColor: COLORS.border },
  title: { ...FONTS.h3, flex: 1, textAlign: "center", color: COLORS.gold },
  subtitle: { color: COLORS.textDim, fontSize: 13, fontStyle: "italic", marginBottom: 20, lineHeight: 19 },
  errorTxt: { color: COLORS.danger, fontSize: 12, fontFamily: "Exo2-Bold", marginBottom: 12 },
  createBtn: { borderRadius: 28, overflow: "hidden", borderWidth: 2, borderColor: COLORS.gold },
  createGrad: { flexDirection: "row", alignItems: "center", justifyContent: "center", paddingVertical: 16, gap: 10 },
  createTxt: { color: "#fff", fontFamily: "Cinzel-Bold", fontSize: 16, letterSpacing: 1.5 },
  joinRow: { flexDirection: "row", gap: 10, marginTop: 16 },
  joinInput: {
    flex: 1, backgroundColor: COLORS.bg2, borderRadius: 12, borderWidth: 1, borderColor: COLORS.border,
    paddingHorizontal: 16, color: COLORS.text, fontFamily: "Exo2-Bold", letterSpacing: 2, fontSize: 15,
  },
  joinBtn: { backgroundColor: COLORS.surface, borderRadius: 12, borderWidth: 1, borderColor: COLORS.gold, paddingHorizontal: 20, alignItems: "center", justifyContent: "center" },
  joinBtnTxt: { color: COLORS.gold, fontFamily: "Exo2-Bold", letterSpacing: 1 },
  section: { ...FONTS.small, marginTop: 28, marginBottom: 12, color: COLORS.textDim },
  empty: { color: COLORS.textDim, fontSize: 13, fontStyle: "italic", textAlign: "center", marginTop: 24 },
  roomCard: {
    flexDirection: "row", alignItems: "center", backgroundColor: COLORS.bg2, borderRadius: 14, padding: 16,
    borderWidth: 1, borderColor: COLORS.border, marginBottom: 12,
  },
  roomCode: { color: COLORS.gold, fontFamily: "Cinzel-Bold", fontSize: 20, letterSpacing: 3 },
  roomMeta: { color: COLORS.textDim, fontSize: 12, marginTop: 4 },
  joinRoomBtn: { backgroundColor: COLORS.primary, borderRadius: 18, paddingHorizontal: 18, paddingVertical: 10, borderWidth: 1, borderColor: COLORS.gold },
  joinRoomBtnDisabled: { backgroundColor: COLORS.surface, borderColor: COLORS.border, opacity: 0.6 },
  joinRoomBtnTxt: { color: "#fff", fontFamily: "Exo2-Bold", fontSize: 12, letterSpacing: 1 },
});
