from database import get_db
from auth.service import hash_password


async def seed_admin_user():
    db = await get_db()
    existing = await db.fetchrow("SELECT id FROM users WHERE username = 'admin'")
    if existing:
        return

    await db.execute(
        """
        INSERT INTO users (username, email, display_name, initials, password_hash, role)
        VALUES ($1, $2, $3, $4, $5, $6)
        """,
        "admin",
        "admin@mst.internal",
        "Admin User",
        "AD",
        hash_password("admin"),
        "admin",
    )
    print("[seed] Admin user created (admin/admin)")
