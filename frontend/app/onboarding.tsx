import React, { useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, TextInput, KeyboardAvoidingView, Platform, ActivityIndicator } from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { FontAwesome5 } from "@expo/vector-icons";

import { COLORS, FONTS } from "@/src/game/theme";
import { useStore } from "@/src/game/store";

export default function Onboarding() {
  const router = useRouter();
  const { createPlayer } = useStore();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const start = async () => {
    const clean = name.trim();
    if (clean.length < 2) {
      setErr("Warrior name must be at least 2 characters.");
      return;
    }
    setBusy(true);
    setErr("");
    try {
      await createPlayer(clean);
      router.replace("/lobby");
    } catch (e: any) {
      setErr(e?.message || "Failed to create warrior");
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.root}>
      <LinearGradient colors={["#1A0A05", "#0A0C16", "#0A0C16"]} style={StyleSheet.absoluteFill} />
      <SafeAreaView style={{ flex: 1 }} edges={["top", "bottom"]}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.wrap}>
          <View style={styles.badge}>
            <FontAwesome5 name="dharmachakra" size={44} color={COLORS.gold} />
          </View>
          <Text style={styles.title}>NAME THY WARRIOR</Text>
          <Text style={styles.sub}>Only the named enter the sacred battlefield.</Text>

          <View style={styles.inputWrap}>
            <FontAwesome5 name="user-shield" size={18} color={COLORS.gold} />
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder="e.g. Arjuna"
              placeholderTextColor={COLORS.textDim}
              style={styles.input}
              maxLength={20}
              autoCapitalize="words"
              testID="onboarding-name-input"
            />
          </View>

          {err ? <Text style={styles.err} testID="onboarding-error">{err}</Text> : null}

          <TouchableOpacity
            activeOpacity={0.85}
            onPress={start}
            disabled={busy}
            style={[styles.cta, busy && { opacity: 0.6 }]}
            testID="onboarding-begin-btn"
          >
            <LinearGradient colors={[COLORS.primary, COLORS.primaryDark]} style={styles.ctaGrad}>
              {busy ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <>
                  <FontAwesome5 name="fire" size={18} color={COLORS.text} />
                  <Text style={styles.ctaText}>BEGIN QUEST</Text>
                </>
              )}
            </LinearGradient>
          </TouchableOpacity>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg },
  wrap: { flex: 1, justifyContent: "center", alignItems: "center", paddingHorizontal: 32 },
  badge: {
    width: 96, height: 96, borderRadius: 48, borderWidth: 2, borderColor: COLORS.gold,
    alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255, 215, 0, 0.08)", marginBottom: 24,
  },
  title: { ...FONTS.h2, color: COLORS.gold, textAlign: "center" },
  sub: { ...FONTS.body, color: COLORS.textDim, textAlign: "center", marginTop: 10, marginBottom: 40 },
  inputWrap: {
    width: "100%", flexDirection: "row", alignItems: "center", gap: 12,
    backgroundColor: COLORS.bg2, borderWidth: 1, borderColor: COLORS.border, borderRadius: 12, paddingHorizontal: 16,
  },
  input: { flex: 1, color: COLORS.text, fontSize: 18, paddingVertical: 16 },
  err: { color: COLORS.danger, marginTop: 12, ...FONTS.small },
  cta: {
    marginTop: 32, width: "100%", borderRadius: 30, overflow: "hidden", borderWidth: 2, borderColor: COLORS.gold,
    shadowColor: COLORS.primary, shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.5, shadowRadius: 12, elevation: 8,
  },
  ctaGrad: { flexDirection: "row", alignItems: "center", justifyContent: "center", paddingVertical: 18, gap: 10 },
  ctaText: { ...FONTS.h3, color: COLORS.text, letterSpacing: 2 },
});
