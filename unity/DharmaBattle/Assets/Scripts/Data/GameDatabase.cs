using System;
using System.Collections.Generic;
using UnityEngine;

namespace DharmaBattle.Data
{
    [Serializable]
    public class HeroDef
    {
        public string id;
        public string name;
        public string title;
        public int hp;
        public int atk;
        public int spd;
        public string skill;
        public int price;
        public string color;
    }

    [Serializable]
    public class WeaponDef
    {
        public string id;
        public string name;
        public string desc;
        public int damage;
        public float cooldown;
        public int price;
        public string color;
    }

    [Serializable]
    public class MapDef
    {
        public string id;
        public string name;
        public string desc;
        public int difficulty;
        public int waves;
        public string bg;
    }

    [Serializable]
    public class EnemyTypeDef
    {
        public float hp;
        public float speed;
        public float damage;
        public float radius;
        public string color;
    }

    [Serializable]
    public class CombatDef
    {
        public float bulletSpeed = 10.4f;
        public float bulletLife = 1.4f;
        public float autoFireRange = 7.6f;
        public float abilityCooldown = 12f;
        public float heroAtkMultiplier = 0.5f;
        public int waveEnemyBase = 4;
        public int waveEnemyPerWave = 2;
        public int maxEnemiesOnScreen = 8;
        public float spawnIntervalBase = 1.4f;
        public float waveScaling = 0.15f;
    }

    [Serializable]
    public class GameDataRoot
    {
        public List<HeroDef> heroes = new();
        public List<WeaponDef> weapons = new();
        public List<MapDef> maps = new();
        public Dictionary<string, EnemyTypeDef> enemyTypes = new();
        public CombatDef combat = new();
    }

    /// <summary>Loads heroes/weapons/maps from Resources/GameData.json (ported from FastAPI config).</summary>
    public static class GameDatabase
    {
        static GameDataRoot _data;

        public static GameDataRoot Data
        {
            get
            {
                if (_data == null) Load();
                return _data;
            }
        }

        public static void Load()
        {
            var asset = Resources.Load<TextAsset>("GameData");
            if (asset == null)
            {
                Debug.LogError("Missing Resources/GameData.json");
                _data = new GameDataRoot();
                return;
            }

            // JsonUtility cannot deserialize Dictionary — use wrapper types.
            var wrapper = JsonUtility.FromJson<GameDataJsonWrapper>(asset.text);
            _data = wrapper.ToRoot();
        }

        public static HeroDef GetHero(string id) => Data.heroes.Find(h => h.id == id);
        public static WeaponDef GetWeapon(string id) => Data.weapons.Find(w => w.id == id);
        public static MapDef GetMap(string id) => Data.maps.Find(m => m.id == id);

        public static Color ParseColor(string hex)
        {
            if (ColorUtility.TryParseHtmlString(hex, out var c)) return c;
            return Color.white;
        }

        public static int BulletDamage(HeroDef hero, WeaponDef weapon)
        {
            var c = Data.combat;
            return Mathf.RoundToInt(weapon.damage + hero.atk * c.heroAtkMultiplier);
        }
    }

    // JsonUtility-friendly wrappers for enemy type dictionary.
    [Serializable] class GameDataJsonWrapper
    {
        public List<HeroDef> heroes;
        public List<WeaponDef> weapons;
        public List<MapDef> maps;
        public EnemyTypesJson enemyTypes;
        public CombatDef combat;

        public GameDataRoot ToRoot()
        {
            return new GameDataRoot
            {
                heroes = heroes ?? new List<HeroDef>(),
                weapons = weapons ?? new List<WeaponDef>(),
                maps = maps ?? new List<MapDef>(),
                enemyTypes = enemyTypes?.ToDict() ?? new Dictionary<string, EnemyTypeDef>(),
                combat = combat ?? new CombatDef(),
            };
        }
    }

    [Serializable] class EnemyTypesJson
    {
        public EnemyTypeDef grunt;
        public EnemyTypeDef swift;
        public EnemyTypeDef brute;

        public Dictionary<string, EnemyTypeDef> ToDict() => new()
        {
            ["grunt"] = grunt,
            ["swift"] = swift,
            ["brute"] = brute,
        };
    }
}
