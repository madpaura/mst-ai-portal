"""add category to solution_cards

Revision ID: 0005
Revises: 0004
Create Date: 2026-05-04
"""
from alembic import op
import sqlalchemy as sa

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("""
        ALTER TABLE solution_cards
        ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'none'
    """)


def downgrade():
    op.execute("ALTER TABLE solution_cards DROP COLUMN IF EXISTS category")
