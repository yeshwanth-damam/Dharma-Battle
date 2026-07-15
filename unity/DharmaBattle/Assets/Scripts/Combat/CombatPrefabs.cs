using UnityEngine;

namespace DharmaBattle.Combat
{
    /// <summary>Runtime fallback when scene Inspector refs are missing.</summary>
    public static class CombatPrefabs
    {
        const string EnemyPath = "Combat/Enemy";
        const string BulletPath = "Combat/Bullet";

        public static EnemyController Enemy =>
            Resources.Load<EnemyController>(EnemyPath);

        public static Bullet Bullet =>
            Resources.Load<Bullet>(BulletPath);
    }
}
