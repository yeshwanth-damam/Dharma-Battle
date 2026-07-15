import React, { useEffect } from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { FontAwesome5 } from "@expo/vector-icons";

import { COLORS } from "@/src/game/theme";
import { useStore } from "@/src/game/store";

export default function Results() {
  const router = useRouter();
  const params = useLocalSearchParams<{ victory: string; kills: string; seconds: string; newCoins: string; newLevel: string; newXp: string }>();
  const { refresh } = useStore();

  const victory = params.victory === "1";
  const kills = Number(params.kills || 0);
  const seconds = Number(params.seconds || 0);
  const coinReward = kills * 10 + (victory ? 50 : 10);
  const xpReward = kills * 15 + (victory ? 100 : 25);
  const score = kills * 100 + seconds * 2 + (victory ? 500 : 0);

  useEffect(() => { refresh(); }, [refresh]);

  return (
    <View style={styles.root}>
      <LinearGradient
        colors={victory ? ["#3E2723", "#0A0C16"] : ["#3E0A0A", "#0A0C16"]}
        style={StyleSheet.absoluteFill}
      />
      <SafeAreaView style={{ flex: 1 }} edges={["top", "bottom"]}>
        <View style={styles.wrap}>
          <View style={[styles.crest, { backgroundColor: victory ? "rgba(76, 175, 80, 0.15)" : "rgba(220, 20, 60, 0.15)", borderColor: victory ? COLORS.success : COLORS.danger }]}>
            <FontAwesome5 name={victory ? "crown" : "khanda"} size={54} color={victory ? COLORS.gold : COLORS.danger} />
          </View>
          <Text style={[styles.title, { color: victory ? COLORS.gold : COLORS.danger }]} testID="result-title">
            {victory ? "VICTORY" : "DEFEAT"}
          </Text>
          <Text style={styles.subtitle}>
            {victory ? "The dharma prevails, warrior." : "Your dharma shall rise again."}
          </Text>

          <View style={styles.card}>
            <Row label="Kills" value={String(kills)} icon="skull-crossbones" color={COLORS.danger} testID="result-kills" />
            <Row label="Survived" value={`${seconds}s`} icon="clock" color={COLORS.primary} testID="result-time" />
            <Row label="Battle Score" value={String(score)} icon="star" color={COLORS.gold} testID="result-score" />
          </View>

          <View style={styles.rewards}>
            <View style={styles.reward}>
              <FontAwesome5 name="coins" size={20} color={COLORS.gold} />
              <Text style={styles.rewardVal}>+{coinReward}</Text>
              <Text style={styles.rewardLbl}>COINS</Text>
            </View>
            <View style={styles.reward}>
              <FontAwesome5 name="star" size={20} color={COLORS.primary} />
              <Text style={styles.rewardVal}>+{xpReward}</Text>
              <Text style={styles.rewardLbl}>XP</Text>
            </View>
          </View>

          <View style={styles.btnRow}>
            <TouchableOpacity style={[styles.btn, styles.btnSec]} onPress={() => router.replace("/lobby")} testID="result-home-btn">
              <FontAwesome5 name="home" size={16} color={COLORS.gold} />
              <Text style={styles.btnSecTxt}>LOBBY</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.btn} onPress={() => router.replace("/battle")} testID="result-again-btn">
              <LinearGradient colors={[COLORS.primary, COLORS.primaryDark]} style={styles.btnGrad}>
                <FontAwesome5 name="redo" size={16} color="#fff" />
                <Text style={styles.btnTxt}>PLAY AGAIN</Text>
              </LinearGradient>
            </TouchableOpacity>
          </View>
        </View>
      </SafeAreaView>
    </View>
  );
}

function Row({ label, value, icon, color, testID }: any) {
  return (
    <View style={styles.row} testID={testID}>
      <View style={styles.rowLeft}>
        <FontAwesome5 name={icon} size={16} color={color} />
        <Text style={styles.rowLbl}>{label}</Text>
      </View>
      <Text style={styles.rowVal}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg },
  wrap: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  crest: { width: 120, height: 120, borderRadius: 60, alignItems: "center", justifyContent: "center", borderWidth: 3, marginBottom: 16 },
  title: { fontSize: 54, fontWeight: "900", letterSpacing: 6, textShadowColor: "rgba(255,215,0,0.4)", textShadowRadius: 20 },
  subtitle: { color: COLORS.textDim, fontSize: 15, fontStyle: "italic", marginTop: 6, marginBottom: 28 },
  card: { width: "100%", backgroundColor: COLORS.bg2, borderRadius: 14, padding: 18, borderWidth: 1, borderColor: COLORS.border },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 8 },
  rowLeft: { flexDirection: "row", alignItems: "center", gap: 12 },
  rowLbl: { color: COLORS.textDim, fontSize: 14, fontWeight: "700" },
  rowVal: { color: COLORS.text, fontSize: 18, fontWeight: "900" },
  rewards: { flexDirection: "row", gap: 12, marginTop: 20, width: "100%" },
  reward: { flex: 1, backgroundColor: COLORS.bg2, borderRadius: 14, padding: 18, alignItems: "center", borderWidth: 1, borderColor: COLORS.border },
  rewardVal: { color: COLORS.gold, fontSize: 26, fontWeight: "900", marginTop: 6 },
  rewardLbl: { color: COLORS.textDim, fontSize: 10, letterSpacing: 1.5, fontWeight: "800", marginTop: 2 },
  btnRow: { flexDirection: "row", gap: 12, marginTop: 32, width: "100%" },
  btn: { flex: 1, borderRadius: 26, overflow: "hidden", borderWidth: 2, borderColor: COLORS.gold },
  btnSec: { backgroundColor: COLORS.bg2, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 8, paddingVertical: 14 },
  btnSecTxt: { color: COLORS.gold, fontWeight: "900", letterSpacing: 1 },
  btnGrad: { flexDirection: "row", alignItems: "center", justifyContent: "center", paddingVertical: 14, gap: 8 },
  btnTxt: { color: "#fff", fontWeight: "900", letterSpacing: 1 },
});
