"""mst-ingest — CLI entry point."""
import click

from .commands.login import login, logout, whoami
from .commands.run import run
from .commands.status import status
from .commands.template import template
from .commands.validate import validate


@click.group()
@click.version_option("0.1.0", prog_name="mst-ingest")
def cli() -> None:
    """MST AI Portal — Video Ingest CLI.

    Validate, upload, and auto-process videos without leaving the terminal.
    Videos are always created as drafts; publish manually from the portal.
    """


cli.add_command(login)
cli.add_command(logout)
cli.add_command(whoami)
cli.add_command(run)
cli.add_command(validate)
cli.add_command(status)
cli.add_command(template)
