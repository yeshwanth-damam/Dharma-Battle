import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { View, Text, StyleSheet, TouchableOpacity, PanResponder, useWindowDimensions } from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { FontAwesome5 } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { Platform } from "react-native";

import { COLORS, FONTS } from "@/src/game/theme";
import { useStore } from "@/src/game/store";
import { api } from "@/src/game/api";
import { soundService } from "@/src/game/sound";

type V = { x: number; y: number };
type Enemy = { id: number; pos: V; hp: number; maxHp: number; radius: number; speed: number; damage: number; color: string; type: "grunt" | "brute" | "swift" };
type Bullet = { id: number; pos: V; vel: V; life: number; damage: number; color: string };
type Particle = { id: number; pos: V; life: number; color: string };
type Drop = { id: number; pos: V; kind: "hp" | "coin" };
type KillFeed = { id: number; text: string; life: number };

const HUD_TOP = 90;
const HUD_BOTTOM = 190;

function len(v: V) { return Math.hypot(v.x, v.y); }
function norm(v: V): V { const l = len(v) || 1; return { x: v.x / l, y: v.y / l }; }
function haptic(kind: "light" | "medium" | "heavy" | "success" | "error") {
  if (Platform.OS === "web") return;
  try {
    if (kind === "success") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    else if (kind === "error") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    else if (kind === "heavy") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    else if (kind === "medium") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    else Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  } catch { /* noop */ }
}

const ABILITY_COOLDOWN = 12; // seconds

export default function Battle() {
  const router = useRouter();
  const { player, config, selectedMap } = useStore();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();

  const heroObj = useMemo(() => config?.heroes.find((h) => h.id === player?.selected_hero), [config, player]);
  const weaponObj = useMemo(() => config?.weapons.find((w) => w.id === player?.selected_weapon), [config, player]);
  const mapObj = useMemo(() => config?.maps.find((m) => m.id === selectedMap), [config, selectedMap]);

  const arenaTop = HUD_TOP;
  const arenaBottom = windowHeight - HUD_BOTTOM;
  const arenaW = windowWidth;
  const arenaH = arenaBottom - arenaTop;

  const playerRef = useRef<V>({ x: arenaW / 2, y: arenaH / 2 });
  const playerHpRef = useRef<number>(heroObj?.hp || 100);
  const maxHpRef = useRef<number>(heroObj?.hp || 100);
  const invulnRef = useRef<number>(0);
  const joystickRef = useRef<V>({ x: 0, y: 0 });
  const keyboardRef = useRef<V>({ x: 0, y: 0 });
  const enemiesRef = useRef<Enemy[]>([]);
  const bulletsRef = useRef<Bullet[]>([]);
  const particlesRef = useRef<Particle[]>([]);
  const dropsRef = useRef<Drop[]>([]);
  const killFeedRef = useRef<KillFeed[]>([]);
  const fireCdRef = useRef<number>(0);
  const enemySpawnRef = useRef<number>(0);
  const waveRef = useRef<number>(1);
  const enemiesLeftRef = useRef<number>(0);
  const killsRef = useRef<number>(0);
  const bonusCoinsRef = useRef<number>(0);
  const elapsedRef = useRef<number>(0);
  const gameOverRef = useRef<boolean>(false);
  const abilityCdRef = useRef<number>(0);
  const tapFireRef = useRef<V | null>(null);
  const uniqRef = useRef<number>(1);

  const [, setTick] = useState(0);
  const [paused, setPaused] = useState(false);
  const pausedRef = useRef(false);
  const [, setStatus] = useState<"playing" | "victory" | "defeat">("playing");
  const togglePause = useCallback(() => {
    pausedRef.current = !pausedRef.current;
    setPaused(pausedRef.current);
  }, []);

  const startWave = useCallback((w: number) => {
    waveRef.current = w;
    const count = 4 + w * 2;
    enemiesLeftRef.current = count;
    killFeedRef.current.push({ id: uniqRef.current++, text: `WAVE ${w}`, life: 2.2 });
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
  const joyBaseY = windowHeight - 110;
  const [joyKnob, setJoyKnob] = useState<V>({ x: 0, y: 0 });
  const joyPan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderMove: (_, g) => {
        const max = 44;
        const dist = Math.hypot(g.dx, g.dy);
        const k = dist > max ? max / dist : 1;
        const knob = { x: g.dx * k, y: g.dy * k };
        setJoyKnob(knob);
        joystickRef.current = { x: knob.x / max, y: knob.y / max };
      },
      onPanResponderRelease: () => { setJoyKnob({ x: 0, y: 0 }); joystickRef.current = { x: 0, y: 0 }; },
      onPanResponderTerminate: () => { setJoyKnob({ x: 0, y: 0 }); joystickRef.current = { x: 0, y: 0 }; },
    }),
  ).current;

  const spawnEnemy = useCallback(() => {
    const roll = Math.random();
    let type: Enemy["type"] = "grunt";
    if (roll > 0.85) type = "brute"; else if (roll > 0.6) type = "swift";
    const waveMult = 1 + (waveRef.current - 1) * 0.15;
    const base = { grunt: { hp: 30, speed: 55, damage: 8, radius: 16, color: "#8E24AA" },
                   swift: { hp: 22, speed: 90, damage: 6, radius: 13, color: "#26C6DA" },
                   brute: { hp: 80, speed: 40, damage: 18, radius: 22, color: "#D84315" } }[type];
    const side = Math.floor(Math.random() * 4);
    let pos: V;
    if (side === 0) pos = { x: Math.random() * arenaW, y: -20 };
    else if (side === 1) pos = { x: arenaW + 20, y: Math.random() * arenaH };
    else if (side === 2) pos = { x: Math.random() * arenaW, y: arenaH + 20 };
    else pos = { x: -20, y: Math.random() * arenaH };
    enemiesRef.current.push({
      id: uniqRef.current++, pos, hp: base.hp * waveMult, maxHp: base.hp * waveMult,
      radius: base.radius, speed: base.speed * waveMult, damage: base.damage * waveMult,
      color: base.color, type,
    });
  }, [arenaW, arenaH]);

  const damageEnemy = useCallback((e: Enemy, dmg: number, atPos: V) => {
    e.hp -= dmg;
    particlesRef.current.push({ id: uniqRef.current++, pos: { x: atPos.x, y: atPos.y }, life: 0.35, color: e.color });
    if (e.hp <= 0) {
      killsRef.current += 1;
      soundService.play("hit");
      haptic("medium");
      // Drop chance
      const roll = Math.random();
      if (roll < 0.18) dropsRef.current.push({ id: uniqRef.current++, pos: { x: e.pos.x, y: e.pos.y }, kind: "hp" });
      else if (roll < 0.4) dropsRef.current.push({ id: uniqRef.current++, pos: { x: e.pos.x, y: e.pos.y }, kind: "coin" });
      killFeedRef.current.push({ id: uniqRef.current++, text: `+1 ${e.type.toUpperCase()}`, life: 1.2 });
    }
  }, []);

  const fireBullet = useCallback((from: V, target: V) => {
    const dir = norm({ x: target.x - from.x, y: target.y - from.y });
    const speed = 520;
    bulletsRef.current.push({
      id: uniqRef.current++, pos: { x: from.x, y: from.y },
      vel: { x: dir.x * speed, y: dir.y * speed },
      life: 1.4, damage: weaponObj?.damage || 20, color: weaponObj?.color || COLORS.gold,
    });
    soundService.play("shoot");
  }, [weaponObj?.damage, weaponObj?.color]);

  // Hero-specific ability
  const triggerAbility = useCallback(() => {
    if (abilityCdRef.current > 0 || !heroObj) return;
    abilityCdRef.current = ABILITY_COOLDOWN;
    haptic("heavy");
    const p = playerRef.current;
    switch (heroObj.id) {
      case "arjuna": {
        // Rapid Fire Astra: 12 bullets in a spread
        for (let i = 0; i < 12; i++) {
          const angle = (i / 12) * Math.PI * 2;
          fireBullet(p, { x: p.x + Math.cos(angle) * 200, y: p.y + Math.sin(angle) * 200 });
        }
        killFeedRef.current.push({ id: uniqRef.current++, text: "RAPID FIRE ASTRA!", life: 1.8 });
        break;
      }
      case "bhima": {
        // Ground Slam: heavy AoE damage in radius
        const R = 180;
        for (const e of enemiesRef.current) {
          if (Math.hypot(e.pos.x - p.x, e.pos.y - p.y) < R) {
            damageEnemy(e, 80, { x: e.pos.x, y: e.pos.y });
          }
        }
        for (let i = 0; i < 20; i++) {
          const a = (i / 20) * Math.PI * 2;
          particlesRef.current.push({ id: uniqRef.current++, pos: { x: p.x + Math.cos(a) * R, y: p.y + Math.sin(a) * R }, life: 0.6, color: "#FF7043" });
        }
        killFeedRef.current.push({ id: uniqRef.current++, text: "GROUND SLAM!", life: 1.8 });
        break;
      }
      case "hanuman": {
        // Divine Leap: dash forward + brief invulnerability
        const j = joystickRef.current;
        const dir = len(j) > 0.05 ? norm(j) : { x: 0, y: -1 };
        playerRef.current.x = Math.max(30, Math.min(arenaW - 30, p.x + dir.x * 220));
        playerRef.current.y = Math.max(30, Math.min(arenaH - 30, p.y + dir.y * 220));
        invulnRef.current = 1.5;
        killFeedRef.current.push({ id: uniqRef.current++, text: "DIVINE LEAP!", life: 1.8 });
        break;
      }
      case "karna": {
        // Sun Blast: damages all enemies on screen
        for (const e of enemiesRef.current) damageEnemy(e, 60, { x: e.pos.x, y: e.pos.y });
        for (let i = 0; i < 30; i++) {
          const a = (i / 30) * Math.PI * 2;
          particlesRef.current.push({ id: uniqRef.current++, pos: { x: p.x + Math.cos(a) * 60, y: p.y + Math.sin(a) * 60 }, life: 0.8, color: "#FFD700" });
        }
        killFeedRef.current.push({ id: uniqRef.current++, text: "SUN BLAST!", life: 1.8 });
        break;
      }
    }
  }, [heroObj, fireBullet, damageEnemy, arenaW, arenaH]);

  // Desktop controls make the web build playable without emulating touch.
  useEffect(() => {
    if (Platform.OS !== "web" || typeof window === "undefined") return;
    const pressed = new Set<string>();
    const movementKeys = new Set(["w", "a", "s", "d", "arrowup", "arrowleft", "arrowdown", "arrowright"]);
    const updateMovement = () => {
      const x = Number(pressed.has("d") || pressed.has("arrowright")) - Number(pressed.has("a") || pressed.has("arrowleft"));
      const y = Number(pressed.has("s") || pressed.has("arrowdown")) - Number(pressed.has("w") || pressed.has("arrowup"));
      keyboardRef.current = (x || y) ? norm({ x, y }) : { x: 0, y: 0 };
    };
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.tagName === "INPUT" || target?.tagName === "TEXTAREA") return;
      const key = event.key.toLowerCase();
      if (movementKeys.has(key)) {
        event.preventDefault();
        pressed.add(key);
        updateMovement();
      } else if (event.code === "Space" && !event.repeat) {
        event.preventDefault();
        triggerAbility();
      } else if (key === "escape" && !event.repeat) {
        event.preventDefault();
        togglePause();
      }
    };
    const onKeyUp = (event: KeyboardEvent) => {
      pressed.delete(event.key.toLowerCase());
      updateMovement();
    };
    const clearKeys = () => {
      pressed.clear();
      updateMovement();
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", clearKeys);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", clearKeys);
    };
  }, [triggerAbility, togglePause]);

  // Arena tap handler (tap-to-fire)
  const arenaTapPan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderGrant: (evt) => {
        const x = evt.nativeEvent.locationX;
        const y = evt.nativeEvent.locationY;
        tapFireRef.current = { x, y };
      },
    }),
  ).current;

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
        abilityCdRef.current = Math.max(0, abilityCdRef.current - dt);
        invulnRef.current = Math.max(0, invulnRef.current - dt);

        const heroSpd = (heroObj?.spd || 6) * 26;
        const movement = len(keyboardRef.current) > 0 ? keyboardRef.current : joystickRef.current;
        playerRef.current.x = Math.max(20, Math.min(arenaW - 20, playerRef.current.x + movement.x * heroSpd * dt));
        playerRef.current.y = Math.max(20, Math.min(arenaH - 20, playerRef.current.y + movement.y * heroSpd * dt));

        // Tap-to-fire override
        fireCdRef.current -= dt;
        if (tapFireRef.current && fireCdRef.current <= 0) {
          fireBullet(playerRef.current, tapFireRef.current);
          fireCdRef.current = weaponObj?.cooldown || 0.4;
          tapFireRef.current = null;
        } else if (fireCdRef.current <= 0 && enemiesRef.current.length > 0) {
          // Auto-fire
          const p = playerRef.current;
          let nearest: Enemy | null = null;
          let nd = Infinity;
          for (const e of enemiesRef.current) {
            const d = Math.hypot(e.pos.x - p.x, e.pos.y - p.y);
            if (d < nd) { nd = d; nearest = e; }
          }
          if (nearest && nd < 380) {
            fireBullet(p, nearest.pos);
            fireCdRef.current = weaponObj?.cooldown || 0.4;
          }
        }

        // Bullets
        const remainingBullets: Bullet[] = [];
        for (const b of bulletsRef.current) {
          b.pos.x += b.vel.x * dt; b.pos.y += b.vel.y * dt;
          b.life -= dt;
          if (b.life <= 0 || b.pos.x < -20 || b.pos.x > arenaW + 20 || b.pos.y < -20 || b.pos.y > arenaH + 20) continue;
          let hit = false;
          for (const e of enemiesRef.current) {
            if (Math.hypot(b.pos.x - e.pos.x, b.pos.y - e.pos.y) < e.radius + 4) {
              damageEnemy(e, b.damage, b.pos);
              hit = true; break;
            }
          }
          if (!hit) remainingBullets.push(b);
        }
        bulletsRef.current = remainingBullets;

        // Enemies
        const alive: Enemy[] = [];
        for (const e of enemiesRef.current) {
          const dir = norm({ x: playerRef.current.x - e.pos.x, y: playerRef.current.y - e.pos.y });
          e.pos.x += dir.x * e.speed * dt;
          e.pos.y += dir.y * e.speed * dt;
          if (e.hp <= 0) continue;
          if (Math.hypot(e.pos.x - playerRef.current.x, e.pos.y - playerRef.current.y) < e.radius + 20 && invulnRef.current <= 0) {
            playerHpRef.current -= e.damage * dt;
          }
          alive.push(e);
        }
        enemiesRef.current = alive;

        // Drops pickup
        const remainingDrops: Drop[] = [];
        for (const d of dropsRef.current) {
          if (Math.hypot(d.pos.x - playerRef.current.x, d.pos.y - playerRef.current.y) < 28) {
            if (d.kind === "hp") {
              playerHpRef.current = Math.min(maxHpRef.current, playerHpRef.current + maxHpRef.current * 0.25);
              killFeedRef.current.push({ id: uniqRef.current++, text: "+25% HP", life: 1.2 });
              haptic("success");
            } else {
              bonusCoinsRef.current += 5;
              killFeedRef.current.push({ id: uniqRef.current++, text: "+5 COINS", life: 1.2 });
              haptic("light");
            }
            soundService.play("pickup");
          } else {
            remainingDrops.push(d);
          }
        }
        dropsRef.current = remainingDrops;

        particlesRef.current = particlesRef.current.map((p) => ({ ...p, life: p.life - dt })).filter((p) => p.life > 0);
        killFeedRef.current = killFeedRef.current.map((k) => ({ ...k, life: k.life - dt })).filter((k) => k.life > 0);

        enemySpawnRef.current -= dt;
        if (enemiesLeftRef.current > 0 && enemySpawnRef.current <= 0 && enemiesRef.current.length < 8) {
          spawnEnemy();
          enemiesLeftRef.current -= 1;
          enemySpawnRef.current = Math.max(0.4, 1.4 - waveRef.current * 0.08);
        }

        if (enemiesLeftRef.current <= 0 && enemiesRef.current.length === 0) {
          const totalWaves = mapObj?.waves || 5;
          if (waveRef.current >= totalWaves) {
            gameOverRef.current = true;
            setStatus("victory");
            haptic("success");
            soundService.play("victory");
            finishGame(true);
          } else {
            startWave(waveRef.current + 1);
          }
        }

        if (playerHpRef.current <= 0) {
          playerHpRef.current = 0;
          gameOverRef.current = true;
          setStatus("defeat");
          haptic("error");
          soundService.play("defeat");
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
        player.id, selectedMap,
        killsRef.current,
        Math.floor(elapsedRef.current), victory, bonusCoinsRef.current,
      );
      router.replace({
        pathname: "/results",
        params: {
          victory: victory ? "1" : "0",
          kills: String(killsRef.current),
          seconds: String(Math.floor(elapsedRef.current)),
          bonusCoins: String(bonusCoinsRef.current),
          newCoins: String(updated.coins),
          newLevel: String(updated.level),
          newXp: String(updated.xp),
        },
      });
    } catch {
      router.replace({
        pathname: "/results",
        params: {
          victory: victory ? "1" : "0",
          kills: String(killsRef.current),
          seconds: String(Math.floor(elapsedRef.current)),
          bonusCoins: String(bonusCoinsRef.current),
          newCoins: String(player.coins),
          newLevel: String(player.level),
          newXp: String(player.xp),
        },
      });
    }
  };

  const quit = () => { gameOverRef.current = true; router.replace("/lobby"); };

  if (!player || !heroObj || !mapObj || !weaponObj) return null;

  const hpPct = Math.max(0, (playerHpRef.current / maxHpRef.current) * 100);
  const bg = mapObj.bg || "#1A1A2E";
  const totalWaves = mapObj.waves;
  const abilityReady = abilityCdRef.current <= 0;

  return (
    <View style={[styles.root, { backgroundColor: bg }]}>
      {/* Arena — tap-to-fire */}
      <View
        style={[styles.arena, { top: arenaTop, height: arenaH, backgroundColor: bg }]}
        {...arenaTapPan.panHandlers}
        testID="battle-arena"
      >
        {Array.from({ length: 8 }).map((_, i) => (
          <View key={`h${i}`} style={[styles.gridLine, { top: (arenaH / 8) * i, width: arenaW, height: 1 }]} />
        ))}
        {Array.from({ length: 8 }).map((_, i) => (
          <View key={`v${i}`} style={[styles.gridLine, { left: (arenaW / 8) * i, width: 1, height: arenaH }]} />
        ))}

        {/* Drops */}
        {dropsRef.current.map((d) => (
          <View key={d.id} style={{ position: "absolute", left: d.pos.x - 14, top: d.pos.y - 14 }}>
            <View style={[styles.drop, { backgroundColor: d.kind === "hp" ? "rgba(76, 175, 80, 0.25)" : "rgba(255, 215, 0, 0.25)", borderColor: d.kind === "hp" ? COLORS.success : COLORS.gold }]}>
              <FontAwesome5 name={d.kind === "hp" ? "heart" : "coins"} size={14} color={d.kind === "hp" ? COLORS.success : COLORS.gold} />
            </View>
          </View>
        ))}

        {/* Particles */}
        {particlesRef.current.map((p) => (
          <View key={p.id} style={{ position: "absolute", left: p.pos.x - 4, top: p.pos.y - 4, width: 8, height: 8, borderRadius: 4, backgroundColor: p.color, opacity: Math.min(1, p.life * 2) }} />
        ))}

        {/* Bullets */}
        {bulletsRef.current.map((b) => (
          <View key={b.id} style={{ position: "absolute", left: b.pos.x - 5, top: b.pos.y - 5, width: 10, height: 10, borderRadius: 5, backgroundColor: b.color, shadowColor: b.color, shadowOpacity: 1, shadowRadius: 8, elevation: 6 }} />
        ))}

        {/* Enemies */}
        {enemiesRef.current.map((e) => (
          <View key={e.id} style={{ position: "absolute", left: e.pos.x - e.radius, top: e.pos.y - e.radius }}>
            <View style={{ width: e.radius * 2, height: e.radius * 2, borderRadius: e.radius, backgroundColor: e.color, borderWidth: 2, borderColor: "#000", alignItems: "center", justifyContent: "center" }}>
              <FontAwesome5 name={e.type === "brute" ? "khanda" : e.type === "swift" ? "wind" : "skull"} size={e.radius - 4} color="#fff" />
            </View>
            <View style={{ width: e.radius * 2, height: 3, marginTop: 2, backgroundColor: "rgba(0,0,0,0.6)" }}>
              <View style={{ width: `${Math.max(0, (e.hp / e.maxHp) * 100)}%`, height: "100%", backgroundColor: COLORS.danger }} />
            </View>
          </View>
        ))}

        {/* Player */}
        <View style={{ position: "absolute", left: playerRef.current.x - 22, top: playerRef.current.y - 22 }}>
          <View style={[styles.playerAvatar, { backgroundColor: heroObj.color, opacity: invulnRef.current > 0 ? 0.5 : 1 }]}>
            <Text style={styles.playerLtr}>{heroObj.letter}</Text>
          </View>
        </View>

        {/* Kill feed */}
        <View style={styles.killFeed} pointerEvents="none">
          {killFeedRef.current.slice(-4).map((k) => (
            <Text key={k.id} style={[styles.killFeedTxt, { opacity: Math.min(1, k.life) }]}>{k.text}</Text>
          ))}
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

      {Platform.OS === "web" && (
        <View style={styles.desktopHelp} pointerEvents="none">
          <Text style={styles.desktopHelpText}>WASD / ARROWS MOVE · CLICK FIRES · SPACE ABILITY · ESC PAUSE</Text>
        </View>
      )}

      {/* Joystick */}
      <View style={[styles.joyBase, { left: joyBaseX - 60, top: joyBaseY - 60 }]} {...joyPan.panHandlers} testID="battle-joystick">
        <View style={[styles.joyKnob, { transform: [{ translateX: joyKnob.x }, { translateY: joyKnob.y }] }]} />
      </View>

      {/* Special ability button */}
      <TouchableOpacity
        style={[styles.abilityBtn, { right: 30, top: joyBaseY - 90, opacity: abilityReady ? 1 : 0.5, borderColor: abilityReady ? COLORS.gold : COLORS.border }]}
        onPress={triggerAbility}
        disabled={!abilityReady}
        testID="battle-ability-btn"
      >
        <FontAwesome5 name={heroObj.id === "bhima" ? "hammer" : heroObj.id === "hanuman" ? "wind" : heroObj.id === "karna" ? "sun" : "bolt"} size={22} color={abilityReady ? COLORS.gold : COLORS.textDim} />
        {!abilityReady && <Text style={styles.abilityCd}>{Math.ceil(abilityCdRef.current)}s</Text>}
      </TouchableOpacity>

      {/* Weapon label */}
      <View style={[styles.fireBox, { right: 40, top: joyBaseY - 20 }]}>
        <View style={[styles.fireCircle, { borderColor: weaponObj.color }]}>
          <FontAwesome5 name="fire" size={18} color={weaponObj.color} />
        </View>
        <Text style={styles.fireLbl}>{weaponObj.name}</Text>
      </View>

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
  playerLtr: { color: "#fff", fontSize: 22, fontFamily: "Cinzel-Black" },
  drop: { width: 28, height: 28, borderRadius: 14, borderWidth: 2, alignItems: "center", justifyContent: "center" },
  killFeed: { position: "absolute", top: 20, right: 20, alignItems: "flex-end", gap: 4 },
  killFeedTxt: { color: COLORS.gold, fontSize: 12, fontFamily: "Exo2-Bold", letterSpacing: 1, backgroundColor: "rgba(0,0,0,0.5)", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 4 },
  hudTop: { position: "absolute", left: 0, right: 0, top: 0 },
  hudRow: { flexDirection: "row", paddingHorizontal: 16, paddingVertical: 10, gap: 12, alignItems: "center" },
  hpBox: { flex: 1 },
  hpLbl: { ...FONTS.small, color: COLORS.danger, marginBottom: 4 },
  hpBar: { height: 14, backgroundColor: "rgba(0,0,0,0.5)", borderRadius: 7, borderWidth: 1, borderColor: COLORS.border, overflow: "hidden" },
  hpFill: { height: "100%", backgroundColor: COLORS.danger },
  center: { alignItems: "center" },
  waveTxt: { color: COLORS.gold, fontFamily: "Cinzel-Bold", fontSize: 14, letterSpacing: 1 },
  timeTxt: { color: COLORS.textDim, fontSize: 11, marginTop: 2 },
  rightBox: { flex: 1, flexDirection: "row", justifyContent: "flex-end", alignItems: "center", gap: 8 },
  killBox: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "rgba(0,0,0,0.5)", paddingHorizontal: 10, paddingVertical: 6, borderRadius: 12, borderWidth: 1, borderColor: COLORS.border },
  killTxt: { color: COLORS.text, fontFamily: "Exo2-Bold", fontSize: 13 },
  pause: { width: 34, height: 34, borderRadius: 17, backgroundColor: COLORS.secondary, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: COLORS.primary },
  desktopHelp: { position: "absolute", top: HUD_TOP + 8, left: 0, right: 0, alignItems: "center" },
  desktopHelpText: { color: "rgba(255,255,255,0.55)", backgroundColor: "rgba(0,0,0,0.45)", paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, fontFamily: "Exo2-Bold", fontSize: 9, letterSpacing: 0.7 },
  joyBase: { position: "absolute", width: 120, height: 120, borderRadius: 60, backgroundColor: "rgba(26, 26, 46, 0.55)", borderWidth: 2, borderColor: "rgba(255, 215, 0, 0.35)", alignItems: "center", justifyContent: "center" },
  joyKnob: { width: 48, height: 48, borderRadius: 24, backgroundColor: "rgba(255, 140, 0, 0.85)", borderWidth: 2, borderColor: COLORS.gold },
  abilityBtn: { position: "absolute", width: 68, height: 68, borderRadius: 34, borderWidth: 3, backgroundColor: "rgba(255, 87, 34, 0.2)", alignItems: "center", justifyContent: "center" },
  abilityCd: { position: "absolute", bottom: -18, color: COLORS.textDim, fontSize: 10, fontFamily: "Exo2-Bold" },
  fireBox: { position: "absolute", alignItems: "center" },
  fireCircle: { width: 56, height: 56, borderRadius: 28, borderWidth: 2, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255, 87, 34, 0.15)" },
  fireLbl: { color: COLORS.gold, fontSize: 9, fontFamily: "Exo2-Bold", letterSpacing: 1, marginTop: 4 },
  pauseOverlay: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.85)", alignItems: "center", justifyContent: "center", gap: 16 },
  pauseTitle: { color: COLORS.gold, fontSize: 44, fontFamily: "Cinzel-Black", letterSpacing: 6, marginBottom: 12 },
  pauseBtn: { paddingHorizontal: 40, paddingVertical: 14, borderRadius: 24, backgroundColor: COLORS.primary, borderWidth: 2, borderColor: COLORS.gold, minWidth: 220, alignItems: "center" },
  pauseBtnTxt: { color: "#fff", fontFamily: "Cinzel-Bold", letterSpacing: 2 },
});
