from dataclasses import dataclass, field
from typing import Any, Dict, Optional


@dataclass
class CheckoutSessionRequest:
    amount: float
    currency: str
    success_url: str
    cancel_url: str
    metadata: Dict[str, Any] = field(default_factory=dict)


@dataclass
class CheckoutSessionResponse:
    session_id: str
    url: str


@dataclass
class CheckoutStatus:
    status: str = "complete"
    payment_status: str = "unpaid"


@dataclass
class WebhookEvent:
    event_type: str
    session_id: Optional[str] = None
    metadata: Dict[str, Any] = field(default_factory=dict)


class StripeCheckout:
    def __init__(self, api_key: str, webhook_url: Optional[str] = None):
        self.api_key = api_key
        self.webhook_url = webhook_url

    async def create_checkout_session(self, req: CheckoutSessionRequest) -> CheckoutSessionResponse:
        sid = f"dev_{req.metadata.get('player_id', 'anon')}_{req.metadata.get('pack_id', 'pack')}"
        return CheckoutSessionResponse(session_id=sid, url=req.success_url.replace("{CHECKOUT_SESSION_ID}", sid))

    async def get_checkout_status(self, session_id: str) -> CheckoutStatus:
        return CheckoutStatus(status="complete", payment_status="unpaid")

    async def handle_webhook(self, body: bytes, signature: str) -> WebhookEvent:
        return WebhookEvent(event_type="checkout.session.completed", session_id=None)
