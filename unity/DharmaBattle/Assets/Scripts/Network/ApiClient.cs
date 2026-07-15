using System;
using System.Collections;
using System.Text;
using UnityEngine;
using UnityEngine.Networking;

namespace DharmaBattle.Network
{
    [Serializable]
    public class PlayerDto
    {
        public string id;
        public string name;
        public int level;
        public int xp;
        public int coins;
        public int kills;
        public int matches;
        public int wins;
        public int best_score;
        public string[] owned_heroes;
        public string[] owned_weapons;
        public string selected_hero;
        public string selected_weapon;
    }

    [Serializable]
    public class MatchCompleteRequest
    {
        public string player_id;
        public string map_id;
        public int kills;
        public int survived_seconds;
        public bool victory;
    }

    /// <summary>
    /// REST client for the existing FastAPI backend — reuse player progress, shop, leaderboard.
  /// Set base URL in Inspector or via PlayerPrefs "api_base_url".
    /// </summary>
    public class ApiClient : MonoBehaviour
    {
        public static ApiClient Instance { get; private set; }

        [SerializeField] string baseUrl = "http://localhost:8001";

        void Awake()
        {
            if (Instance != null && Instance != this) { Destroy(gameObject); return; }
            Instance = this;
            DontDestroyOnLoad(gameObject);

            if (PlayerPrefs.HasKey("api_base_url"))
                baseUrl = PlayerPrefs.GetString("api_base_url");
        }

        public void SetBaseUrl(string url)
        {
            baseUrl = url.TrimEnd('/');
            PlayerPrefs.SetString("api_base_url", baseUrl);
        }

        string Api(string path) => $"{baseUrl}/api{path}";

        public IEnumerator CreatePlayer(string name, Action<PlayerDto> onOk, Action<string> onErr = null)
        {
            var body = $"{{\"name\":\"{Escape(name)}\"}}";
            yield return Post("/player", body, onOk, onErr);
        }

        public IEnumerator GetPlayer(string id, Action<PlayerDto> onOk, Action<string> onErr = null)
        {
            using var req = UnityWebRequest.Get(Api($"/player/{id}"));
            yield return Send(req, onOk, onErr);
        }

        public IEnumerator CompleteMatch(MatchCompleteRequest payload, Action<PlayerDto> onOk, Action<string> onErr = null)
        {
            var json = JsonUtility.ToJson(payload);
            yield return Post("/match/complete", json, onOk, onErr);
        }

        IEnumerator Post(string path, string json, Action<PlayerDto> onOk, Action<string> onErr)
        {
            using var req = new UnityWebRequest(Api(path), "POST");
            req.uploadHandler = new UploadHandlerRaw(Encoding.UTF8.GetBytes(json));
            req.downloadHandler = new DownloadHandlerBuffer();
            req.SetRequestHeader("Content-Type", "application/json");
            yield return Send(req, onOk, onErr);
        }

        IEnumerator Send(UnityWebRequest req, Action<PlayerDto> onOk, Action<string> onErr)
        {
            yield return req.SendWebRequest();
            if (req.result != UnityWebRequest.Result.Success)
            {
                onErr?.Invoke(req.error);
                yield break;
            }
            var player = JsonUtility.FromJson<PlayerDto>(req.downloadHandler.text);
            onOk?.Invoke(player);
        }

        static string Escape(string s) => s.Replace("\\", "\\\\").Replace("\"", "\\\"");
    }
}
