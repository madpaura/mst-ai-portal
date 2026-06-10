"""articles.pdf_url / pdf_filename — article rendered as an embedded PDF instead of markdown"""
from alembic import op

revision = '0026'
down_revision = '0025'
branch_labels = None
depends_on = None


def upgrade():
    op.execute("ALTER TABLE articles ADD COLUMN IF NOT EXISTS pdf_url TEXT")
    op.execute("ALTER TABLE articles ADD COLUMN IF NOT EXISTS pdf_filename TEXT")


def downgrade():
    op.execute("ALTER TABLE articles DROP COLUMN IF EXISTS pdf_url")
    op.execute("ALTER TABLE articles DROP COLUMN IF EXISTS pdf_filename")
