using System.Collections;
using System.IO;
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
            while (GameSession.Instance == null)
                yield return null;

            while (GameSession.Instance.Player == null)
                yield return null;

            if (SceneManager.GetActiveScene().name == battleSceneName)
                yield break;

            if (Application.CanStreamedLevelBeLoaded(battleSceneName))
            {
                SceneManager.LoadScene(battleSceneName);
                yield break;
            }

#if UNITY_EDITOR
            if (!File.Exists(ToFullPath(BattleSceneAssetPath)))
            {
                Debug.LogError(
                    $"Battle scene not found at {BattleSceneAssetPath}. " +
                    "Run Dharma Battle → 1. Setup Project, or open Battle scene directly.");
                yield break;
            }

            Debug.LogWarning($"Scene '{battleSceneName}' not in Build Profile — loading by full path (Editor).");
            var parameters = new LoadSceneParameters(LoadSceneMode.Single);
            UnityEditor.SceneManagement.EditorSceneManager.LoadSceneInPlayMode(
                ToFullPath(BattleSceneAssetPath), parameters);
#else
            Debug.LogError($"Scene '{battleSceneName}' is not in the build. Run Dharma Battle → Fix Build Scenes.");
#endif
        }

        static string ToFullPath(string assetsPath) =>
            Path.GetFullPath(Path.Combine(Application.dataPath, "..", assetsPath));
    }
}
