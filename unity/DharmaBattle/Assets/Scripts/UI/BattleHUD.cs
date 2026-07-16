using DharmaBattle.Data;
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

    /// <summary>Tap arena to aim — optional override for auto-fire.</summary>
    public class TapFireInput : MonoBehaviour
    {
        [SerializeField] Camera cam;
        [SerializeField] Combat.PlayerController player;

        void Start()
        {
            if (cam == null) cam = Camera.main;
            if (player == null) player = FindAnyObjectByType<Combat.PlayerController>();
        }

        void Update()
        {
            if (cam == null || player == null) return;
            if (Input.GetMouseButtonDown(0))
            {
                var world = cam.ScreenToWorldPoint(Input.mousePosition);
                world.z = 0f;
                player.SetAimTarget(world);
                player.FireAt(world);
            }
        }
    }

    public class AbilityButton : MonoBehaviour
    {
        [SerializeField] Combat.PlayerController player;
        [SerializeField] Button button;
        [SerializeField] Image cooldownFill;

        void Update()
        {
            if (player == null) return;
            GameDatabase.Load();
            var cd = player.AbilityCooldownRemaining;
            var max = GameDatabase.Data.combat.abilityCooldown;
            if (cooldownFill != null) cooldownFill.fillAmount = cd / max;
            if (button != null) button.interactable = cd <= 0f;
        }

        public void OnClick() => player?.TriggerAbility();
    }
}
