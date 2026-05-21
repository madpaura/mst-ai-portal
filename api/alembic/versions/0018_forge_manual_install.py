"""add manual_install to forge_components

Revision ID: 0018
Revises: 0017
Create Date: 2026-05-22
"""
from alembic import op

revision = '0018'
down_revision = '0017'
branch_labels = None
depends_on = None


def upgrade():
    op.execute(
        "ALTER TABLE forge_components ADD COLUMN IF NOT EXISTS manual_install TEXT"
    )


def downgrade():
    op.execute(
        "ALTER TABLE forge_components DROP COLUMN IF EXISTS manual_install"
    )
