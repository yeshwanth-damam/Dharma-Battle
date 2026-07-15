using DharmaBattle.Data;
using UnityEngine;
using UnityEngine.UI;

namespace DharmaBattle.UI
{
    /// <summary>Tap arena to aim — optional override for auto-fire.</summary>
    public class TapFireInput : MonoBehaviour
    {
        [SerializeField] Camera cam;
        [SerializeField] Combat.PlayerController player;

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
            var cd = player.AbilityCooldownRemaining;
            var max = GameDatabase.Data.combat.abilityCooldown;
            if (cooldownFill != null) cooldownFill.fillAmount = cd / max;
            if (button != null) button.interactable = cd <= 0f;
        }

        public void OnClick() => player?.TriggerAbility();
    }
}
