import React, { useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator } from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { FontAwesome5 } from "@expo/vector-icons";

import { COLORS, FONTS } from "@/src/game/theme";
import { useStore } from "@/src/game/store";
import { api, Hero } from "@/src/game/api";

export default function HeroSelect() {
  const router = useRouter();
  const { player, config, setPlayer } = useStore();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState("");

  if (!player || !config) return null;

  const onPick = async (h: Hero) => {
    if (busy) return;
    setErr("");
    if (!player.owned_heroes.includes(h.id)) {
      // Purchase
      if (player.coins < h.price) {
        setErr("Not enough coins to unlock this warrior.");
        return;
      }
      setBusy(h.id);
      try {
        const p1 = await api.purchase(player.id, "hero", h.id);
        const p2 = await api.select(p1.id, h.id, undefined);
        setPlayer(p2);
      } catch (e: any) {
        setErr(e?.message || "Purchase failed");
      } finally {
        setBusy(null);
      }
    } else {
      setBusy(h.id);
      try {
        const p = await api.select(player.id, h.id, undefined);
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
          <TouchableOpacity onPress={() => router.back()} style={styles.back} testID="hero-back-btn">
            <FontAwesome5 name="chevron-left" size={16} color={COLORS.gold} />
          </TouchableOpacity>
          <Text style={styles.title}>SELECT WARRIOR</Text>
          <View style={styles.coins}>
            <FontAwesome5 name="coins" size={12} color={COLORS.gold} />
            <Text style={styles.coinsTxt}>{player.coins}</Text>
          </View>
        </View>

        {err ? <Text style={styles.err}>{err}</Text> : null}

        <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
          {config.heroes.map((h) => {
            const owned = player.owned_heroes.includes(h.id);
            const selected = player.selected_hero === h.id;
            return (
              <View
                key={h.id}
                style={[styles.card, selected && styles.cardSelected]}
                testID={`hero-card-${h.id}`}
              >
                <View style={styles.cardTop}>
                  <View style={[styles.avatar, { backgroundColor: h.color }]}>
                    <Text style={styles.avatarLtr}>{h.letter}</Text>
                  </View>
                  <View style={{ flex: 1, marginLeft: 14 }}>
                    <Text style={styles.hName}>{h.name}</Text>
                    <Text style={styles.hTitle}>{h.title}</Text>
                    <Text style={styles.hSkill}>✦ {h.skill}</Text>
                  </View>
                  {selected && (
                    <View style={styles.selBadge}>
                      <FontAwesome5 name="check" size={12} color={COLORS.bg} />
                    </View>
                  )}
                </View>

                <View style={styles.statsRow}>
                  <Stat label="HP" value={h.hp} max={200} color={COLORS.success} />
                  <Stat label="ATK" value={h.atk} max={40} color={COLORS.danger} />
                  <Stat label="SPD" value={h.spd} max={10} color={COLORS.primary} />
                </View>

                <TouchableOpacity
                  activeOpacity={0.85}
                  onPress={() => onPick(h)}
                  disabled={selected || busy === h.id}
                  style={[styles.action, selected && styles.actionOwned, !owned && styles.actionBuy]}
                  testID={`hero-action-${h.id}`}
                >
                  {busy === h.id ? (
                    <ActivityIndicator color="#fff" />
                  ) : selected ? (
                    <Text style={styles.actionTxt}>EQUIPPED</Text>
                  ) : owned ? (
                    <Text style={styles.actionTxt}>SELECT</Text>
                  ) : (
                    <View style={styles.buyRow}>
                      <FontAwesome5 name="coins" size={14} color={COLORS.gold} />
                      <Text style={styles.actionTxt}>UNLOCK · {h.price}</Text>
                    </View>
                  )}
                </TouchableOpacity>
              </View>
            );
          })}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

function Stat({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  const pct = Math.min(100, (value / max) * 100);
  return (
    <View style={styles.stat}>
      <View style={styles.statHead}>
        <Text style={styles.statLbl}>{label}</Text>
        <Text style={styles.statVal}>{value}</Text>
      </View>
      <View style={styles.statBar}>
        <View style={[styles.statFill, { width: `${pct}%`, backgroundColor: color }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12, gap: 12 },
  back: {
    width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center",
    backgroundColor: COLORS.bg2, borderWidth: 1, borderColor: COLORS.border,
  },
  title: { ...FONTS.h3, flex: 1, textAlign: "center", color: COLORS.gold },
  coins: {
    flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 6,
    borderRadius: 14, backgroundColor: "rgba(255, 215, 0, 0.1)", borderWidth: 1, borderColor: COLORS.gold,
  },
  coinsTxt: { color: COLORS.gold, fontWeight: "800" },
  err: { color: COLORS.danger, textAlign: "center", marginTop: 8, fontSize: 13 },
  card: { backgroundColor: COLORS.bg2, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: COLORS.border, marginBottom: 16 },
  cardSelected: { borderColor: COLORS.gold, borderWidth: 2, shadowColor: COLORS.gold, shadowOpacity: 0.4, shadowRadius: 14, elevation: 8 },
  cardTop: { flexDirection: "row", alignItems: "center" },
  avatar: { width: 64, height: 64, borderRadius: 32, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: COLORS.gold },
  avatarLtr: { color: "#fff", fontSize: 32, fontWeight: "900" },
  hName: { color: COLORS.text, fontSize: 20, fontWeight: "900", letterSpacing: 1 },
  hTitle: { color: COLORS.textDim, fontSize: 12, fontStyle: "italic", marginTop: 2 },
  hSkill: { color: COLORS.primary, fontSize: 12, marginTop: 6, fontWeight: "700" },
  selBadge: { width: 26, height: 26, borderRadius: 13, backgroundColor: COLORS.gold, alignItems: "center", justifyContent: "center" },
  statsRow: { flexDirection: "row", marginTop: 14, gap: 10 },
  stat: { flex: 1 },
  statHead: { flexDirection: "row", justifyContent: "space-between" },
  statLbl: { color: COLORS.textDim, fontSize: 10, fontWeight: "800", letterSpacing: 1 },
  statVal: { color: COLORS.text, fontSize: 12, fontWeight: "800" },
  statBar: { height: 6, backgroundColor: "rgba(255,255,255,0.08)", borderRadius: 3, marginTop: 4, overflow: "hidden" },
  statFill: { height: "100%", borderRadius: 3 },
  action: {
    marginTop: 14, paddingVertical: 12, borderRadius: 10, alignItems: "center",
    backgroundColor: COLORS.primary, borderWidth: 1, borderColor: COLORS.gold,
  },
  actionOwned: { backgroundColor: COLORS.success, borderColor: COLORS.success },
  actionBuy: { backgroundColor: COLORS.secondary, borderColor: COLORS.primary },
  actionTxt: { color: "#fff", fontWeight: "900", letterSpacing: 1.5, fontSize: 13 },
  buyRow: { flexDirection: "row", alignItems: "center", gap: 8 },
});
