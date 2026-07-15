import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { View, Text, StyleSheet, TouchableOpacity, Dimensions, PanResponder } from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { FontAwesome5 } from "@expo/vector-icons";

import { COLORS, FONTS } from "@/src/game/theme";
import { useStore } from "@/src/game/store";
import { api } from "@/src/game/api";

type V = { x: number; y: number };
type Enemy = { id: number; pos: V; hp: number; maxHp: number; radius: number; speed: number; damage: number; color: string; type: "grunt" | "brute" | "swift" };
type Bullet = { id: number; pos: V; vel: V; life: number; damage: number; color: string };
type Particle = { id: number; pos: V; life: number; color: string };

const WIN = Dimensions.get("window");
const HUD_TOP = 90;
const HUD_BOTTOM = 190;

function len(v: V) { return Math.hypot(v.x, v.y); }
function norm(v: V): V { const l = len(v) || 1; return { x: v.x / l, y: v.y / l }; }

export default function Battle() {
  const router = useRouter();
  const { player, config, selectedMap } = useStore();

  const heroObj = useMemo(() => config?.heroes.find((h) => h.id === player?.selected_hero), [config, player]);
  const weaponObj = useMemo(() => config?.weapons.find((w) => w.id === player?.selected_weapon), [config, player]);
  const mapObj = useMemo(() => config?.maps.find((m) => m.id === selectedMap), [config, selectedMap]);

  // Arena dimensions
  const arenaTop = HUD_TOP;
  const arenaBottom = WIN.height - HUD_BOTTOM;
  const arenaLeft = 0;
  const arenaRight = WIN.width;
  const arenaW = arenaRight - arenaLeft;
  const arenaH = arenaBottom - arenaTop;

  // Refs (mutable state used inside the game loop)
  const playerRef = useRef<V>({ x: arenaW / 2, y: arenaH / 2 });
  const playerHpRef = useRef<number>(heroObj?.hp || 100);
  const maxHpRef = useRef<number>(heroObj?.hp || 100);
  const joystickRef = useRef<V>({ x: 0, y: 0 });
  const enemiesRef = useRef<Enemy[]>([]);
  const bulletsRef = useRef<Bullet[]>([]);
  const particlesRef = useRef<Particle[]>([]);
  const fireCdRef = useRef<number>(0);
  const enemySpawnRef = useRef<number>(0);
  const waveRef = useRef<number>(1);
  const enemiesInWaveRef = useRef<number>(0);
  const enemiesLeftRef = useRef<number>(0);
  const killsRef = useRef<number>(0);
  const elapsedRef = useRef<number>(0);
  const gameOverRef = useRef<boolean>(false);
  const uniqRef = useRef<number>(1);

  const [, setTick] = useState(0);
  const [paused, setPaused] = useState(false);
  const pausedRef = useRef(false);
  const [, setStatus] = useState<"playing" | "victory" | "defeat">("playing");

  // Initialize wave 1
  const startWave = useCallback((w: number) => {
    waveRef.current = w;
    const count = 4 + w * 2;
    enemiesInWaveRef.current = count;
    enemiesLeftRef.current = count;
  }, []);

  useEffect(() => {
    if (heroObj) {
      maxHpRef.current = heroObj.hp;
      playerHpRef.current = heroObj.hp;
    }
    startWave(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [heroObj?.id]);

  // Joystick
  const joyBaseX = 80;
  const joyBaseY = WIN.height - 110;
  const [joyKnob, setJoyKnob] = useState<V>({ x: 0, y: 0 });
  const joyPan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderMove: (_, g) => {
        const dx = g.dx;
        const dy = g.dy;
        const dist = Math.hypot(dx, dy);
        const max = 44;
        const k = dist > max ? max / dist : 1;
        const knob = { x: dx * k, y: dy * k };
        setJoyKnob(knob);
        joystickRef.current = { x: knob.x / max, y: knob.y / max };
      },
      onPanResponderRelease: () => { setJoyKnob({ x: 0, y: 0 }); joystickRef.current = { x: 0, y: 0 }; },
      onPanResponderTerminate: () => { setJoyKnob({ x: 0, y: 0 }); joystickRef.current = { x: 0, y: 0 }; },
    }),
  ).current;

  // Enemy factory
  const spawnEnemy = useCallback(() => {
    const roll = Math.random();
    let type: Enemy["type"] = "grunt";
    if (roll > 0.85) type = "brute";
    else if (roll > 0.6) type = "swift";
    const waveMult = 1 + (waveRef.current - 1) * 0.15;
    const base = { grunt: { hp: 30, speed: 55, damage: 8, radius: 16, color: "#8E24AA" },
                   swift: { hp: 22, speed: 90, damage: 6, radius: 13, color: "#26C6DA" },
                   brute: { hp: 80, speed: 40, damage: 18, radius: 22, color: "#D84315" } }[type];
    const side = Math.floor(Math.random() * 4);
    let pos: V = { x: 0, y: 0 };
    if (side === 0) pos = { x: Math.random() * arenaW, y: -20 };
    else if (side === 1) pos = { x: arenaW + 20, y: Math.random() * arenaH };
    else if (side === 2) pos = { x: Math.random() * arenaW, y: arenaH + 20 };
    else pos = { x: -20, y: Math.random() * arenaH };
    enemiesRef.current.push({
      id: uniqRef.current++,
      pos, hp: base.hp * waveMult, maxHp: base.hp * waveMult,
      radius: base.radius, speed: base.speed * waveMult, damage: base.damage * waveMult,
      color: base.color, type,
    });
  }, [arenaW, arenaH]);

  // Game loop
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const loop = () => {
      const now = performance.now();
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;

      if (!pausedRef.current && !gameOverRef.current) {
        elapsedRef.current += dt;

        // Move player
        const heroSpd = (heroObj?.spd || 6) * 26;
        playerRef.current.x = Math.max(20, Math.min(arenaW - 20, playerRef.current.x + joystickRef.current.x * heroSpd * dt));
        playerRef.current.y = Math.max(20, Math.min(arenaH - 20, playerRef.current.y + joystickRef.current.y * heroSpd * dt));

        // Auto-fire toward nearest enemy
        fireCdRef.current -= dt;
        if (fireCdRef.current <= 0 && enemiesRef.current.length > 0) {
          const p = playerRef.current;
          let nearest: Enemy | null = null;
          let nd = Infinity;
          for (const e of enemiesRef.current) {
            const d = Math.hypot(e.pos.x - p.x, e.pos.y - p.y);
            if (d < nd) { nd = d; nearest = e; }
          }
          if (nearest && nd < 380) {
            const dir = norm({ x: nearest.pos.x - p.x, y: nearest.pos.y - p.y });
            const speed = 520;
            bulletsRef.current.push({
              id: uniqRef.current++, pos: { x: p.x, y: p.y },
              vel: { x: dir.x * speed, y: dir.y * speed },
              life: 1.4, damage: weaponObj?.damage || 20, color: weaponObj?.color || COLORS.gold,
            });
            fireCdRef.current = weaponObj?.cooldown || 0.4;
          }
        }

        // Move bullets & check hits
        const remainingBullets: Bullet[] = [];
        for (const b of bulletsRef.current) {
          b.pos.x += b.vel.x * dt; b.pos.y += b.vel.y * dt;
          b.life -= dt;
          if (b.life <= 0 || b.pos.x < -20 || b.pos.x > arenaW + 20 || b.pos.y < -20 || b.pos.y > arenaH + 20) continue;
          let hit = false;
          for (const e of enemiesRef.current) {
            if (Math.hypot(b.pos.x - e.pos.x, b.pos.y - e.pos.y) < e.radius + 4) {
              e.hp -= b.damage;
              particlesRef.current.push({ id: uniqRef.current++, pos: { x: b.pos.x, y: b.pos.y }, life: 0.35, color: e.color });
              hit = true;
              break;
            }
          }
          if (!hit) remainingBullets.push(b);
        }
        bulletsRef.current = remainingBullets;

        // Move enemies & check hp
        const alive: Enemy[] = [];
        for (const e of enemiesRef.current) {
          const dir = norm({ x: playerRef.current.x - e.pos.x, y: playerRef.current.y - e.pos.y });
          e.pos.x += dir.x * e.speed * dt;
          e.pos.y += dir.y * e.speed * dt;
          if (e.hp <= 0) {
            killsRef.current += 1;
            particlesRef.current.push({ id: uniqRef.current++, pos: { x: e.pos.x, y: e.pos.y }, life: 0.6, color: COLORS.gold });
            continue;
          }
          // damage player on contact
          if (Math.hypot(e.pos.x - playerRef.current.x, e.pos.y - playerRef.current.y) < e.radius + 20) {
            playerHpRef.current -= e.damage * dt;
          }
          alive.push(e);
        }
        enemiesRef.current = alive;

        // Particles
        particlesRef.current = particlesRef.current
          .map((p) => ({ ...p, life: p.life - dt }))
          .filter((p) => p.life > 0);

        // Spawn enemies for current wave
        enemySpawnRef.current -= dt;
        const activeCount = enemiesRef.current.length;
        if (
          enemiesLeftRef.current > 0 &&
          enemySpawnRef.current <= 0 &&
          activeCount < 8
        ) {
          spawnEnemy();
          enemiesLeftRef.current -= 1;
          enemySpawnRef.current = Math.max(0.4, 1.4 - waveRef.current * 0.08);
        }

        // Check wave complete
        if (enemiesLeftRef.current <= 0 && enemiesRef.current.length === 0) {
          const totalWaves = mapObj?.waves || 5;
          if (waveRef.current >= totalWaves) {
            gameOverRef.current = true;
            setStatus("victory");
            finishGame(true);
          } else {
            startWave(waveRef.current + 1);
          }
        }

        // Check defeat
        if (playerHpRef.current <= 0) {
          playerHpRef.current = 0;
          gameOverRef.current = true;
          setStatus("defeat");
          finishGame(false);
        }
      }

      setTick((t) => (t + 1) % 1000000);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [heroObj?.id, weaponObj?.id, mapObj?.id]);

  const finishGame = async (victory: boolean) => {
    if (!player) return;
    try {
      const updated = await api.completeMatch(
        player.id,
        selectedMap,
        killsRef.current,
        Math.floor(elapsedRef.current),
        victory,
      );
      router.replace({
        pathname: "/results",
        params: {
          victory: victory ? "1" : "0",
          kills: String(killsRef.current),
          seconds: String(Math.floor(elapsedRef.current)),
          newCoins: String(updated.coins),
          newLevel: String(updated.level),
          newXp: String(updated.xp),
        },
      });
    } catch {
      // On failure still route to results
      router.replace({
        pathname: "/results",
        params: {
          victory: victory ? "1" : "0",
          kills: String(killsRef.current),
          seconds: String(Math.floor(elapsedRef.current)),
          newCoins: String(player.coins),
          newLevel: String(player.level),
          newXp: String(player.xp),
        },
      });
    }
  };

  const togglePause = () => {
    pausedRef.current = !pausedRef.current;
    setPaused(pausedRef.current);
  };

  const quit = () => {
    gameOverRef.current = true;
    router.replace("/lobby");
  };

  if (!player || !heroObj || !mapObj || !weaponObj) return null;

  const hpPct = Math.max(0, (playerHpRef.current / maxHpRef.current) * 100);
  const bg = mapObj.bg || "#1A1A2E";
  const totalWaves = mapObj.waves;

  return (
    <View style={[styles.root, { backgroundColor: bg }]}>
      {/* Arena tint & grid */}
      <View style={[styles.arena, { top: arenaTop, height: arenaH, backgroundColor: bg }]} pointerEvents="none">
        {/* subtle grid */}
        {Array.from({ length: 8 }).map((_, i) => (
          <View key={`h${i}`} style={[styles.gridLine, { top: (arenaH / 8) * i, width: arenaW, height: 1 }]} />
        ))}
        {Array.from({ length: 8 }).map((_, i) => (
          <View key={`v${i}`} style={[styles.gridLine, { left: (arenaW / 8) * i, width: 1, height: arenaH }]} />
        ))}

        {/* Particles */}
        {particlesRef.current.map((p) => (
          <View
            key={p.id}
            style={{
              position: "absolute",
              left: p.pos.x - 4, top: p.pos.y - 4,
              width: 8, height: 8, borderRadius: 4,
              backgroundColor: p.color, opacity: Math.min(1, p.life * 2),
            }}
          />
        ))}

        {/* Bullets */}
        {bulletsRef.current.map((b) => (
          <View
            key={b.id}
            style={{
              position: "absolute",
              left: b.pos.x - 5, top: b.pos.y - 5,
              width: 10, height: 10, borderRadius: 5,
              backgroundColor: b.color,
              shadowColor: b.color, shadowOpacity: 1, shadowRadius: 8, elevation: 6,
            }}
          />
        ))}

        {/* Enemies */}
        {enemiesRef.current.map((e) => (
          <View key={e.id} style={{ position: "absolute", left: e.pos.x - e.radius, top: e.pos.y - e.radius }}>
            <View style={{ width: e.radius * 2, height: e.radius * 2, borderRadius: e.radius, backgroundColor: e.color, borderWidth: 2, borderColor: "#000", alignItems: "center", justifyContent: "center" }}>
              <FontAwesome5 name={e.type === "brute" ? "khanda" : e.type === "swift" ? "wind" : "skull"} size={e.radius - 4} color="#fff" />
            </View>
            {/* HP bar */}
            <View style={{ width: e.radius * 2, height: 3, marginTop: 2, backgroundColor: "rgba(0,0,0,0.6)" }}>
              <View style={{ width: `${Math.max(0, (e.hp / e.maxHp) * 100)}%`, height: "100%", backgroundColor: COLORS.danger }} />
            </View>
          </View>
        ))}

        {/* Player */}
        <View style={{ position: "absolute", left: playerRef.current.x - 22, top: playerRef.current.y - 22 }}>
          <View style={[styles.playerAvatar, { backgroundColor: heroObj.color }]}>
            <Text style={styles.playerLtr}>{heroObj.letter}</Text>
          </View>
        </View>
      </View>

      {/* TOP HUD */}
      <SafeAreaView edges={["top"]} style={styles.hudTop} pointerEvents="box-none">
        <View style={styles.hudRow}>
          <View style={styles.hpBox} testID="battle-hp">
            <Text style={styles.hpLbl}>HP</Text>
            <View style={styles.hpBar}>
              <View style={[styles.hpFill, { width: `${hpPct}%` }]} />
            </View>
          </View>
          <View style={styles.center}>
            <Text style={styles.waveTxt} testID="battle-wave">WAVE {waveRef.current}/{totalWaves}</Text>
            <Text style={styles.timeTxt}>{Math.floor(elapsedRef.current)}s</Text>
          </View>
          <View style={styles.rightBox}>
            <View style={styles.killBox} testID="battle-kills">
              <FontAwesome5 name="skull-crossbones" size={12} color={COLORS.danger} />
              <Text style={styles.killTxt}>{killsRef.current}</Text>
            </View>
            <TouchableOpacity style={styles.pause} onPress={togglePause} testID="battle-pause-btn">
              <FontAwesome5 name={paused ? "play" : "pause"} size={12} color={COLORS.text} />
            </TouchableOpacity>
          </View>
        </View>
      </SafeAreaView>

      {/* Joystick */}
      <View style={[styles.joyBase, { left: joyBaseX - 60, top: joyBaseY - 60 }]} {...joyPan.panHandlers} testID="battle-joystick">
        <View style={[styles.joyKnob, { transform: [{ translateX: joyKnob.x }, { translateY: joyKnob.y }] }]} />
      </View>

      {/* Fire indicator (auto-fire, so display cooldown) */}
      <View style={[styles.fireBox, { right: 40, top: joyBaseY - 40 }]}>
        <View style={[styles.fireCircle, { borderColor: weaponObj.color }]}>
          <FontAwesome5 name="fire" size={22} color={weaponObj.color} />
        </View>
        <Text style={styles.fireLbl}>{weaponObj.name}</Text>
      </View>

      {/* Pause overlay */}
      {paused && (
        <View style={styles.pauseOverlay}>
          <Text style={styles.pauseTitle}>PAUSED</Text>
          <TouchableOpacity style={styles.pauseBtn} onPress={togglePause} testID="battle-resume-btn">
            <Text style={styles.pauseBtnTxt}>RESUME</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.pauseBtn, { backgroundColor: COLORS.secondary }]} onPress={quit} testID="battle-quit-btn">
            <Text style={styles.pauseBtnTxt}>QUIT MATCH</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#1A1A2E" },
  arena: { position: "absolute", left: 0, right: 0, overflow: "hidden" },
  gridLine: { position: "absolute", backgroundColor: "rgba(255,255,255,0.03)" },
  playerAvatar: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", borderWidth: 3, borderColor: COLORS.gold, shadowColor: COLORS.gold, shadowOpacity: 0.8, shadowRadius: 12, elevation: 10 },
  playerLtr: { color: "#fff", fontSize: 22, fontWeight: "900" },
  hudTop: { position: "absolute", left: 0, right: 0, top: 0 },
  hudRow: { flexDirection: "row", paddingHorizontal: 16, paddingVertical: 10, gap: 12, alignItems: "center" },
  hpBox: { flex: 1 },
  hpLbl: { ...FONTS.small, color: COLORS.danger, marginBottom: 4 },
  hpBar: { height: 14, backgroundColor: "rgba(0,0,0,0.5)", borderRadius: 7, borderWidth: 1, borderColor: COLORS.border, overflow: "hidden" },
  hpFill: { height: "100%", backgroundColor: COLORS.danger },
  center: { alignItems: "center" },
  waveTxt: { color: COLORS.gold, fontWeight: "900", fontSize: 14, letterSpacing: 1 },
  timeTxt: { color: COLORS.textDim, fontSize: 11, marginTop: 2 },
  rightBox: { flex: 1, flexDirection: "row", justifyContent: "flex-end", alignItems: "center", gap: 8 },
  killBox: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "rgba(0,0,0,0.5)", paddingHorizontal: 10, paddingVertical: 6, borderRadius: 12, borderWidth: 1, borderColor: COLORS.border },
  killTxt: { color: COLORS.text, fontWeight: "800", fontSize: 13 },
  pause: { width: 34, height: 34, borderRadius: 17, backgroundColor: COLORS.secondary, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: COLORS.primary },

  joyBase: { position: "absolute", width: 120, height: 120, borderRadius: 60, backgroundColor: "rgba(26, 26, 46, 0.55)", borderWidth: 2, borderColor: "rgba(255, 215, 0, 0.35)", alignItems: "center", justifyContent: "center" },
  joyKnob: { width: 48, height: 48, borderRadius: 24, backgroundColor: "rgba(255, 140, 0, 0.85)", borderWidth: 2, borderColor: COLORS.gold },

  fireBox: { position: "absolute", alignItems: "center" },
  fireCircle: { width: 72, height: 72, borderRadius: 36, borderWidth: 3, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255, 87, 34, 0.15)" },
  fireLbl: { color: COLORS.gold, fontSize: 10, fontWeight: "800", letterSpacing: 1, marginTop: 6 },

  pauseOverlay: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.85)", alignItems: "center", justifyContent: "center", gap: 16 },
  pauseTitle: { color: COLORS.gold, fontSize: 44, fontWeight: "900", letterSpacing: 6, marginBottom: 12 },
  pauseBtn: { paddingHorizontal: 40, paddingVertical: 14, borderRadius: 24, backgroundColor: COLORS.primary, borderWidth: 2, borderColor: COLORS.gold, minWidth: 220, alignItems: "center" },
  pauseBtnTxt: { color: "#fff", fontWeight: "900", letterSpacing: 2 },
});
