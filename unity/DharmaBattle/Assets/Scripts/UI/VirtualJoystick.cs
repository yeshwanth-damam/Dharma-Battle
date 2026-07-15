using DharmaBattle.Combat;
using UnityEngine;
using UnityEngine.EventSystems;

namespace DharmaBattle.UI
{
    /// <summary>On-screen joystick — feeds normalized input to PlayerController.</summary>
    public class VirtualJoystick : MonoBehaviour, IDragHandler, IPointerUpHandler, IPointerDownHandler
    {
        [SerializeField] RectTransform background;
        [SerializeField] RectTransform handle;
        [SerializeField] PlayerController player;
        [SerializeField] float maxRadius = 80f;

        Vector2 _input;

        public void OnPointerDown(PointerEventData eventData) => OnDrag(eventData);

        public void OnDrag(PointerEventData eventData)
        {
            RectTransformUtility.ScreenPointToLocalPointInRectangle(background, eventData.position, eventData.pressEventCamera, out var local);
            _input = Vector2.ClampMagnitude(local, maxRadius) / maxRadius;
            handle.anchoredPosition = _input * maxRadius;
            player?.SetMoveInput(_input);
        }

        public void OnPointerUp(PointerEventData eventData)
        {
            _input = Vector2.zero;
            handle.anchoredPosition = Vector2.zero;
            player?.SetMoveInput(Vector2.zero);
        }
    }
}
