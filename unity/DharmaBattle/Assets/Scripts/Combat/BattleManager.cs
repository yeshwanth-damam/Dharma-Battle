using System.Collections;
using DharmaBattle.Core;
using DharmaBattle.Data;
using DharmaBattle.Network;
using UnityEngine;

namespace DharmaBattle.Combat
{
    /// <summary>
    /// Wave spawner + win/lose + match result submission to FastAPI.
    /// Attach to an empty GameObject in Battle scene.
    /// </summary>
    public class BattleManager : MonoBehaviour
    {
        [SerializeField] EnemyController enemyPrefab;
        [SerializeField] PlayerController player;
        [SerializeField] BoxCollider2D arenaBounds;

        [Header("Loadout (set from lobby)")]
        [SerializeField] string heroId = "arjuna";
        [SerializeField] string weaponId = "brahmastra";
        [SerializeField] string mapId = "kurukshetra";
        [SerializeField] string playerId;

        int _wave = 1;
        int _enemiesLeft;
        int _kills;
        float _elapsed;
        float _spawnTimer;
        bool _gameOver;
        bool _missingPrefabLogged;

        MapDef _map;
        CombatDef _combat;

        void Awake()
        {
            if (player == null)
                player = FindAnyObjectByType<PlayerController>();
            if (arenaBounds == null)
            {
                var arena = GameObject.Find("Arena");
                if (arena != null)
                    arenaBounds = arena.GetComponent<BoxCollider2D>();
            }
            if (enemyPrefab == null)
                enemyPrefab = CombatPrefabs.Enemy;
        }

        void Start()
        {
            GameDatabase.Load();
            _map = GameDatabase.GetMap(mapId) ?? GameDatabase.Data.maps[0];
            _combat = GameDatabase.Data.combat;

            if (enemyPrefab == null)
            {
                Debug.LogError("Enemy prefab is missing. Run Dharma Battle → 1. Setup Project (or 6. Wire Battle Scene).");
                enabled = false;
                return;
            }

            if (GameSession.Instance != null && !string.IsNullOrEmpty(GameSession.Instance.PlayerId))
                playerId = GameSession.Instance.PlayerId;

            var hero = GameDatabase.GetHero(heroId);
            var weapon = GameDatabase.GetWeapon(weaponId);
            if (player != null)
            {
                player.Init(hero, weapon, this);
                player.EnsureBulletPrefab(CombatPrefabs.Bullet);
            }

            if (!string.IsNullOrEmpty(_map.bg) && Camera.main != null)
                Camera.main.backgroundColor = GameDatabase.ParseColor(_map.bg);

            StartWave(1);
        }

        void Update()
        {
            if (_gameOver) return;
            _elapsed += Time.deltaTime;

            if (_enemiesLeft > 0)
            {
                _spawnTimer -= Time.deltaTime;
                var alive = FindObjectsByType<EnemyController>(FindObjectsSortMode.None).Length;
                if (_spawnTimer <= 0f && alive < _combat.maxEnemiesOnScreen)
                {
                    SpawnEnemy();
                    _enemiesLeft--;
                    _spawnTimer = Mathf.Max(0.4f, _combat.spawnIntervalBase - _wave * 0.08f);
                }
            }
            else if (FindObjectsByType<EnemyController>(FindObjectsSortMode.None).Length == 0)
            {
                if (_wave >= _map.waves) OnVictory();
                else StartWave(_wave + 1);
            }
        }

        void StartWave(int wave)
        {
            _wave = wave;
            _enemiesLeft = _combat.waveEnemyBase + wave * _combat.waveEnemyPerWave;
            Debug.Log($"WAVE {wave}");
        }

        void SpawnEnemy()
        {
            if (enemyPrefab == null)
            {
                if (!_missingPrefabLogged)
                {
                    Debug.LogError("Cannot spawn enemies — Enemy prefab is null.");
                    _missingPrefabLogged = true;
                }
                return;
            }

            var roll = Random.value;
            EnemyKind kind = EnemyKind.Grunt;
            if (roll > 0.85f) kind = EnemyKind.Brute;
            else if (roll > 0.6f) kind = EnemyKind.Swift;

            var waveMult = 1f + (_wave - 1) * _combat.waveScaling;
            var spawn = RandomArenaEdge();
            var enemy = Instantiate(enemyPrefab, spawn, Quaternion.identity);
            enemy.Init(kind, waveMult, player.transform, OnEnemyKilled);
        }

        Vector3 RandomArenaEdge()
        {
            var b = arenaBounds.bounds;
            var side = Random.Range(0, 4);
            return side switch
            {
                0 => new Vector3(Random.Range(b.min.x, b.max.x), b.max.y + 0.5f, 0f),
                1 => new Vector3(b.max.x + 0.5f, Random.Range(b.min.y, b.max.y), 0f),
                2 => new Vector3(Random.Range(b.min.x, b.max.x), b.min.y - 0.5f, 0f),
                _ => new Vector3(b.min.x - 0.5f, Random.Range(b.min.y, b.max.y), 0f),
            };
        }

        public Vector3 ClampToArena(Vector3 pos)
        {
            var b = arenaBounds.bounds;
            pos.x = Mathf.Clamp(pos.x, b.min.x + 0.4f, b.max.x - 0.4f);
            pos.y = Mathf.Clamp(pos.y, b.min.y + 0.4f, b.max.y - 0.4f);
            return pos;
        }

        void OnEnemyKilled(EnemyController _)
        {
            _kills++;
        }

        public int CurrentWave => _wave;
        public int KillCount => _kills;

        public void OnPlayerDefeated()
        {
            if (_gameOver) return;
            _gameOver = true;
            StartCoroutine(SubmitMatch(false));
        }

        void OnVictory()
        {
            if (_gameOver) return;
            _gameOver = true;
            StartCoroutine(SubmitMatch(true));
        }

        IEnumerator SubmitMatch(bool victory)
        {
            if (string.IsNullOrEmpty(playerId) || ApiClient.Instance == null)
            {
                Debug.Log($"Match end — victory={victory}, kills={_kills}, time={_elapsed:F0}s");
                yield break;
            }

            var req = new MatchCompleteRequest
            {
                player_id = playerId,
                map_id = _map.id,
                kills = _kills,
                survived_seconds = Mathf.RoundToInt(_elapsed),
                victory = victory,
            };

            yield return ApiClient.Instance.CompleteMatch(req,
                p => Debug.Log($"Rewards: coins={p.coins} level={p.level}"),
                err => Debug.LogWarning(err));
        }
    }
}
