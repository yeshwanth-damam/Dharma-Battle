using UnityEngine;
using UnityEngine.UI;

namespace DharmaBattle.UI
{
    /// <summary>Top HUD: wave, kills, HP — makes the prototype readable in Game view.</summary>
    public class BattleHud : MonoBehaviour
    {
        [SerializeField] Text waveText;
        [SerializeField] Text killsText;
        [SerializeField] Text hpText;
        [SerializeField] Text titleText;

        Combat.BattleManager _battle;
        Combat.PlayerController _player;

        void Start()
        {
            _battle = FindAnyObjectByType<Combat.BattleManager>();
            _player = FindAnyObjectByType<Combat.PlayerController>();
            if (titleText != null)
                titleText.text = "DHARMA BATTLE";
        }

        void Update()
        {
            if (_battle != null && waveText != null)
                waveText.text = $"WAVE {_battle.CurrentWave}";
            if (_battle != null && killsText != null)
                killsText.text = $"KILLS {_battle.KillCount}";
            if (_player != null && hpText != null)
                hpText.text = $"HP {Mathf.CeilToInt(_player.Hp)}/{Mathf.CeilToInt(_player.MaxHp)}";
        }
    }
}
