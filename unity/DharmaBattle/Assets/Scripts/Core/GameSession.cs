using DharmaBattle.Network;
using UnityEngine;

namespace DharmaBattle.Core
{
    /// <summary>
    /// Persists player id locally (PlayerPrefs) and boots API session.
    /// Mirrors frontend/src/game/store.tsx boot flow.
    /// </summary>
    public class GameSession : MonoBehaviour
    {
        const string PlayerIdKey = "dharma_player_id";

        public static GameSession Instance { get; private set; }
        public PlayerDto Player { get; private set; }

        [SerializeField] string warriorName = "Warrior";

        void Awake()
        {
            if (Instance != null && Instance != this) { Destroy(gameObject); return; }
            Instance = this;
            DontDestroyOnLoad(gameObject);
        }

        void Start() => StartCoroutine(Boot());

        System.Collections.IEnumerator Boot()
        {
            if (ApiClient.Instance == null)
            {
                Debug.LogWarning("Add ApiClient to scene.");
                yield break;
            }

            if (PlayerPrefs.HasKey(PlayerIdKey))
            {
                var id = PlayerPrefs.GetString(PlayerIdKey);
                yield return ApiClient.Instance.GetPlayer(id, p => Player = p, _ => PlayerPrefs.DeleteKey(PlayerIdKey));
            }

            if (Player == null)
            {
                yield return ApiClient.Instance.CreatePlayer(warriorName, p =>
                {
                    Player = p;
                    PlayerPrefs.SetString(PlayerIdKey, p.id);
                });
            }

            Debug.Log($"Player ready: {Player?.name} ({Player?.coins} coins)");
        }

        public string SelectedHero => Player?.selected_hero ?? "arjuna";
        public string SelectedWeapon => Player?.selected_weapon ?? "brahmastra";
        public string PlayerId => Player?.id;
    }
}
