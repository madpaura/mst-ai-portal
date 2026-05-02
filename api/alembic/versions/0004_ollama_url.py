"""forge_settings: add ollama_url column

Revision ID: 0004
Revises: 0003
Create Date: 2026-05-02
"""

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    from alembic import op
    op.execute("""
ALTER TABLE forge_settings
    ADD COLUMN IF NOT EXISTS ollama_url TEXT;
""")


def downgrade() -> None:
    from alembic import op
    op.execute("""
ALTER TABLE forge_settings
    DROP COLUMN IF EXISTS ollama_url;
""")
