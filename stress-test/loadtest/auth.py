"""Authentication for load testing a SAML/ADFS-protected portal.

The portal gates every authenticated request on a JWT (cookie ``mst_token`` or
``Authorization: Bearer``) signed with ``JWT_SECRET``. The ADFS browser flow
cannot be scripted at scale — and you don't need it: minting the same JWT the
portal would issue lets virtual users authenticate without ever touching the IdP.

Because ``get_current_user`` resolves ``sub`` against the ``users`` table, the
``sub`` must be a *real* user id. In read-only mode we never create users; we
mint one admin token, read the existing user pool via ``GET /auth/admin/users``,
and reuse those ids — no database writes.
"""
from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import List, Optional

import jwt  # PyJWT


COOKIE_NAME = "mst_token"


@dataclass
class AuthConfig:
    jwt_secret: str
    algorithm: str = "HS256"
    expire_hours: int = 24
    # bootstrap sources (first that resolves wins)
    user_ids: List[str] = field(default_factory=list)   # explicit pool
    admin_user_id: Optional[str] = None                  # a real admin id to mint a bootstrap token
    bootstrap_cookie: Optional[str] = None               # a captured mst_token (sub used as bootstrap)
    discover_pool: bool = True                           # expand pool via /auth/admin/users
    pool_limit: int = 50                                 # cap distinct identities


def mint_token(cfg: AuthConfig, sub: str, role: str = "user") -> str:
    """Mint an mst_token JWT identical to what the portal would issue."""
    now = int(time.time())
    payload = {
        "sub": sub,
        "role": role,
        "exp": now + cfg.expire_hours * 3600,
    }
    tok = jwt.encode(payload, cfg.jwt_secret, algorithm=cfg.algorithm)
    # PyJWT >=2 returns str already; be defensive for older builds
    return tok.decode() if isinstance(tok, bytes) else tok


def _decode_sub(cfg: AuthConfig, token: str) -> Optional[str]:
    try:
        payload = jwt.decode(
            token, cfg.jwt_secret, algorithms=[cfg.algorithm],
            options={"verify_exp": False},
        )
        return payload.get("sub")
    except Exception:
        # If the secret doesn't match, still try to read the sub claim unverified
        try:
            payload = jwt.decode(token, options={"verify_signature": False})
            return payload.get("sub")
        except Exception:
            return None


@dataclass
class Identity:
    user_id: str
    role: str
    token: str

    @property
    def cookie_header(self) -> str:
        return f"{COOKIE_NAME}={self.token}"


class IdentityPool:
    """A pool of minted identities that virtual users cycle through."""

    def __init__(self, cfg: AuthConfig) -> None:
        self.cfg = cfg
        self.identities: List[Identity] = []
        self._cursor = 0

    def _add(self, user_id: str, role: str) -> None:
        self.identities.append(
            Identity(user_id, role, mint_token(self.cfg, user_id, role))
        )

    async def bootstrap(self, http) -> "IdentityPool":
        """Resolve a pool of real user ids and mint a token per identity.

        ``http`` is an httpx.AsyncClient bound to the target base URL.
        Returns self. Raises RuntimeError with a clear message on failure.
        """
        cfg = self.cfg
        seed_id: Optional[str] = None
        seed_role = "admin"

        if cfg.user_ids:
            for uid in cfg.user_ids[: cfg.pool_limit]:
                self._add(uid, "user")
            # also use the first as a potential discovery seed (as admin)
            seed_id = cfg.user_ids[0]
        elif cfg.bootstrap_cookie:
            seed_id = _decode_sub(cfg, cfg.bootstrap_cookie)
            if not seed_id:
                raise RuntimeError("Could not read 'sub' from --bootstrap-cookie")
        elif cfg.admin_user_id:
            seed_id = cfg.admin_user_id

        if not seed_id:
            raise RuntimeError(
                "No identity source. Provide one of: --user-ids, --admin-user-id, "
                "or --bootstrap-cookie (and --jwt-secret)."
            )

        # Try to discover the full user pool with an admin-minted token (read-only).
        discovered = []
        if cfg.discover_pool:
            admin_token = (
                cfg.bootstrap_cookie
                if cfg.bootstrap_cookie
                else mint_token(cfg, seed_id, seed_role)
            )
            try:
                r = await http.get(
                    "/auth/admin/users",
                    headers={"Cookie": f"{COOKIE_NAME}={admin_token}"},
                    timeout=15.0,
                )
                if r.status_code == 200:
                    for u in r.json():
                        discovered.append((str(u["id"]), u.get("role", "user")))
                elif r.status_code == 403:
                    # seed id is not an admin — fall back to using it alone
                    pass
            except Exception:
                pass

        if discovered:
            self.identities.clear()
            for uid, role in discovered[: cfg.pool_limit]:
                self._add(uid, role)

        if not self.identities:
            # Last resort: a single identity from the seed
            self._add(seed_id, "user")

        return self

    def next(self) -> Identity:
        ident = self.identities[self._cursor % len(self.identities)]
        self._cursor += 1
        return ident

    def __len__(self) -> int:
        return len(self.identities)
