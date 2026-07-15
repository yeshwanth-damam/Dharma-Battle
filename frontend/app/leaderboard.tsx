import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, FlatList, RefreshControl, ActivityIndicator } from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { FontAwesome5 } from "@expo/vector-icons";

import { COLORS, FONTS } from "@/src/game/theme";
import { useStore } from "@/src/game/store";
import { api, LeaderboardEntry } from "@/src/game/api";

export default function Leaderboard() {
  const router = useRouter();
  const { player } = useStore();
  const [entries, setEntries] = useState<LeaderboardEntry[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const list = await api.leaderboard();
      setEntries(list);
    } catch {
      setEntries([]);
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const podium = (entries || []).slice(0, 3);
  const rest = (entries || []).slice(3);

  return (
    <View style={styles.root}>
      <LinearGradient colors={["#1A0A05", "#0A0C16"]} style={StyleSheet.absoluteFill} />
      <SafeAreaView style={{ flex: 1 }} edges={["top", "bottom"]}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.back} testID="lb-back-btn">
            <FontAwesome5 name="chevron-left" size={16} color={COLORS.gold} />
          </TouchableOpacity>
          <Text style={styles.title}>HALL OF LEGENDS</Text>
          <View style={{ width: 40 }} />
        </View>

        {!entries ? (
          <View style={styles.loader}><ActivityIndicator color={COLORS.gold} /></View>
        ) : entries.length === 0 ? (
          <View style={styles.empty}>
            <FontAwesome5 name="trophy" size={40} color={COLORS.textDim} />
            <Text style={styles.emptyTxt}>No warriors yet. Be the first legend!</Text>
          </View>
        ) : (
          <>
            {/* Podium */}
            <View style={styles.podium}>
              {[1, 0, 2].map((idx) => {
                const p = podium[idx];
                if (!p) return <View key={idx} style={styles.podSlot} />;
                const isFirst = idx === 0;
                return (
                  <View key={p.id} style={[styles.podSlot, isFirst && styles.podFirst]}>
                    <View style={[styles.podRank, { backgroundColor: idx === 0 ? COLORS.gold : idx === 1 ? "#B0B0B0" : "#CD7F32" }]}>
                      <Text style={styles.podRankTxt}>{idx + 1}</Text>
                    </View>
                    <Text numberOfLines={1} style={styles.podName}>{p.name}</Text>
                    <Text style={styles.podScore}>{p.best_score}</Text>
                    <Text style={styles.podLbl}>SCORE</Text>
                  </View>
                );
              })}
            </View>

            {/* List */}
            <FlatList
              data={rest}
              keyExtractor={(item) => item.id}
              contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 30 }}
              refreshControl={<RefreshControl refreshing={refreshing} onRefresh={load} tintColor={COLORS.gold} />}
              renderItem={({ item, index }) => {
                const mine = player && item.id === player.id;
                return (
                  <View style={[styles.row, mine && styles.rowMine]} testID={`lb-row-${item.id}`}>
                    <Text style={styles.rank}>{index + 4}</Text>
                    <View style={styles.avatar}>
                      <Text style={styles.avatarTxt}>{item.name.slice(0, 1).toUpperCase()}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.rowName}>{item.name}{mine ? "  (you)" : ""}</Text>
                      <Text style={styles.rowSub}>Lv {item.level} · {item.kills} kills</Text>
                    </View>
                    <Text style={styles.rowScore}>{item.best_score}</Text>
                  </View>
                );
              }}
            />
          </>
        )}
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12, gap: 12 },
  back: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: COLORS.bg2, borderWidth: 1, borderColor: COLORS.border },
  title: { ...FONTS.h3, flex: 1, textAlign: "center", color: COLORS.gold },
  loader: { flex: 1, alignItems: "center", justifyContent: "center" },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12 },
  emptyTxt: { color: COLORS.textDim, fontSize: 15 },
  podium: { flexDirection: "row", alignItems: "flex-end", padding: 20, gap: 10, minHeight: 200 },
  podSlot: { flex: 1, alignItems: "center", padding: 14, backgroundColor: COLORS.bg2, borderRadius: 12, borderWidth: 1, borderColor: COLORS.border, minHeight: 140 },
  podFirst: { backgroundColor: "rgba(255, 215, 0, 0.1)", borderColor: COLORS.gold, minHeight: 170, shadowColor: COLORS.gold, shadowOpacity: 0.5, shadowRadius: 12, elevation: 8 },
  podRank: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center", marginBottom: 8 },
  podRankTxt: { color: COLORS.bg, fontWeight: "900", fontSize: 16 },
  podName: { color: COLORS.text, fontWeight: "800", fontSize: 13, marginTop: 4, textAlign: "center" },
  podScore: { color: COLORS.gold, fontWeight: "900", fontSize: 22, marginTop: 6 },
  podLbl: { color: COLORS.textDim, fontSize: 9, letterSpacing: 1, fontWeight: "800", marginTop: 2 },
  row: { flexDirection: "row", alignItems: "center", padding: 12, borderRadius: 12, backgroundColor: COLORS.bg2, borderWidth: 1, borderColor: COLORS.border, marginBottom: 10, gap: 12 },
  rowMine: { borderColor: COLORS.gold, backgroundColor: "rgba(255, 215, 0, 0.06)" },
  rank: { color: COLORS.textDim, width: 24, fontWeight: "900", textAlign: "center" },
  avatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: COLORS.primary, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: COLORS.gold },
  avatarTxt: { color: "#fff", fontWeight: "900" },
  rowName: { color: COLORS.text, fontWeight: "800", fontSize: 14 },
  rowSub: { color: COLORS.textDim, fontSize: 11, marginTop: 2 },
  rowScore: { color: COLORS.gold, fontWeight: "900", fontSize: 16 },
});
