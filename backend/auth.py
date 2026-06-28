"""
auth.py — JWT authentication backend for Thought Biography
Handles: registration, login, token refresh, user isolation in Neo4j
"""
from neo4j import GraphDatabase
from fastapi import APIRouter, HTTPException, Depends, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel, EmailStr
from passlib.context import CryptContext
from jose import JWTError, jwt
from datetime import datetime, timedelta
from neo4j import GraphDatabase
import os
import uuid
from dotenv import load_dotenv

load_dotenv()

NEO4J_URI      = os.getenv("NEO4J_URI")
NEO4J_USER     = os.getenv("NEO4J_USER")
NEO4J_PASSWORD = os.getenv("NEO4J_PASSWORD")

# ── Config ────────────────────────────────────────────────────────────────────
SECRET_KEY    = os.getenv("JWT_SECRET_KEY", "change-this-in-production-use-openssl-rand-hex-32")
ALGORITHM     = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES  = 60 * 24       # 24 hours
REFRESH_TOKEN_EXPIRE_DAYS    = 30

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
bearer      = HTTPBearer()

driver = GraphDatabase.driver(
    NEO4J_URI,
    auth=(NEO4J_USER, NEO4J_PASSWORD)
)
router = APIRouter(prefix="/auth", tags=["auth"])


# ── Pydantic models ───────────────────────────────────────────────────────────
class RegisterRequest(BaseModel):
    email: EmailStr
    password: str
    display_name: str

class LoginRequest(BaseModel):
    email: EmailStr
    password: str

class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    user: dict

class RefreshRequest(BaseModel):
    refresh_token: str


# ── Password utilities ────────────────────────────────────────────────────────
def hash_password(password: str) -> str:
    return pwd_context.hash(password)

def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)


# ── Token utilities ───────────────────────────────────────────────────────────
def create_access_token(user_id: str, email: str) -> str:
    expire = datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    return jwt.encode(
        {"sub": user_id, "email": email, "exp": expire, "type": "access"},
        SECRET_KEY, algorithm=ALGORITHM
    )

def create_refresh_token(user_id: str) -> str:
    expire = datetime.utcnow() + timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS)
    return jwt.encode(
        {"sub": user_id, "exp": expire, "type": "refresh"},
        SECRET_KEY, algorithm=ALGORITHM
    )

def decode_token(token: str) -> dict:
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        return payload
    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
            headers={"WWW-Authenticate": "Bearer"},
        )


# ── Dependency: get current user ──────────────────────────────────────────────
def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(bearer)) -> dict:
    payload = decode_token(credentials.credentials)
    if payload.get("type") != "access":
        raise HTTPException(status_code=401, detail="Invalid token type")
    return {"user_id": payload["sub"], "email": payload["email"]}


# ── Neo4j user helpers ────────────────────────────────────────────────────────
def create_user_node(user_id: str, email: str, display_name: str, hashed_pw: str):
    """Create a User node. All graph data for this user will link to this node."""
    with driver.session() as session:
        session.run("""
            CREATE (u:User {
                id: $id,
                email: $email,
                display_name: $display_name,
                password_hash: $pw,
                created_at: datetime(),
                encryption_key_hint: $key_hint
            })
        """, id=user_id, email=email, display_name=display_name,
             pw=hashed_pw, key_hint="")

def get_user_by_email(email: str) -> dict | None:
    with driver.session() as session:
        result = session.run(
            "MATCH (u:User {email: $email}) RETURN u", email=email
        )
        record = result.single()
        return dict(record["u"]) if record else None

def get_user_by_id(user_id: str) -> dict | None:
    with driver.session() as session:
        result = session.run(
            "MATCH (u:User {id: $id}) RETURN u", id=user_id
        )
        record = result.single()
        return dict(record["u"]) if record else None

def setup_user_indexes():
    """Run once at startup."""
    try:
        with driver.session() as session:
            session.run("CREATE CONSTRAINT user_email_unique IF NOT EXISTS FOR (u:User) REQUIRE u.email IS UNIQUE")
            session.run("CREATE INDEX user_id IF NOT EXISTS FOR (u:User) ON (u.id)")
    except Exception as e:
        print(f"⚠ Neo4j index setup failed (DB may be unavailable): {e}")


# ── Routes ────────────────────────────────────────────────────────────────────
@router.post("/register", response_model=TokenResponse)
def register(req: RegisterRequest):
    existing = get_user_by_email(req.email)
    if existing:
        raise HTTPException(status_code=409, detail="Email already registered")

    if len(req.password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters")

    user_id    = str(uuid.uuid4())
    hashed_pw  = hash_password(req.password)
    create_user_node(user_id, req.email, req.display_name, hashed_pw)

    user_public = {"id": user_id, "email": req.email, "display_name": req.display_name}
    return TokenResponse(
        access_token=create_access_token(user_id, req.email),
        refresh_token=create_refresh_token(user_id),
        user=user_public
    )


@router.post("/login", response_model=TokenResponse)
def login(req: LoginRequest):
    user = get_user_by_email(req.email)
    if not user or not verify_password(req.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid email or password")

    user_public = {
        "id": user["id"],
        "email": user["email"],
        "display_name": user["display_name"]
    }
    return TokenResponse(
        access_token=create_access_token(user["id"], user["email"]),
        refresh_token=create_refresh_token(user["id"]),
        user=user_public
    )


@router.post("/refresh", response_model=TokenResponse)
def refresh(req: RefreshRequest):
    payload = decode_token(req.refresh_token)
    if payload.get("type") != "refresh":
        raise HTTPException(status_code=401, detail="Invalid refresh token")

    user = get_user_by_id(payload["sub"])
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    user_public = {
        "id": user["id"],
        "email": user["email"],
        "display_name": user["display_name"]
    }
    return TokenResponse(
        access_token=create_access_token(user["id"], user["email"]),
        refresh_token=create_refresh_token(user["id"]),
        user=user_public
    )


@router.get("/me")
def me(current_user: dict = Depends(get_current_user)):
    user = get_user_by_id(current_user["user_id"])
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return {
        "id": user["id"],
        "email": user["email"],
        "display_name": user["display_name"],
        "created_at": str(user.get("created_at", ""))
    }


@router.post("/logout")
def logout(current_user: dict = Depends(get_current_user)):
    # Stateless JWT — client discards tokens. Add a token blacklist here for stricter security.
    return {"message": "Logged out successfully"}


# ── Register in main api.py ───────────────────────────────────────────────────
def register_auth_routes(app):
    setup_user_indexes()
    app.include_router(router)

