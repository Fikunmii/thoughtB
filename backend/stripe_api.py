"""
stripe_api.py — Stripe subscription management for Thought Biography
Plans:
  Personal     $15.99/mo  price_1TnbLAKhwAvA6zUqJI8YJYZI  (14-day trial)
  Professional $49.99/mo  price_1TnbMDKhwAvA6zUqkE0QkPxw  (14-day trial)
"""
import os, stripe
from fastapi import APIRouter, Depends, Request, HTTPException
from auth import get_current_user

STRIPE_SECRET_KEY   = os.getenv("STRIPE_SECRET_KEY", "")
WEBHOOK_SECRET      = os.getenv("STRIPE_WEBHOOK_SECRET", "")
FRONTEND_URL        = os.getenv("FRONTEND_URL", "https://thoughtb-production.up.railway.app")

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


def set_user_plan(uid: str, plan: str, sub_id: str = None, status: str = "active"):
    driver = get_neo4j_driver()
    with driver.session() as sess:
        sess.run("""
            MATCH (u:User {id:$uid})
            SET u.plan=$plan, u.subscription_id=$sub_id, u.subscription_status=$status
        """, uid=uid, plan=plan, sub_id=sub_id, status=status)


def get_user_plan(uid: str) -> dict:
    driver = get_neo4j_driver()
    with driver.session() as sess:
        r = sess.run("""
            MATCH (u:User {id:$uid})
            RETURN coalesce(u.plan,'free') AS plan,
                   coalesce(u.subscription_status,'active') AS status,
                   u.subscription_id AS sub_id
        """, uid=uid).single()
        if not r:
            return {"plan": "free", "status": "active", "sub_id": None}
        return {"plan": r["plan"], "status": r["status"], "sub_id": r["sub_id"]}


# ── Routes ───────────────────────────────────────────────────────────────────

@router.get("/subscription/status")
def subscription_status(current_user: dict = Depends(get_current_user)):
    info   = get_user_plan(current_user["user_id"])
    plan   = info["plan"]
    limits = {"max_entries": 30, "daily_ai_queries": 5} if plan == "free" else {"max_entries": None, "daily_ai_queries": None}
    return {
        "plan":   plan,
        "status": info["status"],
        "limits": limits,
        "plans":  {k: {"name": v["name"], "amount": v["amount"]} for k, v in PLANS.items()},
    }


@router.post("/subscription/checkout")
def create_checkout(body: dict, current_user: dict = Depends(get_current_user)):
    plan_key = body.get("plan", "personal")
    if plan_key not in PLANS:
        raise HTTPException(400, "Invalid plan")

    s          = get_stripe()
    plan       = PLANS[plan_key]
    customer_id = get_or_create_customer(current_user)

    session = s.checkout.Session.create(
        customer=customer_id,
        mode="subscription",
        line_items=[{"price": plan["price_id"], "quantity": 1}],
        subscription_data={"trial_period_days": plan["trial_days"]},
        success_url=f"{FRONTEND_URL}?subscribed=true&plan={plan_key}",
        cancel_url=f"{FRONTEND_URL}?subscribed=false",
        metadata={"user_id": current_user["user_id"], "plan": plan_key},
    )
    return {"checkout_url": session.url}


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
            set_user_plan(uid, plan_key, sub_id, "active")

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

    return {"received": True}


def register_stripe_routes(app):
    app.include_router(router)
