using System.Collections;
using DharmaBattle.Core;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace DharmaBattle.Core
{
    /// <summary>Loads Battle scene after GameSession finishes booting the API player.</summary>
    public class SceneBootstrap : MonoBehaviour
    {
        [SerializeField] string battleSceneName = "Battle";

        IEnumerator Start()
        {
            while (GameSession.Instance == null)
                yield return null;

            while (GameSession.Instance.Player == null)
                yield return null;

            if (SceneManager.GetActiveScene().name != battleSceneName)
                SceneManager.LoadScene(battleSceneName);
        }
    }
}
