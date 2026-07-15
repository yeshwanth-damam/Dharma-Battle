using DharmaBattle.Data;
using UnityEngine;

namespace DharmaBattle.Combat
{
  /// <summary>Projectile — moves toward velocity, damages enemies on hit.</summary>
    public class Bullet : MonoBehaviour
    {
        public float damage;
        public Vector2 velocity;
        public float life;
        public Color tint = Color.yellow;

        public void Init(Vector2 pos, Vector2 vel, float dmg, Color color, float lifetime)
        {
            transform.position = pos;
            velocity = vel;
            damage = dmg;
            tint = color;
            life = lifetime;
            var sr = GetComponent<SpriteRenderer>();
            if (sr != null) sr.color = color;
        }

        void Update()
        {
            life -= Time.deltaTime;
            if (life <= 0f) { Destroy(gameObject); return; }
            transform.position += (Vector3)(velocity * Time.deltaTime);
        }

        void OnTriggerEnter2D(Collider2D other)
        {
            var enemy = other.GetComponent<EnemyController>();
            if (enemy == null) return;
            enemy.TakeDamage(damage);
            Destroy(gameObject);
        }
    }
}
