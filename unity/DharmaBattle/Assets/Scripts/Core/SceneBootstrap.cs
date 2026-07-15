using System.Collections;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace DharmaBattle.Core
{
    /// <summary>Loads Battle scene after GameSession finishes booting the API player.</summary>
    public class SceneBootstrap : MonoBehaviour
    {
        const string BattleScenePath = "Assets/DharmaBattle/Scenes/Battle.unity";

        [SerializeField] string battleSceneName = "Battle";

        IEnumerator Start()
        {
            while (GameSession.Instance == null)
                yield return null;

            while (GameSession.Instance.Player == null)
                yield return null;

            if (SceneManager.GetActiveScene().name == battleSceneName)
                yield break;

            // Unity 6 Build Profiles may omit scenes even when EditorBuildSettings is set.
            if (!Application.CanStreamedLevelBeLoaded(battleSceneName))
            {
#if UNITY_EDITOR
                Debug.LogWarning($"Scene '{battleSceneName}' not in Build Profile — loading by path (Editor only).");
                var parameters = new LoadSceneParameters(LoadSceneMode.Single);
                UnityEditor.SceneManagement.EditorSceneManager.LoadSceneInPlayMode(BattleScenePath, parameters);
                yield break;
#else
                Debug.LogError($"Scene '{battleSceneName}' is not in the build. Run Dharma Battle → Fix Build Scenes.");
                yield break;
#endif
            }

            SceneManager.LoadScene(battleSceneName);
        }
    }
}
