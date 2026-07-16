using DharmaBattle.Data;
using UnityEngine;

namespace DharmaBattle.Combat
{
    /// <summary>
    /// Player movement, auto-fire, tap-fire, hero abilities.
    /// Ported from frontend/app/battle.tsx.
    /// </summary>
    [RequireComponent(typeof(Rigidbody2D))]
    public class PlayerController : MonoBehaviour
    {
        [SerializeField] Bullet bulletPrefab;
        [SerializeField] Transform aimTarget;

        HeroDef _hero;
        WeaponDef _weapon;
        CombatDef _combat;

        Vector2 _moveInput;
        float _fireCd;
        float _abilityCd;
        float _invuln;
        float _hp;
        float _maxHp;
        int _bulletDamage;

        BattleManager _battle;

        public float Hp => _hp;
        public float MaxHp => _maxHp;
        public float AbilityCooldownRemaining => _abilityCd;
        public string HeroName => _hero?.name ?? "Warrior";
        public bool IsInvulnerable => _invuln > 0f;

        public void Init(HeroDef hero, WeaponDef weapon, BattleManager battle)
        {
            _hero = hero;
            _weapon = weapon;
            _battle = battle;
            _combat = GameDatabase.Data.combat;
            _maxHp = hero.hp;
            _hp = _maxHp;
            _bulletDamage = GameDatabase.BulletDamage(hero, weapon);
        }

        public void EnsureBulletPrefab(Bullet prefab)
        {
            if (bulletPrefab == null && prefab != null)
                bulletPrefab = prefab;
        }

        public void SetMoveInput(Vector2 normalized) => _moveInput = Vector2.ClampMagnitude(normalized, 1f);

        public void SetAimTarget(Vector2 worldPos)
        {
            if (aimTarget != null) aimTarget.position = worldPos;
        }

        public void ApplyContactDamage(float dmg)
        {
            if (_invuln > 0f) return;
            _hp -= dmg;
            if (_hp <= 0f) _battle.OnPlayerDefeated();
        }

        void Update()
        {
            if (_hero == null) return;

            _abilityCd = Mathf.Max(0f, _abilityCd - Time.deltaTime);
            _invuln = Mathf.Max(0f, _invuln - Time.deltaTime);
            _fireCd -= Time.deltaTime;

            var speed = _hero.spd * 2.6f;
            var pos = transform.position;
            pos += (Vector3)(_moveInput * speed * Time.deltaTime);
            transform.position = _battle.ClampToArena(pos);

            if (_fireCd <= 0f)
            {
                var target = FindNearestEnemy();
                if (target != null && Vector2.Distance(transform.position, target.position) <= _combat.autoFireRange)
                {
                    FireAt(target.position);
                    _fireCd = _weapon.cooldown;
                }
            }
        }

        Transform FindNearestEnemy()
        {
            var enemies = FindObjectsByType<EnemyController>(FindObjectsSortMode.None);
            Transform best = null;
            var bestDist = float.MaxValue;
            foreach (var e in enemies)
            {
                var d = Vector2.Distance(transform.position, e.transform.position);
                if (d < bestDist) { bestDist = d; best = e.transform; }
            }
            return best;
        }

        public void FireAt(Vector2 worldTarget)
        {
            if (bulletPrefab == null) return;
            var from = (Vector2)transform.position;
            var dir = (worldTarget - from).normalized;
            var bullet = Instantiate(bulletPrefab, from, Quaternion.identity);
            bullet.Init(from, dir * _combat.bulletSpeed, _bulletDamage,
                GameDatabase.ParseColor(_weapon.color), _combat.bulletLife);
        }

        public void TriggerAbility()
        {
            if (_abilityCd > 0f || _hero == null) return;
            _abilityCd = _combat.abilityCooldown;

            switch (_hero.id)
            {
                case "arjuna":
                    for (var i = 0; i < 12; i++)
                    {
                        var angle = (i / 12f) * Mathf.PI * 2f;
                        var target = (Vector2)transform.position + new Vector2(Mathf.Cos(angle), Mathf.Sin(angle)) * 4f;
                        FireAt(target);
                    }
                    break;
                case "bhima":
                    AoEDamage(3.6f, 80f);
                    break;
                case "hanuman":
                    var dash = _moveInput.sqrMagnitude > 0.01f ? _moveInput.normalized : Vector2.up;
                    transform.position = _battle.ClampToArena(transform.position + (Vector3)(dash * 4.4f));
                    _invuln = 1.5f;
                    break;
                case "karna":
                    foreach (var e in FindObjectsByType<EnemyController>(FindObjectsSortMode.None))
                        e.TakeDamage(60f);
                    break;
            }
        }

        void AoEDamage(float radius, float dmg)
        {
            foreach (var e in FindObjectsByType<EnemyController>(FindObjectsSortMode.None))
            {
                if (Vector2.Distance(transform.position, e.transform.position) <= radius)
                    e.TakeDamage(dmg);
            }
        }

        public void HealPercent(float pct)
        {
            _hp = Mathf.Min(_maxHp, _hp + _maxHp * pct);
        }
    }
}
