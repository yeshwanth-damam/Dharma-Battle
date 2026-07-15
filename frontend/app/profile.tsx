import React from "react";
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { FontAwesome5 } from "@expo/vector-icons";

import { COLORS, FONTS } from "@/src/game/theme";
import { useStore } from "@/src/game/store";

function xpForNext(level: number) { return 100 + (level - 1) * 75; }

export default function Profile() {
  const router = useRouter();
  const { player, config, logout } = useStore();

  if (!player || !config) return null;
  const hero = config.heroes.find((h) => h.id === player.selected_hero);
  const xpMax = xpForNext(player.level);
  const winrate = player.matches > 0 ? Math.round((player.wins / player.matches) * 100) : 0;

  return (
    <View style={styles.root}>
      <LinearGradient colors={["#1A0A05", "#0A0C16"]} style={StyleSheet.absoluteFill} />
      <SafeAreaView style={{ flex: 1 }} edges={["top", "bottom"]}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.back} testID="profile-back-btn">
            <FontAwesome5 name="chevron-left" size={16} color={COLORS.gold} />
          </TouchableOpacity>
          <Text style={styles.title}>WARRIOR PROFILE</Text>
          <View style={{ width: 40 }} />
        </View>

        <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
          {/* Hero card */}
          <View style={styles.heroCard}>
            <View style={[styles.avatar, { backgroundColor: hero?.color || COLORS.primary }]}>
              <Text style={styles.avatarLtr}>{hero?.letter || "?"}</Text>
            </View>
            <Text style={styles.name} testID="profile-name">{player.name}</Text>
            <Text style={styles.heroName}>{hero?.name} — {hero?.title}</Text>

            <View style={styles.lvlRow}>
              <Text style={styles.lvlLbl}>LEVEL {player.level}</Text>
              <View style={styles.xpBar}>
                <View style={[styles.xpFill, { width: `${Math.min(100, (player.xp / xpMax) * 100)}%` }]} />
              </View>
              <Text style={styles.xpTxt}>{player.xp} / {xpMax} XP</Text>
            </View>
          </View>

          {/* Stats */}
          <View style={styles.statsGrid}>
            <StatCard icon="coins" label="Coins" value={String(player.coins)} color={COLORS.gold} testID="profile-stat-coins" />
            <StatCard icon="skull-crossbones" label="Kills" value={String(player.kills)} color={COLORS.danger} testID="profile-stat-kills" />
            <StatCard icon="trophy" label="Wins" value={`${player.wins}/${player.matches}`} color={COLORS.success} testID="profile-stat-wins" />
            <StatCard icon="percentage" label="Winrate" value={`${winrate}%`} color={COLORS.primary} testID="profile-stat-winrate" />
            <StatCard icon="star" label="Best Score" value={String(player.best_score)} color={COLORS.gold} testID="profile-stat-score" />
            <StatCard icon="user-shield" label="Heroes" value={String(player.owned_heroes.length)} color={COLORS.primary} testID="profile-stat-heroes" />
          </View>

          {/* Logout */}
          <TouchableOpacity
            style={styles.logout}
            onPress={async () => { await logout(); router.replace("/"); }}
            testID="profile-logout-btn"
          >
            <FontAwesome5 name="sign-out-alt" size={14} color={COLORS.danger} />
            <Text style={styles.logoutTxt}>END WARRIOR JOURNEY</Text>
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

function StatCard({ icon, label, value, color, testID }: any) {
  return (
    <View style={styles.sc} testID={testID}>
      <FontAwesome5 name={icon} size={20} color={color} />
      <Text style={styles.scVal}>{value}</Text>
      <Text style={styles.scLbl}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12, gap: 12 },
  back: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: COLORS.bg2, borderWidth: 1, borderColor: COLORS.border },
  title: { ...FONTS.h3, flex: 1, textAlign: "center", color: COLORS.gold },
  heroCard: { alignItems: "center", padding: 24, backgroundColor: COLORS.bg2, borderRadius: 16, borderWidth: 1, borderColor: COLORS.border },
  avatar: { width: 108, height: 108, borderRadius: 54, alignItems: "center", justifyContent: "center", borderWidth: 3, borderColor: COLORS.gold, shadowColor: COLORS.gold, shadowOpacity: 0.5, shadowRadius: 20, elevation: 10 },
  avatarLtr: { color: "#fff", fontSize: 52, fontWeight: "900" },
  name: { color: COLORS.gold, fontSize: 26, fontWeight: "900", letterSpacing: 2, marginTop: 14 },
  heroName: { color: COLORS.textDim, fontSize: 13, fontStyle: "italic", marginTop: 4 },
  lvlRow: { width: "100%", marginTop: 18 },
  lvlLbl: { color: COLORS.primary, fontSize: 12, fontWeight: "900", letterSpacing: 2, textAlign: "center" },
  xpBar: { height: 10, backgroundColor: "rgba(255,255,255,0.08)", borderRadius: 5, marginTop: 6, overflow: "hidden" },
  xpFill: { height: "100%", backgroundColor: COLORS.gold },
  xpTxt: { color: COLORS.textDim, fontSize: 11, marginTop: 6, textAlign: "center" },
  statsGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 20 },
  sc: { width: "31%", padding: 14, backgroundColor: COLORS.bg2, borderRadius: 12, borderWidth: 1, borderColor: COLORS.border, alignItems: "center" },
  scVal: { color: COLORS.text, fontSize: 18, fontWeight: "900", marginTop: 6 },
  scLbl: { color: COLORS.textDim, fontSize: 10, letterSpacing: 1, fontWeight: "700", marginTop: 3, textAlign: "center" },
  logout: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, padding: 14, marginTop: 30, borderRadius: 12, borderWidth: 1, borderColor: COLORS.danger, backgroundColor: "rgba(220, 20, 60, 0.08)" },
  logoutTxt: { color: COLORS.danger, fontWeight: "800", letterSpacing: 1, fontSize: 12 },
});
