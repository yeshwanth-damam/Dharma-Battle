import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, Switch } from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { FontAwesome5 } from "@expo/vector-icons";

import { COLORS, FONTS } from "@/src/game/theme";
import { settingsService, GameSettings, GraphicsQuality } from "@/src/game/settings";
import { soundService } from "@/src/game/sound";

function SliderRow({
  label,
  value,
  min,
  max,
  step,
  onChange,
  testID,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  testID: string;
}) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <View style={styles.row} testID={testID}>
      <View style={styles.rowHead}>
        <Text style={styles.rowLabel}>{label}</Text>
        <Text style={styles.rowValue}>{Math.round(value * 100)}%</Text>
      </View>
      <View style={styles.track}>
        <View style={[styles.fill, { width: `${pct}%` }]} />
      </View>
      <View style={styles.stepRow}>
        {Array.from({ length: Math.floor((max - min) / step) + 1 }, (_, i) => min + i * step).map((v) => (
          <TouchableOpacity
            key={v}
            style={[styles.stepBtn, Math.abs(v - value) < step / 2 && styles.stepBtnActive]}
            onPress={() => onChange(v)}
            testID={`${testID}-step-${v}`}
          >
            <Text style={styles.stepTxt}>{Math.round(v * 100)}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

export default function Settings() {
  const router = useRouter();
  const [settings, setSettings] = useState<GameSettings>(settingsService.get());
  const [sfxOn, setSfxOn] = useState(soundService.isEnabled());

  useEffect(() => {
    settingsService.init().then(setSettings);
  }, []);

  const patch = async (next: Partial<GameSettings>) => {
    const updated = await settingsService.update(next);
    setSettings(updated);
  };

  const toggleSfx = async () => {
    const on = await soundService.toggle();
    setSfxOn(on);
    if (on) soundService.play("pickup");
  };

  const setGraphics = (graphics: GraphicsQuality) => patch({ graphics });

  return (
    <View style={styles.root}>
      <LinearGradient colors={["#1A0A05", "#0A0C16"]} style={StyleSheet.absoluteFill} />
      <SafeAreaView style={{ flex: 1 }} edges={["top", "bottom"]}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.back} testID="settings-back-btn">
            <FontAwesome5 name="chevron-left" size={16} color={COLORS.gold} />
          </TouchableOpacity>
          <Text style={styles.title}>SETTINGS</Text>
          <View style={{ width: 40 }} />
        </View>

        <View style={styles.body}>
          <View style={styles.card}>
            <View style={styles.toggleRow}>
              <Text style={styles.rowLabel}>Sound Effects</Text>
              <Switch
                value={sfxOn}
                onValueChange={toggleSfx}
                trackColor={{ false: COLORS.border, true: COLORS.primary }}
                thumbColor={sfxOn ? COLORS.gold : "#ccc"}
                testID="settings-sfx-toggle"
              />
            </View>

            <SliderRow
              label="SFX Volume"
              value={settings.sfxVolume}
              min={0}
              max={1}
              step={0.25}
              onChange={(sfxVolume) => patch({ sfxVolume })}
              testID="settings-sfx-volume"
            />

            <SliderRow
              label="Music Volume"
              value={settings.musicVolume}
              min={0}
              max={1}
              step={0.25}
              onChange={(musicVolume) => patch({ musicVolume })}
              testID="settings-music-volume"
            />
          </View>

          <View style={styles.card}>
            <SliderRow
              label="Joystick Sensitivity"
              value={settings.sensitivity}
              min={0.5}
              max={1.5}
              step={0.25}
              onChange={(sensitivity) => patch({ sensitivity })}
              testID="settings-sensitivity"
            />
          </View>

          <View style={styles.card}>
            <Text style={styles.rowLabel}>Graphics Quality</Text>
            <View style={styles.qualityRow}>
              {(["low", "high"] as GraphicsQuality[]).map((q) => (
                <TouchableOpacity
                  key={q}
                  style={[styles.qualityBtn, settings.graphics === q && styles.qualityBtnActive]}
                  onPress={() => setGraphics(q)}
                  testID={`settings-graphics-${q}`}
                >
                  <Text style={[styles.qualityTxt, settings.graphics === q && styles.qualityTxtActive]}>
                    {q.toUpperCase()}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12, gap: 12 },
  back: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: COLORS.bg2, borderWidth: 1, borderColor: COLORS.border },
  title: { ...FONTS.h3, flex: 1, textAlign: "center", color: COLORS.gold },
  body: { padding: 20, gap: 16 },
  card: { backgroundColor: COLORS.bg2, borderRadius: 14, borderWidth: 1, borderColor: COLORS.border, padding: 16, gap: 16 },
  row: { gap: 8 },
  rowHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  rowLabel: { color: COLORS.text, fontWeight: "700", fontSize: 15 },
  rowValue: { color: COLORS.gold, fontWeight: "800", fontSize: 13 },
  track: { height: 8, backgroundColor: "rgba(255,255,255,0.1)", borderRadius: 4, overflow: "hidden" },
  fill: { height: "100%", backgroundColor: COLORS.gold },
  stepRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 4 },
  stepBtn: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: COLORS.border },
  stepBtnActive: { borderColor: COLORS.gold, backgroundColor: "rgba(255, 140, 0, 0.15)" },
  stepTxt: { color: COLORS.textDim, fontSize: 11, fontWeight: "700" },
  toggleRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  qualityRow: { flexDirection: "row", gap: 12, marginTop: 12 },
  qualityBtn: { flex: 1, paddingVertical: 14, borderRadius: 10, borderWidth: 1, borderColor: COLORS.border, alignItems: "center" },
  qualityBtnActive: { borderColor: COLORS.gold, backgroundColor: "rgba(255, 140, 0, 0.15)" },
  qualityTxt: { color: COLORS.textDim, fontWeight: "800", letterSpacing: 1 },
  qualityTxtActive: { color: COLORS.gold },
});
