"""
ADFS + SAML 2.0 authentication routes for MST AI Portal.

Endpoints:
  GET  /saml/login      — redirect browser to ADFS login page
  POST /saml/acs        — Assertion Consumer Service (ADFS posts SAMLResponse here)
  GET  /saml/sls        — Single Logout Service (ADFS-initiated or SP-initiated SLO)
  GET  /saml/logout     — SP-initiated logout (redirects to ADFS)
  GET  /saml/metadata   — Serve SP metadata XML (give URL to AD admin)
  GET  /saml/callback   — Exchange one-time SAML code for JWT (called by React SPA)

Flow:
  Browser → GET /saml/login
          → 302 to ADFS (SAMLRequest)
          → ADFS shows Windows/corp login
          → POST /saml/acs (SAMLResponse)
          → validate, create/update user in DB, issue one-time code
          → 302 to PORTAL_URL/login?saml_code=<code>
          → React SPA calls GET /saml/callback?saml_code=<code>
          → receives JWT, stores in localStorage
"""

import json
import os
import secrets
import time
import urllib.parse
from functools import lru_cache
from typing import Optional
from urllib.parse import urlparse, parse_qs, urlencode, urlunparse

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse, RedirectResponse, Response
from loguru import logger

from auth.service import create_access_token
from config import settings
from database import get_db

router = APIRouter()


def _is_allowed_redirect(url: str) -> bool:
    """Return True only if url resolves to the configured portal origin."""
    if not url:
        return False
    portal_origin = settings.PORTAL_URL.rstrip("/")
    portal_parsed = urlparse(portal_origin)
    try:
        parsed = urlparse(url)
    except Exception:
        return False
    # Must share scheme + netloc with PORTAL_URL; path-only or relative is rejected
    return parsed.scheme == portal_parsed.scheme and parsed.netloc == portal_parsed.netloc


def _replace_saml_request(login_url: str, saml_request: str) -> str:
    """Swap the SAMLRequest query parameter in login_url with the provided value."""
    parsed = urlparse(login_url)
    params = parse_qs(parsed.query, keep_blank_values=True)
    params["SAMLRequest"] = [saml_request]
    new_query = urlencode({k: v[0] for k, v in params.items()})
    return urlunparse(parsed._replace(query=new_query))


# ── in-memory one-time code store (TTL 120 s, single-use) ───────────────────
# Structure: { code: {"user_id": str, "role": str, "exp": float} }
_pending_codes: dict[str, dict] = {}
_CODE_TTL = 120  # seconds


def _issue_saml_code(user_id: str, role: str) -> str:
    _purge_expired_codes()
    code = secrets.token_urlsafe(32)
    _pending_codes[code] = {"user_id": user_id, "role": role, "exp": time.time() + _CODE_TTL}
    logger.debug("SAML code issued | user_id={} role={}", user_id, role)
    return code


def _consume_saml_code(code: str) -> Optional[dict]:
    entry = _pending_codes.pop(code, None)
    if entry and entry["exp"] > time.time():
        logger.debug("SAML code consumed | user_id={}", entry["user_id"])
        return entry
    if entry:
        logger.warning("SAML code expired | user_id={}", entry.get("user_id"))
    else:
        logger.warning("SAML code not found or already used")
    return None


def _purge_expired_codes():
    now = time.time()
    expired = [k for k, v in _pending_codes.items() if v["exp"] <= now]
    for k in expired:
        del _pending_codes[k]
    if expired:
        logger.debug("Purged {} expired SAML code(s)", len(expired))


# ── SAML settings builder ────────────────────────────────────────────────────

@lru_cache(maxsize=1)
def _build_saml_settings() -> dict:
    """
    Build python3-saml settings dict from env vars, falling back to
    saml/settings.json if it exists (for cert file-based config).
    """
    json_path = settings.SAML_SETTINGS_PATH
    if os.path.isfile(json_path):
        logger.info("Loading SAML settings from file: {}", json_path)
        with open(json_path) as f:
            return json.load(f)

    logger.info("Building SAML settings from environment variables")
    return {
        "strict": settings.SAML_STRICT,
        "debug": False,
        "sp": {
            "entityId": settings.SAML_SP_ENTITY_ID,
            "assertionConsumerService": {
                "url": settings.SAML_SP_ACS_URL,
                "binding": "urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST",
            },
            "singleLogoutService": {
                "url": settings.SAML_SP_SLS_URL,
                "binding": "urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect",
            },
            "NameIDFormat": "urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress",
            "x509cert": settings.SAML_SP_CERT,
            "privateKey": settings.SAML_SP_KEY,
        },
        "idp": {
            "entityId": settings.SAML_IDP_ENTITY_ID,
            "singleSignOnService": {
                "url": settings.SAML_IDP_SSO_URL,
                "binding": "urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect",
            },
            "singleLogoutService": {
                "url": settings.SAML_IDP_SLO_URL,
                "binding": "urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect",
            },
            "x509cert": settings.SAML_IDP_CERT,
        },
        "security": {
            "nameIdEncrypted": False,
            "authnRequestsSigned": bool(settings.SAML_SP_KEY),
            "logoutRequestSigned": bool(settings.SAML_SP_KEY),
            "logoutResponseSigned": bool(settings.SAML_SP_KEY),
            "signMetadata": False,
            "wantMessagesSigned": False,
            "wantAssertionsSigned": True,
            "wantAssertionsEncrypted": False,
            "signatureAlgorithm": "http://www.w3.org/2001/04/xmldsig-more#rsa-sha256",
            "digestAlgorithm": "http://www.w3.org/2001/04/xmlenc#sha256",
        },
    }


def _get_saml_auth(request: Request):
    try:
        from onelogin.saml2.auth import OneLogin_Saml2_Auth
    except ImportError:
        logger.error("python3-saml is not installed")
        raise HTTPException(
            status_code=503,
            detail="python3-saml not installed. Run: pip install python3-saml",
        )

    req = _prepare_fastapi_request(request)
    return OneLogin_Saml2_Auth(req, _build_saml_settings())


def _prepare_fastapi_request(request: Request) -> dict:
    # FastAPI/Starlette — reconstruct the dict python3-saml expects.
    # X-Forwarded-Proto must be set by Nginx (see Step 5 in the methodology doc).
    proto = request.headers.get("x-forwarded-proto", "https" if request.url.scheme == "https" else "http")
    return {
        "https": "on" if proto == "https" else "off",
        "http_host": request.headers.get("x-forwarded-host", request.headers.get("host", str(request.url.hostname))),
        "script_name": request.url.path,
        "get_data": dict(request.query_params),
        "post_data": {},  # filled per-endpoint for ACS/SLS
    }


# ── Group → role mapping ─────────────────────────────────────────────────────

def _parse_group_role_map() -> dict[str, str]:
    """Parse SAML_GROUP_ROLE_MAP env var: 'GroupA=admin,GroupB=user' → dict."""
    result = {}
    if not settings.SAML_GROUP_ROLE_MAP:
        return result
    for pair in settings.SAML_GROUP_ROLE_MAP.split(","):
        pair = pair.strip()
        if "=" in pair:
            g, r = pair.split("=", 1)
            result[g.strip()] = r.strip()
    return result


def _resolve_role(groups: list[str]) -> str:
    group_map = _parse_group_role_map()
    for g in groups:
        role = group_map.get(g)
        if role:
            logger.debug("Resolved role '{}' from group '{}'", role, g)
            return role
    logger.debug("No group match; using default role '{}'", settings.SAML_DEFAULT_ROLE)
    return settings.SAML_DEFAULT_ROLE


# ── DB helpers ───────────────────────────────────────────────────────────────

async def _upsert_saml_user(email: str, display_name: str, role: str) -> dict:
    """Create or update a user record for a SAML-authenticated identity."""
    logger.info("Upserting SAML user | email={} role={}", email, role)
    db = await get_db()
    # Use the local part of the UPN/email as username
    username = email.split("@")[0]
    # Look up by saml_name_id first (most reliable), fall back to email
    existing = await db.fetchrow(
        "SELECT * FROM users WHERE saml_name_id = $1 OR email = $2 LIMIT 1",
        email,
        email,
    )
    if existing:
        logger.debug("Updating existing SAML user | id={} email={}", existing["id"], email)
        await db.execute(
            """
            UPDATE users
               SET display_name  = $1,
                   role          = $2,
                   saml_name_id  = $3,
                   auth_provider = 'saml',
                   last_login    = now()
             WHERE id = $4
            """,
            display_name,
            role,
            email,
            existing["id"],
        )
        return dict(await db.fetchrow("SELECT * FROM users WHERE id = $1", existing["id"]))

    # Auto-provision new SAML user (no local password)
    logger.info("Provisioning new SAML user | email={} role={}", email, role)
    initials = "".join(p[0].upper() for p in display_name.split()[:2]) if display_name else username[:2].upper()
    row = await db.fetchrow(
        """
        INSERT INTO users (username, email, display_name, initials, password_hash, role,
                           saml_name_id, auth_provider)
        VALUES ($1, $2, $3, $4, NULL, $5, $6, 'saml')
        ON CONFLICT (username) DO UPDATE
          SET email         = EXCLUDED.email,
              display_name  = EXCLUDED.display_name,
              initials      = EXCLUDED.initials,
              role          = EXCLUDED.role,
              saml_name_id  = EXCLUDED.saml_name_id,
              auth_provider = 'saml',
              last_login    = now()
        RETURNING *
        """,
        username,
        email,
        display_name or username,
        initials,
        role,
        email,
    )
    return dict(row)


# ── Routes ───────────────────────────────────────────────────────────────────

@router.get("/login")
async def saml_login(request: Request, next: str = "", saml_request: Optional[str] = None):
    """
    Redirect browser to ADFS login page with a SAMLRequest.

    saml_request — optional override for the SAMLRequest query parameter.
    The rest of the URL (IdP endpoint, RelayState, SigAlg, Signature) is
    preserved exactly as python3-saml generated it.
    """
    logger.info("SAML login initiated | ip={} next={} custom_saml_request={}",
                request.client.host if request.client else "unknown",
                next or "(none)",
                bool(saml_request))
    auth = _get_saml_auth(request)
    # Validate next against the portal origin to prevent open-redirect
    relay_state = next if _is_allowed_redirect(next) else settings.PORTAL_URL
    login_url = auth.login(return_to=relay_state)
    if saml_request:
        login_url = _replace_saml_request(login_url, saml_request)
        logger.debug("SAMLRequest overridden with custom token")
    logger.debug("Redirecting to IdP | url={}", login_url)
    return RedirectResponse(url=login_url, status_code=302)


@router.post("/acs")
async def saml_acs(request: Request):
    """
    Assertion Consumer Service.
    ADFS POSTs the SAMLResponse (base64 XML) here.
    We validate it, provision the user, issue a short-lived one-time code,
    and redirect the browser back to the React SPA which exchanges it for a JWT.
    """
    logger.info("SAML ACS request received | ip={}", request.client.host if request.client else "unknown")
    form = await request.form()
    req_dict = _prepare_fastapi_request(request)
    req_dict["post_data"] = dict(form)

    try:
        from onelogin.saml2.auth import OneLogin_Saml2_Auth
    except ImportError:
        logger.error("python3-saml is not installed")
        raise HTTPException(status_code=503, detail="python3-saml not installed")

    auth = OneLogin_Saml2_Auth(req_dict, _build_saml_settings())
    auth.process_response()

    errors = auth.get_errors()
    if errors:
        logger.error("SAML ACS validation errors | errors={} reason={}", errors, auth.get_last_error_reason())
        raise HTTPException(status_code=401, detail=f"SAML error: {', '.join(errors)}")

    if not auth.is_authenticated():
        logger.warning("SAML ACS: response not authenticated")
        raise HTTPException(status_code=401, detail="SAML authentication failed")

    attrs = auth.get_attributes()
    name_id = auth.get_nameid()  # email / UPN
    logger.info("SAML ACS: authenticated | name_id={}", name_id)

    # Extract display name from SAML attributes
    NAME_CLAIM = "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name"
    DISP_CLAIM = "http://schemas.microsoft.com/ws/2008/06/identity/claims/windowsaccountname"
    display_name = (
        attrs.get(NAME_CLAIM, [None])[0]
        or attrs.get(DISP_CLAIM, [None])[0]
        or name_id
    )

    # Extract group memberships
    GROUP_CLAIM = "http://schemas.microsoft.com/ws/2008/06/identity/claims/groups"
    groups = attrs.get(GROUP_CLAIM, [])
    logger.debug("SAML ACS: groups={} display_name={}", groups, display_name)

    role = _resolve_role(groups)
    user = await _upsert_saml_user(email=name_id, display_name=display_name, role=role)

    # Issue one-time code; React SPA will exchange it for a JWT
    code = _issue_saml_code(str(user["id"]), user["role"])

    portal_origin = settings.PORTAL_URL.rstrip("/")
    # Redirect to frontend /login with the one-time code (ignore RelayState
    # for the final redirect — code exchange always goes to /login)
    redirect_url = f"{portal_origin}/login?saml_code={urllib.parse.quote(code)}"
    logger.info("SAML ACS: redirecting user to portal | user_id={}", user["id"])
    return RedirectResponse(url=redirect_url, status_code=302)


@router.get("/callback")
async def saml_callback(saml_code: str):
    """
    Called by the React SPA after being redirected from /saml/acs.
    Exchanges the one-time saml_code for a JWT access token.
    """
    logger.info("SAML callback: code exchange requested")
    entry = _consume_saml_code(saml_code)
    if not entry:
        logger.warning("SAML callback: invalid or expired code")
        raise HTTPException(status_code=401, detail="Invalid or expired SAML code")

    token = create_access_token(entry["user_id"], entry["role"])
    logger.info("SAML callback: JWT issued | user_id={} role={}", entry["user_id"], entry["role"])
    return {"access_token": token, "token_type": "bearer"}


@router.get("/logout")
async def saml_logout(request: Request, user_id: Optional[str] = None):
    """
    SP-initiated logout — sends a LogoutRequest to ADFS.
    The frontend should call this endpoint; it redirects the browser to ADFS SLO.
    Pass name_id + session_index as query params if stored by the frontend.
    """
    name_id = request.query_params.get("name_id")
    session_index = request.query_params.get("session_index")
    logger.info("SAML logout initiated | ip={} name_id={}", request.client.host if request.client else "unknown", name_id)

    auth = _get_saml_auth(request)
    logout_url = auth.logout(name_id=name_id, session_index=session_index)
    logger.debug("Redirecting to IdP SLO | url={}", logout_url)
    return RedirectResponse(url=logout_url, status_code=302)


@router.get("/sls")
async def saml_sls(request: Request):
    """
    Single Logout Service — handles both SP-initiated and IdP-initiated SLO.
    ADFS redirects here with a LogoutResponse or LogoutRequest.
    """
    logger.info("SAML SLS request received | ip={}", request.client.host if request.client else "unknown")
    req_dict = _prepare_fastapi_request(request)
    req_dict["get_data"] = dict(request.query_params)

    try:
        from onelogin.saml2.auth import OneLogin_Saml2_Auth
    except ImportError:
        logger.error("python3-saml is not installed")
        raise HTTPException(status_code=503, detail="python3-saml not installed")

    auth = OneLogin_Saml2_Auth(req_dict, _build_saml_settings())

    redirect_url = auth.process_slo(keep_local_session=False, delete_session_cb=lambda: None)
    errors = auth.get_errors()
    if errors:
        logger.error("SAML SLS errors | errors={}", errors)
        raise HTTPException(status_code=400, detail=f"SLO error: {', '.join(errors)}")

    logger.info("SAML SLS completed | redirect={}", redirect_url or settings.PORTAL_URL)
    return RedirectResponse(url=redirect_url or settings.PORTAL_URL, status_code=302)


@router.get("/metadata")
async def saml_metadata():
    """
    Serve SP metadata XML.
    Give this URL to your AD admin so they can configure the Relying Party Trust.
    """
    logger.info("SAML metadata requested")
    try:
        from onelogin.saml2.settings import OneLogin_Saml2_Settings
    except ImportError:
        logger.error("python3-saml is not installed")
        raise HTTPException(status_code=503, detail="python3-saml not installed")

    sp_settings = OneLogin_Saml2_Settings(_build_saml_settings(), sp_validation_only=True)
    metadata = sp_settings.get_sp_metadata()
    errors = sp_settings.validate_metadata(metadata)
    if errors:
        logger.error("SP metadata validation failed | errors={}", errors)
        raise HTTPException(status_code=500, detail=f"SP metadata invalid: {errors}")

    logger.debug("SP metadata served successfully")
    return Response(content=metadata, media_type="text/xml")
