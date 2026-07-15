import React, { useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator } from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { FontAwesome5 } from "@expo/vector-icons";

import { COLORS, FONTS } from "@/src/game/theme";
import { useStore } from "@/src/game/store";
import { api } from "@/src/game/api";

type Tab = "coins" | "heroes" | "astras";

export default function Shop() {
  const router = useRouter();
  const { player, config, setPlayer } = useStore();
  const [tab, setTab] = useState<Tab>("coins");
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState("");

  if (!player || !config) return null;

  const buy = async (type: "hero" | "weapon" | "coins", id: string) => {
    setBusy(id);
    setToast("");
    try {
      const p = await api.purchase(player.id, type, id);
      setPlayer(p);
      setToast(type === "coins" ? "Coins added to your treasury!" : "Unlocked! Head to the lobby to equip.");
      setTimeout(() => setToast(""), 2400);
    } catch (e: any) {
      setToast(e?.message?.includes("400") ? "Cannot purchase — not enough coins or already owned." : "Purchase failed");
      setTimeout(() => setToast(""), 2400);
    } finally {
      setBusy(null);
    }
  };

  const packs = Object.entries(config.coin_packs);

  return (
    <View style={styles.root}>
      <LinearGradient colors={["#1A0A05", "#0A0C16"]} style={StyleSheet.absoluteFill} />
      <SafeAreaView style={{ flex: 1 }} edges={["top", "bottom"]}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.back} testID="shop-back-btn">
            <FontAwesome5 name="chevron-left" size={16} color={COLORS.gold} />
          </TouchableOpacity>
          <Text style={styles.title}>MARKET OF LEGENDS</Text>
          <View style={styles.coins}>
            <FontAwesome5 name="coins" size={12} color={COLORS.gold} />
            <Text style={styles.coinsTxt} testID="shop-coins">{player.coins}</Text>
          </View>
        </View>

        {/* Tabs */}
        <View style={styles.tabsRow}>
          {(["coins", "heroes", "astras"] as Tab[]).map((t) => (
            <TouchableOpacity
              key={t}
              onPress={() => setTab(t)}
              style={[styles.tab, tab === t && styles.tabActive]}
              testID={`shop-tab-${t}`}
            >
              <Text style={[styles.tabTxt, tab === t && styles.tabTxtActive]}>{t.toUpperCase()}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {toast ? <Text style={styles.toast} testID="shop-toast">{toast}</Text> : null}

        <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
          {tab === "coins" &&
            packs.map(([id, p]) => (
              <View key={id} style={styles.packCard} testID={`shop-coin-${id}`}>
                <View style={styles.packIcon}>
                  <FontAwesome5 name="coins" size={28} color={COLORS.gold} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.packLbl}>{p.label}</Text>
                  <Text style={styles.packSub}>+{p.coins} coins</Text>
                </View>
                <TouchableOpacity
                  style={styles.packBtn}
                  onPress={() => buy("coins", id)}
                  disabled={busy === id}
                  testID={`shop-buy-${id}`}
                >
                  {busy === id ? <ActivityIndicator color="#fff" /> : (
                    <>
                      <Text style={styles.packBtnTxt}>CLAIM</Text>
                      <Text style={styles.packBtnSub}>MOCK IAP</Text>
                    </>
                  )}
                </TouchableOpacity>
              </View>
            ))}

          {tab === "heroes" &&
            config.heroes.map((h) => {
              const owned = player.owned_heroes.includes(h.id);
              return (
                <View key={h.id} style={styles.itemCard} testID={`shop-hero-${h.id}`}>
                  <View style={[styles.itemAvatar, { backgroundColor: h.color }]}>
                    <Text style={styles.itemLtr}>{h.letter}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.itemName}>{h.name}</Text>
                    <Text style={styles.itemSub}>{h.title}</Text>
                    <Text style={styles.itemSkill}>✦ {h.skill}</Text>
                  </View>
                  <TouchableOpacity
                    style={[styles.itemBtn, owned && styles.itemBtnOwned]}
                    disabled={owned || busy === h.id}
                    onPress={() => buy("hero", h.id)}
                    testID={`shop-buy-hero-${h.id}`}
                  >
                    {busy === h.id ? <ActivityIndicator color="#fff" /> : (
                      <Text style={styles.itemBtnTxt}>{owned ? "OWNED" : `⚱ ${h.price}`}</Text>
                    )}
                  </TouchableOpacity>
                </View>
              );
            })}

          {tab === "astras" &&
            config.weapons.map((w) => {
              const owned = player.owned_weapons.includes(w.id);
              return (
                <View key={w.id} style={styles.itemCard} testID={`shop-weapon-${w.id}`}>
                  <View style={[styles.itemAvatar, { backgroundColor: w.color }]}>
                    <FontAwesome5 name="fire" size={22} color="#fff" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.itemName}>{w.name}</Text>
                    <Text style={styles.itemSub}>{w.desc}</Text>
                    <Text style={styles.itemSkill}>⚡ {w.damage} · ⏱ {w.cooldown}s</Text>
                  </View>
                  <TouchableOpacity
                    style={[styles.itemBtn, owned && styles.itemBtnOwned]}
                    disabled={owned || busy === w.id}
                    onPress={() => buy("weapon", w.id)}
                    testID={`shop-buy-weapon-${w.id}`}
                  >
                    {busy === w.id ? <ActivityIndicator color="#fff" /> : (
                      <Text style={styles.itemBtnTxt}>{owned ? "OWNED" : `⚱ ${w.price}`}</Text>
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

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12, gap: 12 },
  back: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: COLORS.bg2, borderWidth: 1, borderColor: COLORS.border },
  title: { ...FONTS.h3, flex: 1, textAlign: "center", color: COLORS.gold },
  coins: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 14, backgroundColor: "rgba(255, 215, 0, 0.1)", borderWidth: 1, borderColor: COLORS.gold },
  coinsTxt: { color: COLORS.gold, fontWeight: "800" },
  tabsRow: { flexDirection: "row", paddingHorizontal: 16, gap: 8, marginTop: 4, marginBottom: 8 },
  tab: { flex: 1, paddingVertical: 12, borderRadius: 10, backgroundColor: COLORS.bg2, borderWidth: 1, borderColor: COLORS.border, alignItems: "center" },
  tabActive: { backgroundColor: COLORS.primary, borderColor: COLORS.gold },
  tabTxt: { color: COLORS.textDim, fontWeight: "800", fontSize: 12, letterSpacing: 1 },
  tabTxtActive: { color: "#fff" },
  toast: { color: COLORS.success, textAlign: "center", padding: 10, fontWeight: "700" },
  packCard: { flexDirection: "row", alignItems: "center", padding: 16, backgroundColor: COLORS.bg2, borderRadius: 14, borderWidth: 1, borderColor: COLORS.border, marginBottom: 12, gap: 14 },
  packIcon: { width: 56, height: 56, borderRadius: 28, backgroundColor: "rgba(255, 215, 0, 0.15)", alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: COLORS.gold },
  packLbl: { color: COLORS.text, fontSize: 16, fontWeight: "800" },
  packSub: { color: COLORS.gold, fontSize: 13, fontWeight: "700", marginTop: 2 },
  packBtn: { paddingHorizontal: 18, paddingVertical: 12, backgroundColor: COLORS.primary, borderRadius: 10, borderWidth: 1, borderColor: COLORS.gold, alignItems: "center" },
  packBtnTxt: { color: "#fff", fontWeight: "900", letterSpacing: 1 },
  packBtnSub: { color: "rgba(255,255,255,0.7)", fontSize: 8, letterSpacing: 1, marginTop: 2 },
  itemCard: { flexDirection: "row", alignItems: "center", padding: 12, backgroundColor: COLORS.bg2, borderRadius: 14, borderWidth: 1, borderColor: COLORS.border, marginBottom: 12, gap: 12 },
  itemAvatar: { width: 56, height: 56, borderRadius: 28, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: COLORS.gold },
  itemLtr: { color: "#fff", fontSize: 24, fontWeight: "900" },
  itemName: { color: COLORS.text, fontSize: 16, fontWeight: "800" },
  itemSub: { color: COLORS.textDim, fontSize: 11, marginTop: 2 },
  itemSkill: { color: COLORS.primary, fontSize: 11, marginTop: 3, fontWeight: "700" },
  itemBtn: { paddingHorizontal: 14, paddingVertical: 10, backgroundColor: COLORS.primary, borderRadius: 10, borderWidth: 1, borderColor: COLORS.gold, minWidth: 88, alignItems: "center" },
  itemBtnOwned: { backgroundColor: COLORS.success, borderColor: COLORS.success },
  itemBtnTxt: { color: "#fff", fontWeight: "900", fontSize: 12, letterSpacing: 1 },
});
