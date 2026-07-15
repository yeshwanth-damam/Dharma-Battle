import React from "react";
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { FontAwesome5 } from "@expo/vector-icons";

import { COLORS, FONTS } from "@/src/game/theme";
import { useStore } from "@/src/game/store";

export default function MapSelect() {
  const router = useRouter();
  const { config, selectedMap, setSelectedMap } = useStore();

  if (!config) return null;

  const pickAndBattle = (mapId: string) => {
    setSelectedMap(mapId);
    router.replace("/battle");
  };

  return (
    <View style={styles.root}>
      <LinearGradient colors={["#1A0A05", "#0A0C16"]} style={StyleSheet.absoluteFill} />
      <SafeAreaView style={{ flex: 1 }} edges={["top", "bottom"]}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.back} testID="map-back-btn">
            <FontAwesome5 name="chevron-left" size={16} color={COLORS.gold} />
          </TouchableOpacity>
          <Text style={styles.title}>BATTLEGROUND</Text>
          <View style={{ width: 40 }} />
        </View>

        <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
          {config.maps.map((m) => {
            const selected = selectedMap === m.id;
            return (
              <TouchableOpacity
                key={m.id}
                activeOpacity={0.88}
                onPress={() => setSelectedMap(m.id)}
                style={[styles.card, { backgroundColor: m.bg }, selected && styles.cardSel]}
                testID={`map-card-${m.id}`}
              >
                <View style={styles.overlay} />
                <View style={styles.cardInner}>
                  <View style={styles.rowTop}>
                    <Text style={styles.mName}>{m.name}</Text>
                    <View style={styles.diffRow}>
                      {[1, 2, 3].map((n) => (
                        <FontAwesome5
                          key={n}
                          name="skull"
                          size={12}
                          color={n <= m.difficulty ? COLORS.danger : "rgba(255,255,255,0.2)"}
                        />
                      ))}
                    </View>
                  </View>
                  <Text style={styles.mDesc}>{m.desc}</Text>
                  <View style={styles.rowBot}>
                    <View style={styles.chip}>
                      <FontAwesome5 name="layer-group" size={11} color={COLORS.gold} />
                      <Text style={styles.chipTxt}>{m.waves} waves</Text>
                    </View>
                    {selected && (
                      <TouchableOpacity
                        style={styles.playBtn}
                        onPress={() => pickAndBattle(m.id)}
                        testID={`map-play-${m.id}`}
                      >
                        <FontAwesome5 name="play" size={14} color="#fff" />
                        <Text style={styles.playTxt}>ENTER</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                </View>
              </TouchableOpacity>
            );
          })}
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
  card: { borderRadius: 16, marginBottom: 18, borderWidth: 1, borderColor: COLORS.border, overflow: "hidden", minHeight: 160 },
  cardSel: { borderColor: COLORS.gold, borderWidth: 2 },
  overlay: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.35)" },
  cardInner: { padding: 18 },
  rowTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  mName: { color: COLORS.gold, fontSize: 26, fontWeight: "900", letterSpacing: 2 },
  diffRow: { flexDirection: "row", gap: 4 },
  mDesc: { color: COLORS.text, fontSize: 13, marginTop: 8, fontStyle: "italic", opacity: 0.9 },
  rowBot: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 20 },
  chip: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "rgba(0,0,0,0.4)", paddingHorizontal: 10, paddingVertical: 5, borderRadius: 14 },
  chipTxt: { color: COLORS.gold, fontWeight: "700", fontSize: 12 },
  playBtn: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: COLORS.primary, paddingHorizontal: 18, paddingVertical: 10, borderRadius: 22, borderWidth: 1, borderColor: COLORS.gold },
  playTxt: { color: "#fff", fontWeight: "900", letterSpacing: 1 },
});
