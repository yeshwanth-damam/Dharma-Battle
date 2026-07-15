import React, { useEffect, useRef } from "react";
import { View, Text, StyleSheet, TouchableOpacity, Animated, ActivityIndicator } from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { FontAwesome5 } from "@expo/vector-icons";

import { COLORS, FONTS } from "@/src/game/theme";
import { useStore } from "@/src/game/store";

export default function Index() {
  const router = useRouter();
  const { player, loading } = useStore();
  const pulse = useRef(new Animated.Value(1)).current;
  const glow = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1.08, duration: 900, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 900, useNativeDriver: true }),
      ]),
    ).start();
    Animated.loop(
      Animated.sequence([
        Animated.timing(glow, { toValue: 1, duration: 1400, useNativeDriver: true }),
        Animated.timing(glow, { toValue: 0.3, duration: 1400, useNativeDriver: true }),
      ]),
    ).start();
  }, [pulse, glow]);

  const handleStart = () => {
    if (player) router.replace("/lobby");
    else router.replace("/onboarding");
  };

  if (loading) {
    return (
      <View style={styles.loader}>
        <ActivityIndicator size="large" color={COLORS.gold} />
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <LinearGradient
        colors={["#1A0A05", "#0A0C16", "#0A0C16"]}
        style={StyleSheet.absoluteFill}
      />
      {/* Mandala rings decoration */}
      <Animated.View style={[styles.ring, styles.ring1, { opacity: glow, transform: [{ scale: pulse }] }]} />
      <Animated.View style={[styles.ring, styles.ring2, { opacity: glow }]} />

      <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
        <View style={styles.top}>
          <Text style={styles.tag} testID="splash-tag">EPIC MYTHOLOGY BATTLE</Text>
        </View>

        <View style={styles.center}>
          <Animated.View style={{ transform: [{ scale: pulse }] }}>
            <Text style={styles.titleTop} testID="splash-title-top">DHARMA</Text>
            <Text style={styles.titleBottom} testID="splash-title-bottom">BATTLE</Text>
          </Animated.View>
          <Text style={styles.subtitle}>Where warriors of legend clash</Text>

          <TouchableOpacity
            activeOpacity={0.85}
            style={styles.cta}
            onPress={handleStart}
            testID="tap-to-start-btn"
          >
            <LinearGradient
              colors={[COLORS.primary, COLORS.primaryDark]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.ctaGrad}
            >
              <FontAwesome5 name="fire" size={20} color={COLORS.text} />
              <Text style={styles.ctaText}>{player ? "ENTER BATTLE" : "TAP TO BEGIN"}</Text>
            </LinearGradient>
          </TouchableOpacity>

          {player ? (
            <Text style={styles.welcome}>Namaste, {player.name}</Text>
          ) : null}
        </View>

        <View style={styles.bottom}>
          <TouchableOpacity style={styles.iconBtn} onPress={() => router.push("/settings")} testID="splash-settings-btn">
            <FontAwesome5 name="cog" size={20} color={COLORS.gold} />
            <Text style={styles.iconLbl}>Settings</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.iconBtn} onPress={() => router.push("/leaderboard")} testID="splash-leaderboard-btn">
            <FontAwesome5 name="trophy" size={20} color={COLORS.gold} />
            <Text style={styles.iconLbl}>Ranks</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.iconBtn} onPress={() => player ? router.push("/shop") : router.replace("/onboarding")} testID="splash-shop-btn">
            <FontAwesome5 name="store" size={20} color={COLORS.gold} />
            <Text style={styles.iconLbl}>Shop</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.iconBtn} onPress={() => player ? router.push("/profile") : router.replace("/onboarding")} testID="splash-profile-btn">
            <FontAwesome5 name="user-shield" size={20} color={COLORS.gold} />
            <Text style={styles.iconLbl}>Warrior</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg },
  loader: { flex: 1, backgroundColor: COLORS.bg, justifyContent: "center", alignItems: "center" },
  safe: { flex: 1, paddingHorizontal: 24 },
  top: { alignItems: "center", paddingTop: 24 },
  tag: { ...FONTS.small, color: COLORS.primary, letterSpacing: 4 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  titleTop: {
    fontSize: 62, fontWeight: "900", color: COLORS.gold, letterSpacing: 8, textAlign: "center",
    textShadowColor: "rgba(255, 87, 34, 0.6)", textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 20,
  },
  titleBottom: {
    fontSize: 62, fontWeight: "900", color: COLORS.primary, letterSpacing: 8, textAlign: "center", marginTop: -8,
    textShadowColor: "rgba(255, 215, 0, 0.5)", textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 20,
  },
  subtitle: { ...FONTS.body, color: COLORS.textDim, fontStyle: "italic", marginTop: 12, marginBottom: 60 },
  cta: {
    borderRadius: 40, overflow: "hidden", borderWidth: 2, borderColor: COLORS.gold,
    shadowColor: COLORS.primary, shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.6, shadowRadius: 16, elevation: 12,
  },
  ctaGrad: { flexDirection: "row", alignItems: "center", justifyContent: "center", paddingVertical: 18, paddingHorizontal: 44, gap: 12 },
  ctaText: { ...FONTS.h3, color: COLORS.text, letterSpacing: 2 },
  welcome: { ...FONTS.small, color: COLORS.gold, marginTop: 20 },
  bottom: { flexDirection: "row", justifyContent: "space-around", paddingBottom: 12 },
  iconBtn: {
    alignItems: "center", padding: 12, minWidth: 84,
    backgroundColor: "rgba(35, 30, 57, 0.6)", borderRadius: 12, borderWidth: 1, borderColor: COLORS.border,
  },
  iconLbl: { ...FONTS.small, marginTop: 6, color: COLORS.textDim },
  ring: {
    position: "absolute", borderWidth: 1, borderColor: COLORS.primary, borderRadius: 999,
  },
  ring1: { width: 480, height: 480, top: "20%", left: "-15%" },
  ring2: { width: 320, height: 320, top: "30%", right: "-25%", borderColor: COLORS.gold },
});
