using System.Collections;
using System.IO;
using DharmaBattle.Combat;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace DharmaBattle.Core
{
    /// <summary>Loads Battle scene after GameSession finishes booting the API player.</summary>
    public class SceneBootstrap : MonoBehaviour
    {
        const string BattleSceneAssetPath = "Assets/DharmaBattle/Scenes/Battle.unity";

        [SerializeField] string battleSceneName = "Battle";

        IEnumerator Start()
        {
            // Already in battle (e.g. opened Battle scene directly).
            if (SceneManager.GetActiveScene().name == battleSceneName
                || FindAnyObjectByType<BattleManager>() != null)
                yield break;

            while (GameSession.Instance == null)
                yield return null;

            while (GameSession.Instance.Player == null)
                yield return null;

            if (Application.CanStreamedLevelBeLoaded(battleSceneName))
            {
                SceneManager.LoadScene(battleSceneName);
                yield break;
            }

#if UNITY_EDITOR
            if (!BattleSceneExists())
            {
                Debug.LogError(
                    $"Battle scene not found at {BattleSceneAssetPath}.\n" +
                    "Fix: Dharma Battle → 1. Setup Project\n" +
                    "Or: open Battle scene → File → Save → Assets/DharmaBattle/Scenes/Battle.unity\n" +
                    "Or: Dharma Battle → 4. Open Battle Scene (Play Here) — skip Bootstrap.");
                yield break;
            }

            var parameters = new LoadSceneParameters(LoadSceneMode.Single);
            UnityEditor.SceneManagement.EditorSceneManager.LoadSceneInPlayMode(
                ToFullPath(BattleSceneAssetPath), parameters);
#else
            Debug.LogError($"Scene '{battleSceneName}' is not in the build. Run Dharma Battle → Fix Build Scenes.");
#endif
        }

        static bool BattleSceneExists()
        {
#if UNITY_EDITOR
            return UnityEditor.AssetDatabase.LoadAssetAtPath<Object>(BattleSceneAssetPath) != null;
#else
            return File.Exists(ToFullPath(BattleSceneAssetPath));
#endif
        }

        static string ToFullPath(string assetsPath) =>
            Path.GetFullPath(Path.Combine(Application.dataPath, "..", assetsPath));
    }
}
