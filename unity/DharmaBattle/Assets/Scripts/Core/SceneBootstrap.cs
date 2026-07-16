using System.Collections;
using DharmaBattle.Combat;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace DharmaBattle.Core
{
    /// <summary>Loads Battle scene after GameSession finishes booting (Bootstrap entry only).</summary>
    public class SceneBootstrap : MonoBehaviour
    {
        [SerializeField] string battleSceneName = "Battle";

        IEnumerator Start()
        {
            // Playing Battle directly — skip scene switch.
            if (SceneManager.GetActiveScene().name == battleSceneName
                || FindAnyObjectByType<BattleManager>() != null)
                yield break;

            while (GameSession.Instance == null)
                yield return null;

            while (GameSession.Instance.Player == null)
                yield return null;

            if (!Application.CanStreamedLevelBeLoaded(battleSceneName))
            {
                Debug.LogError(
                    $"Scene '{battleSceneName}' is not in the build.\n" +
                    "Stop Play → Dharma Battle → 3. Fix Build Scenes → Play again.\n" +
                    "Or open Battle scene directly: Dharma Battle → 4. Open Battle Scene.");
                yield break;
            }

            SceneManager.LoadScene(battleSceneName);
        }
    }
}
