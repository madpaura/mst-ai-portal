"""Point saved MMRAG space links at the portal's nginx.

Links used to be copied from `setup.sh list`, which now reports NodePorts.
"""
from alembic import op

revision = '0038'
down_revision = '0037'
branch_labels = None
depends_on = None


def upgrade():
    op.execute(
        """
        UPDATE mmrag_spaces
        SET api_url = '/mmrag/' || slug || '/api/', mgmt_url = '/mmrag/' || slug || '/mgmt/'
        WHERE mgmt_url IS NOT NULL
        """
    )


def downgrade():
    # The old links were never kept, and the new ones work with older code.
    pass
