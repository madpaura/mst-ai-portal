import secrets
import string
from loguru import logger as log
from database import get_db
from auth.service import hash_password


def _random_password(length: int = 20) -> str:
    alphabet = string.ascii_letters + string.digits + "!@#$%^&*"
    return "".join(secrets.choice(alphabet) for _ in range(length))


async def seed_admin_user():
    """Create the default admin user only if SEED_DEFAULT_ADMIN=true (default).

    In production set SEED_DEFAULT_ADMIN=false to skip seeding entirely.
    """
    from config import settings
    if not settings.SEED_DEFAULT_ADMIN:
        return

    db = await get_db()
    existing = await db.fetchrow("SELECT id FROM users WHERE username = 'admin'")
    if existing:
        return

    # Generate a random password instead of the hardcoded "admin/admin"
    tmp_password = _random_password()
    await db.execute(
        """
        INSERT INTO users (username, email, display_name, initials, password_hash, role)
        VALUES ($1, $2, $3, $4, $5, $6)
        """,
        "admin",
        "admin@mst.internal",
        "Admin User",
        "AD",
        hash_password(tmp_password),
        "admin",
    )
    log.warning("=" * 60)
    log.warning("Admin user created. Temporary password (change immediately):")
    log.warning(f"  username: admin")
    log.warning(f"  password: {tmp_password}")
    log.warning("Set SEED_DEFAULT_ADMIN=false to disable seeding.")
    log.warning("=" * 60)
