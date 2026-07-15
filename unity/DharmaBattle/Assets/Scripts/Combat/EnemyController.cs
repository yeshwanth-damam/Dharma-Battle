using DharmaBattle.Data;
using UnityEngine;

namespace DharmaBattle.Combat
{
    public enum EnemyKind { Grunt, Swift, Brute }

    /// <summary>Enemy AI — chases player, deals contact damage. Ported from battle.tsx.</summary>
    public class EnemyController : MonoBehaviour
    {
        public EnemyKind kind;
        public float hp;
        public float maxHp;
        public float speed;
        public float contactDamage;
        public float radius;

        Transform _player;
        System.Action<EnemyController> _onDeath;

        public void Init(EnemyKind k, float waveMult, Transform player, System.Action<EnemyController> onDeath)
        {
            kind = k;
            _player = player;
            _onDeath = onDeath;

            var key = k.ToString().ToLower();
            if (!GameDatabase.Data.enemyTypes.TryGetValue(key, out var def))
                def = GameDatabase.Data.enemyTypes["grunt"];

            maxHp = def.hp * waveMult;
            hp = maxHp;
            speed = def.speed * waveMult;
            contactDamage = def.damage * waveMult;
            radius = def.radius;

            var sr = GetComponent<SpriteRenderer>();
            if (sr != null) sr.color = GameDatabase.ParseColor(def.color);

            transform.localScale = Vector3.one * radius * 2f;
        }

        void Update()
        {
            if (_player == null || hp <= 0f) return;
            var dir = (_player.position - transform.position).normalized;
            transform.position += dir * speed * Time.deltaTime;
        }

        public void TakeDamage(float dmg)
        {
            hp -= dmg;
            if (hp <= 0f)
            {
                _onDeath?.Invoke(this);
                Destroy(gameObject);
            }
        }

        void OnTriggerStay2D(Collider2D other)
        {
            if (!other.CompareTag("Player")) return;
            var pc = other.GetComponent<PlayerController>();
            pc?.ApplyContactDamage(contactDamage * Time.deltaTime);
        }
    }
}
