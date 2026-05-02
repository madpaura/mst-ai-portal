"""Authenticate and cache a token in ~/.mst-ingest.json for reuse."""
from __future__ import annotations

import json

import click

from ..lib import progress as ui
from ..lib.api import APIClient, APIError
from ..lib.auth import CONFIG_FILE, _load_config, _save_config


@click.command("login")
@click.option("--api-url", envvar="MST_API_URL", default=None, help="Portal API base URL")
@click.option("--username", "-u", envvar="MST_USERNAME", default=None, help="Username")
@click.option("--password", "-p", envvar="MST_PASSWORD", default=None, help="Password (prompted if omitted)")
@click.option("--show-token", is_flag=True, help="Print the token after login")
def login(
    api_url: str | None,
    username: str | None,
    password: str | None,
    show_token: bool,
) -> None:
    """Log in and save a token to ~/.mst-ingest.json.

    The cached token is reused by all other commands so you don't have to
    pass --token or credentials every time.

    \b
    Examples:
      mst-ingest login
      mst-ingest login --username admin --api-url http://mst.ai.samsungds.net/backend
      mst-ingest login --show-token
    """
    cfg = _load_config()
    url = api_url or cfg.get("api_url") or "http://localhost:8000"

    if not username:
        username = click.prompt("  Username")
    if not password:
        password = click.prompt("  Password", hide_input=True)

    try:
        token = APIClient.login(url, username, password)
    except APIError as exc:
        ui.error(str(exc))
        raise SystemExit(1)

    _save_config({"api_url": url, "token": token})

    ui.console.print(f"\n  [green]✓[/green] Logged in as [bold]{username}[/bold]")
    ui.console.print(f"  [dim]Token cached at {CONFIG_FILE}[/dim]")

    if show_token:
        ui.console.print(f"\n  [bold cyan]Token:[/bold cyan] {token}")


@click.command("logout")
def logout() -> None:
    """Clear the cached token from ~/.mst-ingest.json."""
    cfg = _load_config()
    if "token" not in cfg:
        ui.console.print("  [dim]No cached token found.[/dim]")
        return
    cfg.pop("token", None)
    CONFIG_FILE.write_text(json.dumps(cfg, indent=2))
    CONFIG_FILE.chmod(0o600)
    ui.console.print("  [green]✓[/green] Logged out — token cleared.")


@click.command("whoami")
def whoami() -> None:
    """Show the currently cached API URL and whether a token exists."""
    cfg = _load_config()
    url = cfg.get("api_url") or "http://localhost:8000 (default)"
    tok = cfg.get("token")

    ui.console.print(f"  API URL : [cyan]{url}[/cyan]")
    if tok:
        preview = tok[:12] + "..." + tok[-6:]
        ui.console.print(f"  Token   : [green]cached[/green] [dim]({preview})[/dim]")
    else:
        ui.console.print("  Token   : [yellow]none[/yellow] — run [bold]mst-ingest login[/bold]")
