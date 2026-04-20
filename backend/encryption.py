"""
encryption.py — Server-side encryption helpers for Thought Biography
Uses AES-256-GCM with per-user derived keys.
The master key never leaves the user's session — stored in memory only.
"""

import os, base64, hashlib
from cryptography.hazmat.primitives.ciphers.aead import AESGCM


# ── Key derivation ────────────────────────────────────────────────────────────
def derive_key(user_id: str, user_password: str) -> bytes:
    """
    Derive a 256-bit AES key from the user's password and ID.
    This key is NEVER stored — it's derived fresh each session.
    """
    # Use PBKDF2 with 310,000 iterations (OWASP 2023 recommendation)
    key = hashlib.pbkdf2_hmac(
        'sha256',
        user_password.encode('utf-8'),
        user_id.encode('utf-8'),   # salt = user_id (consistent, non-secret)
        iterations=310_000,
        dklen=32
    )
    return key


# ── Encryption ────────────────────────────────────────────────────────────────
def encrypt_text(plaintext: str, key: bytes) -> str:
    """
    Encrypt a string with AES-256-GCM.
    Returns base64(nonce + ciphertext + tag) as a single string.
    """
    nonce = os.urandom(12)  # 96-bit nonce for GCM
    aesgcm = AESGCM(key)
    ciphertext = aesgcm.encrypt(nonce, plaintext.encode('utf-8'), None)
    combined = nonce + ciphertext
    return base64.b64encode(combined).decode('utf-8')


def decrypt_text(encrypted_b64: str, key: bytes) -> str:
    """
    Decrypt a base64(nonce + ciphertext + tag) string.
    """
    combined = base64.b64decode(encrypted_b64.encode('utf-8'))
    nonce      = combined[:12]
    ciphertext = combined[12:]
    aesgcm = AESGCM(key)
    plaintext = aesgcm.decrypt(nonce, ciphertext, None)
    return plaintext.decode('utf-8')


# ── Session key store ─────────────────────────────────────────────────────────
# In-memory store: user_id -> derived key
# Keys are only present when the user is actively logged in
# Server restart clears all keys (users must log in again)
_session_keys: dict[str, bytes] = {}

def store_session_key(user_id: str, key: bytes):
    _session_keys[user_id] = key

def get_session_key(user_id: str) -> bytes | None:
    return _session_keys.get(user_id)

def clear_session_key(user_id: str):
    _session_keys.pop(user_id, None)


# ── Usage example ─────────────────────────────────────────────────────────────
if __name__ == "__main__":
    user_id  = "user-abc-123"
    password = "my-secret-password"

    key = derive_key(user_id, password)
    print(f"Derived key (hex): {key.hex()[:16]}...")

    original = "Today I felt the tension between freedom and belonging more acutely than usual."
    encrypted = encrypt_text(original, key)
    print(f"Encrypted: {encrypted[:40]}...")

    decrypted = decrypt_text(encrypted, key)
    print(f"Decrypted: {decrypted}")
    assert decrypted == original, "Decryption mismatch!"
    print("✓ Encryption round-trip verified")
