"""
stripe_api.py — Stripe subscription management for Thought Biography
Plans:
  Personal     $15.99/mo  price_1TnbLAKhwAvA6zUqJI8YJYZI  (14-day trial)
  Professional $49.99/mo  price_1TnbMDKhwAvA6zUqkE0QkPxw  (14-day trial)
Free tier: 30 entries, 5 AI queries/day
"""
import os, json
import stripe
from fastapi import APIRouter, Depends, Request, HTTPException
from fastapi.responses import JSONResponse
from auth import get_current_user
from neo4j import GraphDatabase

stripe.api_key = os.getenv("STRIPE_SECRET_KEY")
WEBHOOK_SECRET  = os.getenv("STRIPE_WEBHOOK_SECRET")

PLANS = {
    "personal": {
        "price_id":    "price_1TnbLAKhwAvA6zUqJI8YJYZI",
        "name":        "Personal",
        "amount":      1599,
        "trial_days":  14,
    },
    "professional": {
        "price_id":    "price_1TnbMDKhwAvA6zUqkE0QkPxw",
        "name":        "Professional",
        "amount":      4999,
        "trial_days":  14,
    },
}

FREE_LIMITS = {"max_entries": 30, "daily_ai_queries": 5}

driver = GraphDatabase.driver(
    os.getenv("NEO4J_URI"),
    auth=(os.getenv("NEO4J_USER"), os.getenv("NEO4J_PASSWORD"))
)

router = APIRouter()


# ── Helpers ──────────────────────────────────────────────────────────────────

def get_or_create_stripe_customer(user: dict) -> str:
    uid   = user["user_id"]
    email = user.get("email", "")
    with driver.session() as s:
        r = s.run("MATCH (u:User {id:$uid}) RETURN u.stripe_customer_id AS cid", uid=uid).single()
        cid = r["cid"] if r else None
    if cid:
        return cid
    customer = stripe.Customer.create(email=email, metadata={"user_id": uid})
    with driver.session() as s:
        s.run("MATCH (u:User {id:$uid}) SET u.stripe_customer_id = $cid", uid=uid, cid=customer.id)
    return customer.id


def set_user_plan(uid: str, plan: str, subscription_id: str = None, status: str = "active"):
    with driver.session() as s:
        s.run("""
            MATCH (u:User {id:$uid})
            SET u.plan = $plan,
                u.subscription_id = $sub_id,
                u.subscription_status = $status
        """, uid=uid, plan=plan, sub_id=subscription_id, status=status)


def get_user_plan(uid: str) -> dict:
    with driver.session() as s:
        r = s.run("""
            MATCH (u:User {id:$uid})
            RETURN u.plan AS plan,
                   u.subscription_status AS status,
                   u.subscription_id AS sub_id
        """, uid=uid).single()
        if not r:
            return {"plan": "free", "status": "active", "sub_id": None}
        return {
            "plan":   r["plan"] or "free",
            "status": r["status"] or "active",
            "sub_id": r["sub_id"],
        }


# ── Routes ───────────────────────────────────────────────────────────────────

@router.get("/subscription/status")
def subscription_status(current_user: dict = Depends(get_current_user)):
    info = get_user_plan(current_user["user_id"])
    plan = info["plan"]
    limits = FREE_LIMITS if plan == "free" else {"max_entries": None, "daily_ai_queries": None}
    return {
        "plan":    plan,
        "status":  info["status"],
        "limits":  limits,
        "plans":   {k: {"name": v["name"], "amount": v["amount"]} for k, v in PLANS.items()},
    }


@router.post("/subscription/checkout")
def create_checkout(body: dict, current_user: dict = Depends(get_current_user)):
    plan_key = body.get("plan", "personal")
    if plan_key not in PLANS:
        raise HTTPException(400, "Invalid plan")

    plan       = PLANS[plan_key]
    customer_id = get_or_create_stripe_customer(current_user)
    frontend_url = os.getenv("FRONTEND_URL", "https://thoughtb-production.up.railway.app")

    session = stripe.checkout.Session.create(
        customer=customer_id,
        mode="subscription",
        line_items=[{"price": plan["price_id"], "quantity": 1}],
        subscription_data={"trial_period_days": plan["trial_days"]},
        success_url=f"{frontend_url}?subscribed=true&plan={plan_key}",
        cancel_url=f"{frontend_url}?subscribed=false",
        metadata={"user_id": current_user["user_id"], "plan": plan_key},
    )
    return {"checkout_url": session.url}


@router.post("/subscription/portal")
def customer_portal(current_user: dict = Depends(get_current_user)):
    """Opens Stripe customer portal to manage/cancel subscription."""
    customer_id = get_or_create_stripe_customer(current_user)
    frontend_url = os.getenv("FRONTEND_URL", "https://thoughtb-production.up.railway.app")
    session = stripe.billing_portal.Session.create(
        customer=customer_id,
        return_url=frontend_url,
    )
    return {"portal_url": session.url}


@router.post("/stripe/webhook")
async def stripe_webhook(request: Request):
    payload    = await request.body()
    sig_header = request.headers.get("stripe-signature", "")
    try:
        event = stripe.Webhook.construct_event(payload, sig_header, WEBHOOK_SECRET)
    except stripe.error.SignatureVerificationError:
        raise HTTPException(400, "Invalid signature")

    et = event["type"]
    data = event["data"]["object"]

    if et == "checkout.session.completed":
        uid      = data.get("metadata", {}).get("user_id")
        plan_key = data.get("metadata", {}).get("plan", "personal")
        sub_id   = data.get("subscription")
        if uid:
            set_user_plan(uid, plan_key, sub_id, "active")

    elif et == "customer.subscription.updated":
        sub_id = data["id"]
        status = data["status"]   # active, trialing, past_due, canceled
        plan   = "free" if status == "canceled" else None
        with driver.session() as s:
            r = s.run(
                "MATCH (u:User {subscription_id:$sub_id}) RETURN u.id AS uid, u.plan AS plan",
                sub_id=sub_id
            ).single()
            if r:
                uid  = r["uid"]
                plan = plan or r["plan"]
                set_user_plan(uid, plan, sub_id, status)

    elif et == "customer.subscription.deleted":
        sub_id = data["id"]
        with driver.session() as s:
            r = s.run(
                "MATCH (u:User {subscription_id:$sub_id}) RETURN u.id AS uid",
                sub_id=sub_id
            ).single()
            if r:
                set_user_plan(r["uid"], "free", None, "canceled")

    return {"received": True}


def register_stripe_routes(app):
    app.include_router(router)
