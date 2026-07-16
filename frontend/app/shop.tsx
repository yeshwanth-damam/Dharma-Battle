import React, { useState, useEffect } from "react";
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator, Platform } from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { FontAwesome5 } from "@expo/vector-icons";
import * as WebBrowser from "expo-web-browser";

import { COLORS, FONTS } from "@/src/game/theme";
import { useStore } from "@/src/game/store";
import { api } from "@/src/game/api";
import { getBackendUrl } from "@/src/game/backendUrl";

type Tab = "coins" | "heroes" | "astras";

export default function Shop() {
  const router = useRouter();
  const params = useLocalSearchParams<{ session_id?: string; cancelled?: string }>();
  const { player, config, setPlayer, refresh } = useStore();
  const [tab, setTab] = useState<Tab>("coins");
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState("");
  const [pollingSid, setPollingSid] = useState<string | null>(null);

  // Handle deep link back from Stripe (?session_id=...)
  useEffect(() => {
    if (params.session_id && !pollingSid) {
      setPollingSid(String(params.session_id));
    }
    if (params.cancelled === "1") {
      setToast("Payment cancelled.");
      setTimeout(() => setToast(""), 2400);
    }
  }, [params.session_id, params.cancelled, pollingSid]);

  // Poll Stripe status
  useEffect(() => {
    if (!pollingSid) return;
    let stopped = false;
    let attempts = 0;
    const poll = async () => {
      try {
        const s = await api.stripeStatus(pollingSid);
        if (s.payment_status === "paid" && s.coins_granted) {
          await refresh();
          setToast("Payment successful — reward granted!");
          setTimeout(() => setToast(""), 3000);
          setPollingSid(null);
          return;
        }
        if (s.status === "expired") {
          setToast("Payment session expired.");
          setTimeout(() => setToast(""), 2400);
          setPollingSid(null);
          return;
        }
      } catch {
        // ignore, try again
      }
      attempts += 1;
      if (attempts >= 10 || stopped) {
        setPollingSid(null);
        return;
      }
      setTimeout(poll, 2000);
    };
    poll();
    return () => { stopped = true; };
  }, [pollingSid, refresh]);

  if (!player || !config) return null;

  const buyItem = async (type: "hero" | "weapon", id: string) => {
    setBusy(id);
    setToast("");
    try {
      const p = await api.purchase(player.id, type, id);
      setPlayer(p);
      setToast("Unlocked!");
      setTimeout(() => setToast(""), 2400);
    } catch (e: any) {
      setToast(e?.message?.includes("400") ? "Not enough coins or already owned." : "Purchase failed");
      setTimeout(() => setToast(""), 2400);
    } finally {
      setBusy(null);
    }
  };

  const buyCoins = async (packId: string) => {
    setBusy(packId);
    setToast("");
    try {
      const origin = Platform.OS === "web" && typeof window !== "undefined"
        ? window.location.origin
        : getBackendUrl();
      const resp = await api.stripeCheckout(player.id, packId, origin);
      if (Platform.OS === "web") {
        // Same-tab redirect — user returns to /shop?session_id=... after payment
        if (typeof window !== "undefined") {
          window.location.href = resp.url;
        }
      } else {
        await WebBrowser.openBrowserAsync(resp.url);
        // After browser closes, poll for status
        setPollingSid(resp.session_id);
      }
    } catch (e: any) {
      setToast(e?.message || "Failed to start checkout");
      setTimeout(() => setToast(""), 2400);
    } finally {
      setBusy(null);
    }
  };

  const packs = Object.entries(config.coin_packs);
  const premium = config.premium_pack;

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

        <View style={styles.tabsRow}>
          {(["coins", "heroes", "astras"] as Tab[]).map((t) => (
            <TouchableOpacity key={t} onPress={() => setTab(t)} style={[styles.tab, tab === t && styles.tabActive]} testID={`shop-tab-${t}`}>
              <Text style={[styles.tabTxt, tab === t && styles.tabTxtActive]}>{t.toUpperCase()}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {toast ? <Text style={styles.toast} testID="shop-toast">{toast}</Text> : null}
        {pollingSid ? <Text style={styles.polling} testID="shop-polling"><ActivityIndicator size="small" color={COLORS.gold} /> Confirming payment…</Text> : null}

        <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
          {tab === "coins" && (
            <>
              {/* Premium bundle featured */}
              {!player.premium_warrior && (
                <View style={styles.premiumCard} testID="shop-premium">
                  <View style={styles.premiumBanner}>
                    <Text style={styles.premiumTag}>★ BEST VALUE ★</Text>
                  </View>
                  <FontAwesome5 name="crown" size={38} color={COLORS.gold} style={{ marginTop: 12 }} />
                  <Text style={styles.premiumTitle}>{premium.label}</Text>
                  <Text style={styles.premiumDesc}>Unlock all 4 heroes + all 4 divine astras — forever.</Text>
                  <TouchableOpacity
                    style={styles.premiumBtn}
                    onPress={() => buyCoins("premium_warrior")}
                    disabled={busy === "premium_warrior"}
                    testID="shop-buy-premium"
                  >
                    {busy === "premium_warrior" ? <ActivityIndicator color="#fff" /> : (
                      <Text style={styles.premiumBtnTxt}>UNLOCK ALL · ${premium.amount.toFixed(2)}</Text>
                    )}
                  </TouchableOpacity>
                </View>
              )}
              {player.premium_warrior && (
                <View style={[styles.premiumCard, { borderColor: COLORS.success }]}>
                  <FontAwesome5 name="check-circle" size={32} color={COLORS.success} />
                  <Text style={[styles.premiumTitle, { color: COLORS.success }]}>Premium Warrior — Owned</Text>
                  <Text style={styles.premiumDesc}>All heroes & astras unlocked!</Text>
                </View>
              )}

              {packs.map(([id, p]) => (
                <View key={id} style={styles.packCard} testID={`shop-coin-${id}`}>
                  <View style={styles.packIcon}>
                    <FontAwesome5 name="coins" size={26} color={COLORS.gold} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.packLbl}>{p.label}</Text>
                    <Text style={styles.packSub}>+{p.coins} coins</Text>
                  </View>
                  <TouchableOpacity
                    style={styles.packBtn}
                    onPress={() => buyCoins(id)}
                    disabled={busy === id}
                    testID={`shop-buy-${id}`}
                  >
                    {busy === id ? <ActivityIndicator color="#fff" /> : (
                      <Text style={styles.packBtnTxt}>${p.usd.toFixed(2)}</Text>
                    )}
                  </TouchableOpacity>
                </View>
              ))}
            </>
          )}

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
                    onPress={() => buyItem("hero", h.id)}
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
                    onPress={() => buyItem("weapon", w.id)}
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
  coinsTxt: { color: COLORS.gold, fontFamily: "Exo2-Bold" },
  tabsRow: { flexDirection: "row", paddingHorizontal: 16, gap: 8, marginTop: 4, marginBottom: 8 },
  tab: { flex: 1, paddingVertical: 12, borderRadius: 10, backgroundColor: COLORS.bg2, borderWidth: 1, borderColor: COLORS.border, alignItems: "center" },
  tabActive: { backgroundColor: COLORS.primary, borderColor: COLORS.gold },
  tabTxt: { color: COLORS.textDim, fontFamily: "Exo2-Bold", fontSize: 12, letterSpacing: 1 },
  tabTxtActive: { color: "#fff" },
  toast: { color: COLORS.success, textAlign: "center", padding: 10, fontFamily: "Exo2-Bold" },
  polling: { color: COLORS.gold, textAlign: "center", padding: 6, fontFamily: "Exo2-Bold" },
  premiumCard: { padding: 20, borderRadius: 18, backgroundColor: "rgba(255, 140, 0, 0.08)", borderWidth: 2, borderColor: COLORS.gold, marginBottom: 20, alignItems: "center", shadowColor: COLORS.gold, shadowOpacity: 0.4, shadowRadius: 14, elevation: 10 },
  premiumBanner: { position: "absolute", top: -12, backgroundColor: COLORS.primary, paddingHorizontal: 14, paddingVertical: 5, borderRadius: 12, borderWidth: 1, borderColor: COLORS.gold },
  premiumTag: { color: "#fff", fontFamily: "Exo2-Bold", fontSize: 10, letterSpacing: 2 },
  premiumTitle: { color: COLORS.gold, fontFamily: "Cinzel-Black", fontSize: 20, letterSpacing: 2, marginTop: 12, textAlign: "center" },
  premiumDesc: { color: COLORS.textDim, fontSize: 13, fontFamily: "Exo2-Regular", textAlign: "center", marginTop: 6 },
  premiumBtn: { marginTop: 14, paddingHorizontal: 24, paddingVertical: 14, backgroundColor: COLORS.primary, borderRadius: 26, borderWidth: 2, borderColor: COLORS.gold, minWidth: 240, alignItems: "center" },
  premiumBtnTxt: { color: "#fff", fontFamily: "Cinzel-Bold", letterSpacing: 1, fontSize: 14 },
  packCard: { flexDirection: "row", alignItems: "center", padding: 14, backgroundColor: COLORS.bg2, borderRadius: 14, borderWidth: 1, borderColor: COLORS.border, marginBottom: 10, gap: 12 },
  packIcon: { width: 52, height: 52, borderRadius: 26, backgroundColor: "rgba(255, 215, 0, 0.15)", alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: COLORS.gold },
  packLbl: { color: COLORS.text, fontSize: 15, fontFamily: "Exo2-Bold" },
  packSub: { color: COLORS.gold, fontSize: 12, fontFamily: "Exo2-Bold", marginTop: 2 },
  packBtn: { paddingHorizontal: 18, paddingVertical: 12, backgroundColor: COLORS.primary, borderRadius: 10, borderWidth: 1, borderColor: COLORS.gold, alignItems: "center", minWidth: 88 },
  packBtnTxt: { color: "#fff", fontFamily: "Cinzel-Bold", letterSpacing: 1 },
  itemCard: { flexDirection: "row", alignItems: "center", padding: 12, backgroundColor: COLORS.bg2, borderRadius: 14, borderWidth: 1, borderColor: COLORS.border, marginBottom: 12, gap: 12 },
  itemAvatar: { width: 56, height: 56, borderRadius: 28, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: COLORS.gold },
  itemLtr: { color: "#fff", fontSize: 24, fontFamily: "Cinzel-Black" },
  itemName: { color: COLORS.text, fontSize: 15, fontFamily: "Exo2-Bold" },
  itemSub: { color: COLORS.textDim, fontSize: 11, marginTop: 2 },
  itemSkill: { color: COLORS.primary, fontSize: 11, marginTop: 3, fontFamily: "Exo2-Bold" },
  itemBtn: { paddingHorizontal: 14, paddingVertical: 10, backgroundColor: COLORS.primary, borderRadius: 10, borderWidth: 1, borderColor: COLORS.gold, minWidth: 88, alignItems: "center" },
  itemBtnOwned: { backgroundColor: COLORS.success, borderColor: COLORS.success },
  itemBtnTxt: { color: "#fff", fontFamily: "Cinzel-Bold", fontSize: 12, letterSpacing: 1 },
});
