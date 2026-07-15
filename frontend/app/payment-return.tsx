// Payment-return route: Stripe redirects users here after checkout.
// Reads ?session_id=... and forwards to /shop (which will poll status).
import React, { useEffect } from "react";
import { View, Text, StyleSheet, ActivityIndicator } from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { COLORS } from "@/src/game/theme";

export default function PaymentReturn() {
  const router = useRouter();
  const params = useLocalSearchParams<{ session_id?: string; cancelled?: string }>();

  useEffect(() => {
    const sid = params.session_id ? String(params.session_id) : "";
    const cancelled = params.cancelled === "1" ? "1" : "";
    router.replace({
      pathname: "/shop",
      params: { session_id: sid, cancelled },
    });
  }, [params.session_id, params.cancelled, router]);

  return (
    <View style={styles.root}>
      <ActivityIndicator color={COLORS.gold} size="large" />
      <Text style={styles.txt}>Returning to shop…</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg, alignItems: "center", justifyContent: "center", gap: 14 },
  txt: { color: COLORS.gold, fontFamily: "Exo2-Bold", letterSpacing: 1 },
});
