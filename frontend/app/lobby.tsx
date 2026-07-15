import React, { useMemo } from "react";
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { FontAwesome5, MaterialCommunityIcons } from "@expo/vector-icons";

import { COLORS, FONTS } from "@/src/game/theme";
import { useStore } from "@/src/game/store";

function xpForNext(level: number) {
  return 100 + (level - 1) * 75;
}

export default function Lobby() {
  const router = useRouter();
  const { player, config, selectedMap } = useStore();

  const heroObj = useMemo(
    () => config?.heroes.find((h) => h.id === player?.selected_hero),
    [config, player],
  );
  const weaponObj = useMemo(
    () => config?.weapons.find((w) => w.id === player?.selected_weapon),
    [config, player],
  );
  const mapObj = useMemo(() => config?.maps.find((m) => m.id === selectedMap), [config, selectedMap]);

  if (!player || !config) return null;

  const xpMax = xpForNext(player.level);

  return (
    <View style={styles.root}>
      <LinearGradient colors={["#1A0A05", "#0A0C16", "#0A0C16"]} style={StyleSheet.absoluteFill} />
      <SafeAreaView style={{ flex: 1 }} edges={["top", "bottom"]}>
        {/* Header */}
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text style={styles.hi}>NAMASTE</Text>
            <Text style={styles.name} testID="lobby-warrior-name">{player.name}</Text>
          </View>
          <View style={styles.coinsPill} testID="lobby-coins">
            <FontAwesome5 name="coins" size={14} color={COLORS.gold} />
            <Text style={styles.coinsTxt}>{player.coins}</Text>
          </View>
        </View>

        {/* Level card */}
        <View style={styles.levelCard}>
          <View style={styles.levelRow}>
            <View style={styles.lvlBadge}>
              <Text style={styles.lvlNum}>{player.level}</Text>
              <Text style={styles.lvlLbl}>LVL</Text>
            </View>
            <View style={{ flex: 1, marginLeft: 14 }}>
              <Text style={styles.xpTxt}>
                XP {player.xp} / {xpMax}
              </Text>
              <View style={styles.xpBar}>
                <View style={[styles.xpFill, { width: `${Math.min(100, (player.xp / xpMax) * 100)}%` }]} />
              </View>
              <Text style={styles.xpDim}>
                {player.kills} kills · {player.wins} victories
              </Text>
            </View>
          </View>
        </View>

        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 24 }} showsVerticalScrollIndicator={false}>
          {/* Loadout */}
          <Text style={styles.section}>BATTLE LOADOUT</Text>
          <View style={styles.loadoutRow}>
            <TouchableOpacity style={styles.slot} onPress={() => router.push("/hero-select")} testID="lobby-hero-slot">
              <Text style={styles.slotLbl}>WARRIOR</Text>
              <View style={[styles.heroAvatar, { backgroundColor: heroObj?.color || COLORS.primary }]}>
                <Text style={styles.heroLetter}>{heroObj?.letter || "?"}</Text>
              </View>
              <Text style={styles.slotName}>{heroObj?.name || "—"}</Text>
              <Text style={styles.slotChange}>CHANGE →</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.slot} onPress={() => router.push("/weapon-select")} testID="lobby-weapon-slot">
              <Text style={styles.slotLbl}>ASTRA</Text>
              <View style={[styles.weaponAvatar, { borderColor: weaponObj?.color || COLORS.gold }]}>
                <MaterialCommunityIcons name="creation" size={38} color={weaponObj?.color || COLORS.gold} />
              </View>
              <Text style={styles.slotName}>{weaponObj?.name || "—"}</Text>
              <Text style={styles.slotChange}>CHANGE →</Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity style={styles.mapBtn} onPress={() => router.push("/map-select")} testID="lobby-map-slot">
            <View style={{ flex: 1 }}>
              <Text style={styles.slotLbl}>BATTLEGROUND</Text>
              <Text style={styles.mapName}>{mapObj?.name}</Text>
              <Text style={styles.mapDesc}>{mapObj?.desc}</Text>
            </View>
            <FontAwesome5 name="chevron-right" size={18} color={COLORS.gold} />
          </TouchableOpacity>

          {/* Play button */}
          <TouchableOpacity
            activeOpacity={0.85}
            style={styles.play}
            onPress={() => router.push("/battle")}
            testID="lobby-play-btn"
          >
            <LinearGradient colors={[COLORS.primary, COLORS.primaryDark]} style={styles.playGrad}>
              <FontAwesome5 name="khanda" size={22} color={COLORS.text} />
              <Text style={styles.playTxt}>ENTER BATTLE</Text>
            </LinearGradient>
          </TouchableOpacity>

          {/* Quick actions */}
          <View style={styles.quickRow}>
            <QuickBtn icon="store" label="Shop" onPress={() => router.push("/shop")} testID="lobby-shop-btn" />
            <QuickBtn icon="trophy" label="Ranks" onPress={() => router.push("/leaderboard")} testID="lobby-leaderboard-btn" />
            <QuickBtn icon="user-shield" label="Profile" onPress={() => router.push("/profile")} testID="lobby-profile-btn" />
          </View>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

function QuickBtn({ icon, label, onPress, testID }: { icon: any; label: string; onPress: () => void; testID: string }) {
  return (
    <TouchableOpacity style={styles.qb} onPress={onPress} testID={testID}>
      <FontAwesome5 name={icon} size={22} color={COLORS.gold} />
      <Text style={styles.qbTxt}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 20, paddingTop: 12, paddingBottom: 8 },
  hi: { ...FONTS.small, color: COLORS.textDim, letterSpacing: 3 },
  name: { ...FONTS.h2, color: COLORS.gold, marginTop: 2 },
  coinsPill: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: "rgba(255, 215, 0, 0.12)", borderWidth: 1, borderColor: COLORS.gold,
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20,
  },
  coinsTxt: { color: COLORS.gold, fontWeight: "800", fontSize: 16 },
  levelCard: {
    marginHorizontal: 20, marginTop: 12, padding: 16, borderRadius: 14,
    backgroundColor: COLORS.bg2, borderWidth: 1, borderColor: COLORS.border,
  },
  levelRow: { flexDirection: "row", alignItems: "center" },
  lvlBadge: {
    width: 56, height: 56, borderRadius: 28, borderWidth: 2, borderColor: COLORS.gold,
    alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255, 140, 0, 0.15)",
  },
  lvlNum: { color: COLORS.gold, fontSize: 22, fontWeight: "900" },
  lvlLbl: { color: COLORS.gold, fontSize: 9, letterSpacing: 1 },
  xpTxt: { color: COLORS.text, fontWeight: "700", fontSize: 13 },
  xpBar: { height: 8, backgroundColor: "rgba(255,255,255,0.1)", borderRadius: 4, marginTop: 6, overflow: "hidden" },
  xpFill: { height: "100%", backgroundColor: COLORS.gold },
  xpDim: { color: COLORS.textDim, fontSize: 12, marginTop: 6 },

  section: { ...FONTS.small, marginTop: 24, marginBottom: 12, paddingHorizontal: 20, color: COLORS.textDim },

  loadoutRow: { flexDirection: "row", paddingHorizontal: 20, gap: 12 },
  slot: {
    flex: 1, backgroundColor: COLORS.bg2, borderRadius: 14, padding: 16,
    borderWidth: 1, borderColor: COLORS.border, alignItems: "center",
  },
  slotLbl: { ...FONTS.small, color: COLORS.textDim, marginBottom: 12 },
  heroAvatar: {
    width: 72, height: 72, borderRadius: 36, alignItems: "center", justifyContent: "center",
    borderWidth: 2, borderColor: COLORS.gold,
  },
  heroLetter: { color: "#fff", fontSize: 36, fontWeight: "900" },
  weaponAvatar: {
    width: 72, height: 72, borderRadius: 36, alignItems: "center", justifyContent: "center",
    borderWidth: 2, backgroundColor: "rgba(255, 140, 0, 0.1)",
  },
  slotName: { color: COLORS.text, fontWeight: "800", fontSize: 15, marginTop: 10 },
  slotChange: { color: COLORS.primary, fontSize: 11, fontWeight: "700", marginTop: 4, letterSpacing: 1 },

  mapBtn: {
    flexDirection: "row", alignItems: "center", marginHorizontal: 20, marginTop: 14,
    padding: 16, backgroundColor: COLORS.bg2, borderRadius: 14, borderWidth: 1, borderColor: COLORS.border,
  },
  mapName: { color: COLORS.text, fontSize: 20, fontWeight: "800", marginTop: 6 },
  mapDesc: { color: COLORS.textDim, fontSize: 12, marginTop: 3 },

  play: {
    marginHorizontal: 20, marginTop: 24, borderRadius: 40, overflow: "hidden",
    borderWidth: 2, borderColor: COLORS.gold,
    shadowColor: COLORS.primary, shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.6, shadowRadius: 16, elevation: 12,
  },
  playGrad: { flexDirection: "row", alignItems: "center", justifyContent: "center", paddingVertical: 20, gap: 12 },
  playTxt: { color: COLORS.text, fontWeight: "900", fontSize: 20, letterSpacing: 2 },

  quickRow: { flexDirection: "row", marginTop: 20, paddingHorizontal: 20, gap: 12 },
  qb: {
    flex: 1, alignItems: "center", padding: 14,
    backgroundColor: "rgba(35, 30, 57, 0.6)", borderRadius: 12, borderWidth: 1, borderColor: COLORS.border,
  },
  qbTxt: { ...FONTS.small, color: COLORS.textDim, marginTop: 8 },
});
