import React, { useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator } from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { FontAwesome5, MaterialCommunityIcons } from "@expo/vector-icons";

import { COLORS, FONTS } from "@/src/game/theme";
import { useStore } from "@/src/game/store";
import { api, Weapon } from "@/src/game/api";

export default function WeaponSelect() {
  const router = useRouter();
  const { player, config, setPlayer } = useStore();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState("");

  if (!player || !config) return null;

  const onPick = async (w: Weapon) => {
    if (busy) return;
    setErr("");
    if (!player.owned_weapons.includes(w.id)) {
      if (player.coins < w.price) {
        setErr("Not enough coins to forge this astra.");
        return;
      }
      setBusy(w.id);
      try {
        const p1 = await api.purchase(player.id, "weapon", w.id);
        const p2 = await api.select(p1.id, undefined, w.id);
        setPlayer(p2);
      } catch (e: any) {
        setErr(e?.message || "Purchase failed");
      } finally {
        setBusy(null);
      }
    } else {
      setBusy(w.id);
      try {
        const p = await api.select(player.id, undefined, w.id);
        setPlayer(p);
      } finally {
        setBusy(null);
      }
    }
  };

  return (
    <View style={styles.root}>
      <LinearGradient colors={["#1A0A05", "#0A0C16"]} style={StyleSheet.absoluteFill} />
      <SafeAreaView style={{ flex: 1 }} edges={["top", "bottom"]}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.back} testID="weapon-back-btn">
            <FontAwesome5 name="chevron-left" size={16} color={COLORS.gold} />
          </TouchableOpacity>
          <Text style={styles.title}>CHOOSE ASTRA</Text>
          <View style={styles.coins}>
            <FontAwesome5 name="coins" size={12} color={COLORS.gold} />
            <Text style={styles.coinsTxt}>{player.coins}</Text>
          </View>
        </View>

        {err ? <Text style={styles.err}>{err}</Text> : null}

        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
          <View style={styles.grid}>
            {config.weapons.map((w) => {
              const owned = player.owned_weapons.includes(w.id);
              const selected = player.selected_weapon === w.id;
              return (
                <TouchableOpacity
                  key={w.id}
                  activeOpacity={0.9}
                  onPress={() => onPick(w)}
                  style={[styles.card, selected && { borderColor: w.color, borderWidth: 2 }]}
                  testID={`weapon-card-${w.id}`}
                >
                  <View style={[styles.icoWrap, { borderColor: w.color }]}>
                    <MaterialCommunityIcons name="creation" size={44} color={w.color} />
                  </View>
                  <Text style={styles.wName}>{w.name}</Text>
                  <Text style={styles.wDesc} numberOfLines={2}>{w.desc}</Text>
                  <View style={styles.wStats}>
                    <Text style={styles.wStat}>⚡ {w.damage}</Text>
                    <Text style={styles.wStat}>⏱ {w.cooldown}s</Text>
                  </View>
                  <View style={[styles.wBtn, selected && { backgroundColor: COLORS.success }]}>
                    {busy === w.id ? (
                      <ActivityIndicator size="small" color="#fff" />
                    ) : selected ? (
                      <Text style={styles.wBtnTxt}>EQUIPPED</Text>
                    ) : owned ? (
                      <Text style={styles.wBtnTxt}>SELECT</Text>
                    ) : (
                      <Text style={styles.wBtnTxt}>⚱ {w.price}</Text>
                    )}
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
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
  coins: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 14, backgroundColor: "rgba(255, 215, 0, 0.1)", borderWidth: 1, borderColor: COLORS.gold },
  coinsTxt: { color: COLORS.gold, fontWeight: "800" },
  err: { color: COLORS.danger, textAlign: "center", marginBottom: 4, fontSize: 13 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 12, justifyContent: "space-between" },
  card: { width: "48%", backgroundColor: COLORS.bg2, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: COLORS.border, alignItems: "center" },
  icoWrap: { width: 80, height: 80, borderRadius: 40, alignItems: "center", justifyContent: "center", borderWidth: 2, backgroundColor: "rgba(255, 140, 0, 0.08)" },
  wName: { color: COLORS.text, fontSize: 16, fontWeight: "900", marginTop: 10, textAlign: "center" },
  wDesc: { color: COLORS.textDim, fontSize: 11, textAlign: "center", marginTop: 4, minHeight: 28 },
  wStats: { flexDirection: "row", justifyContent: "space-between", width: "100%", marginTop: 8 },
  wStat: { color: COLORS.gold, fontSize: 12, fontWeight: "700" },
  wBtn: { marginTop: 10, paddingVertical: 10, backgroundColor: COLORS.primary, borderRadius: 8, width: "100%", alignItems: "center" },
  wBtnTxt: { color: "#fff", fontWeight: "900", fontSize: 12, letterSpacing: 1 },
});
