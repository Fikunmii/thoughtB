"""
stripe_api.py — Stripe subscription management for Thought Biography
Plans:
  Personal     $15.99/mo  price_1TnbLAKhwAvA6zUqJI8YJYZI  (14-day trial, card required)
  Professional $49.99/mo  price_1TnbMDKhwAvA6zUqkE0QkPxw  (14-day trial, card required)

The 14-day trial is the ONLY way in — there is no free tier. Stripe runs the
trial (subscription_data.trial_period_days) and always collects a card up front,
so it auto-charges when the trial ends. One trial per account: once a customer
has had any subscription, later checkouts start billing immediately.

Accounts without a trialing/active subscription are read-only — see
auth.require_subscription, which every write/AI endpoint depends on.
"""
import os, stripe
from fastapi import APIRouter, Depends, Request, HTTPException
from auth import get_current_user, get_access, invalidate_access

STRIPE_SECRET_KEY   = os.getenv("STRIPE_SECRET_KEY", "")
WEBHOOK_SECRET      = os.getenv("STRIPE_WEBHOOK_SECRET", "")
FRONTEND_URL        = os.getenv("FRONTEND_URL", "https://tbfrontend.netlify.app")

PLANS = {
    "personal": {
        "price_id":   "price_1TnbLAKhwAvA6zUqJI8YJYZI",
        "name":       "Personal",
        "amount":     1599,
        "trial_days": 14,
    },
    "professional": {
        "price_id":   "price_1TnbMDKhwAvA6zUqkE0QkPxw",
        "name":       "Professional",
        "amount":     4999,
        "trial_days": 14,
    },
}

router = APIRouter()


def get_stripe():
    if not STRIPE_SECRET_KEY:
        raise HTTPException(500, "Stripe not configured")
    stripe.api_key = STRIPE_SECRET_KEY
    return stripe


def get_neo4j_driver():
    """Import driver from api.py to avoid duplicate connections."""
    from api import driver
    return driver


def get_posthog():
    """Import shared PostHog client from api.py (None if not configured)."""
    from api import _posthog
    return _posthog


def get_or_create_customer(user: dict) -> str:
    s = get_stripe()
    driver = get_neo4j_driver()
    uid   = user["user_id"]
    email = user.get("email", "")

    with driver.session() as sess:
        r = sess.run("MATCH (u:User {id:$uid}) RETURN u.stripe_customer_id AS cid", uid=uid).single()
        cid = r["cid"] if r else None

    if cid:
        return cid

    customer = s.Customer.create(email=email, metadata={"user_id": uid})
    with driver.session() as sess:
        sess.run("MATCH (u:User {id:$uid}) SET u.stripe_customer_id=$cid", uid=uid, cid=customer.id)
    return customer.id


def trial_eligible(customer_id: str | None) -> bool:
    """A customer who has ever had a subscription (any status) has used their trial."""
    if not customer_id:
        return True
    s = get_stripe()
    return len(s.Subscription.list(customer=customer_id, status="all", limit=1).data) == 0


def set_user_plan(uid: str, plan: str, sub_id: str = None, status: str = "active"):
    driver = get_neo4j_driver()
    with driver.session() as sess:
        sess.run("""
            MATCH (u:User {id:$uid})
            SET u.plan=$plan, u.subscription_id=$sub_id, u.subscription_status=$status
        """, uid=uid, plan=plan, sub_id=sub_id, status=status)
    invalidate_access(uid)


def get_user_plan(uid: str) -> dict:
    driver = get_neo4j_driver()
    with driver.session() as sess:
        r = sess.run("""
            MATCH (u:User {id:$uid})
            OPTIONAL MATCH (e:Entry {user_id:$uid})
            WITH u, count(e) AS entry_count
            RETURN coalesce(u.plan,'free') AS plan,
                   coalesce(u.subscription_status,'active') AS status,
                   u.subscription_id AS sub_id,
                   u.stripe_customer_id AS cid,
                   entry_count
        """, uid=uid).single()
        if not r:
            return {"plan": "free", "status": "active", "sub_id": None, "cid": None, "entry_count": 0}
        return {
            "plan": r["plan"], "status": r["status"], "sub_id": r["sub_id"],
            "cid": r["cid"], "entry_count": r["entry_count"],
        }


# ── Routes ───────────────────────────────────────────────────────────────────

@router.get("/subscription/status")
def subscription_status(current_user: dict = Depends(get_current_user)):
    uid    = current_user["user_id"]
    access = get_access(uid)
    info   = get_user_plan(uid)
    eligible = False
    if not access["has_access"]:
        try:
            eligible = trial_eligible(info["cid"])
        except Exception as e:
            print(f"[stripe] trial eligibility check failed: {e}")
            eligible = info["cid"] is None
    return {
        "plan":           access["plan"],
        "status":         access["status"],
        "subscribed":     access["has_access"],
        "trial_eligible": eligible,
        "plans":  {k: {"name": v["name"], "amount": v["amount"], "trial_days": v["trial_days"]} for k, v in PLANS.items()},
    }


@router.post("/subscription/checkout")
def create_checkout(body: dict, current_user: dict = Depends(get_current_user)):
    plan_key = body.get("plan", "personal")
    if plan_key not in PLANS:
        raise HTTPException(400, "Invalid plan")

    if get_access(current_user["user_id"])["has_access"]:
        raise HTTPException(400, "You already have an active subscription — manage it from Billing.")

    s           = get_stripe()
    plan        = PLANS[plan_key]
    customer_id = get_or_create_customer(current_user)

    subscription_data = {}
    if trial_eligible(customer_id):
        # Card is always collected; if it's missing when the trial ends, cancel
        # rather than leaving a zombie subscription.
        subscription_data = {
            "trial_period_days": plan["trial_days"],
            "trial_settings": {"end_behavior": {"missing_payment_method": "cancel"}},
        }

    session = s.checkout.Session.create(
        customer=customer_id,
        mode="subscription",
        line_items=[{"price": plan["price_id"], "quantity": 1}],
        payment_method_collection="always",
        subscription_data=subscription_data,
        success_url=f"{FRONTEND_URL}?subscribed=true&plan={plan_key}&session_id={{CHECKOUT_SESSION_ID}}",
        cancel_url=f"{FRONTEND_URL}?subscribed=false",
        metadata={"user_id": current_user["user_id"], "plan": plan_key},
    )
    return {"checkout_url": session.url}


@router.post("/subscription/confirm")
def confirm_checkout(body: dict, current_user: dict = Depends(get_current_user)):
    """
    Called by the frontend when Stripe redirects back with ?session_id=...
    Activates the plan immediately instead of waiting on the webhook, so a
    slow/missed webhook can never leave a paying user locked out. The webhook
    still runs and sets the same values.
    """
    session_id = body.get("session_id")
    if not session_id:
        raise HTTPException(400, "session_id required")

    s = get_stripe()
    try:
        session = s.checkout.Session.retrieve(session_id)
    except Exception:
        raise HTTPException(400, "Unknown checkout session")

    meta = session.get("metadata") or {}
    if meta.get("user_id") != current_user["user_id"]:
        raise HTTPException(403, "This checkout session belongs to another account")
    if session.get("status") != "complete":
        raise HTTPException(409, "Checkout not completed")

    plan_key   = meta.get("plan", "personal")
    sub_id     = session.get("subscription")
    sub_status = "active"
    if sub_id:
        sub_status = s.Subscription.retrieve(sub_id).status
    set_user_plan(current_user["user_id"], plan_key, sub_id, sub_status)
    return {"plan": plan_key, "status": sub_status, "subscribed": sub_status in ("trialing", "active")}


@router.post("/subscription/portal")
def customer_portal(current_user: dict = Depends(get_current_user)):
    s           = get_stripe()
    customer_id = get_or_create_customer(current_user)
    session     = s.billing_portal.Session.create(
        customer=customer_id,
        return_url=FRONTEND_URL,
    )
    return {"portal_url": session.url}


@router.post("/stripe/webhook")
async def stripe_webhook(request: Request):
    if not WEBHOOK_SECRET:
        raise HTTPException(500, "Webhook secret not configured")

    payload    = await request.body()
    sig_header = request.headers.get("stripe-signature", "")
    s          = get_stripe()

    try:
        event = s.Webhook.construct_event(payload, sig_header, WEBHOOK_SECRET)
    except stripe.error.SignatureVerificationError:
        raise HTTPException(400, "Invalid signature")

    et   = event["type"]
    data = event["data"]["object"]
    driver = get_neo4j_driver()

    if et == "checkout.session.completed":
        uid      = data.get("metadata", {}).get("user_id")
        plan_key = data.get("metadata", {}).get("plan", "personal")
        sub_id   = data.get("subscription")
        if uid:
            # Pull the real status (usually "trialing" since checkout sets a 14-day trial)
            # instead of hardcoding "active" — matters for showing an accurate trial state.
            sub_status = "active"
            if sub_id:
                try:
                    sub_status = s.Subscription.retrieve(sub_id).status
                except Exception:
                    pass
            set_user_plan(uid, plan_key, sub_id, sub_status)
            _ph = get_posthog()
            if _ph:
                try:
                    _ph.capture(uid, "subscription_started", {
                        "plan": plan_key,
                        "status": sub_status,
                    })
                except Exception as _e:
                    print(f"[posthog] capture failed: {_e}")

    elif et == "customer.subscription.updated":
        sub_id = data["id"]
        status = data["status"]
        with driver.session() as sess:
            r = sess.run(
                "MATCH (u:User {subscription_id:$sid}) RETURN u.id AS uid, u.plan AS plan",
                sid=sub_id
            ).single()
            if r:
                plan = "free" if status == "canceled" else r["plan"]
                set_user_plan(r["uid"], plan, sub_id, status)

    elif et == "customer.subscription.deleted":
        sub_id = data["id"]
        with driver.session() as sess:
            r = sess.run(
                "MATCH (u:User {subscription_id:$sid}) RETURN u.id AS uid",
                sid=sub_id
            ).single()
            if r:
                set_user_plan(r["uid"], "free", None, "canceled")
                _ph = get_posthog()
                if _ph:
                    try:
                        _ph.capture(r["uid"], "subscription_cancelled", {})
                    except Exception as _e:
                        print(f"[posthog] capture failed: {_e}")

    return {"received": True}


def register_stripe_routes(app):
    app.include_router(router)
