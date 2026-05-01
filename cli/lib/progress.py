"""Rich console helpers — steps, errors, upload bar, summary panel."""
from rich.console import Console
from rich.panel import Panel
from rich.table import Table
from rich.progress import (
    Progress,
    BarColumn,
    DownloadColumn,
    TransferSpeedColumn,
    TimeRemainingColumn,
    TextColumn,
)

console = Console()


def header(api_url: str = "", user: str = "") -> None:
    lines = ["[bold blue]MST AI — Video Ingest CLI[/bold blue]"]
    if api_url:
        lines.append(f"[dim]API: {api_url}[/dim]")
    if user:
        lines.append(f"[dim]User: {user}[/dim]")
    console.print(Panel("\n".join(lines), expand=False))
    console.print()


def step(n: int, total: int, msg: str, ok: bool = True) -> None:
    icon = "[green]✓[/green]" if ok else "[yellow]→[/yellow]"
    console.print(f"  {icon} [{n}/{total}] {msg}")


def error(msg: str) -> None:
    console.print(f"  [red]✗[/red] {msg}")


def warn(msg: str) -> None:
    console.print(f"  [yellow]![/yellow] {msg}")


def make_upload_progress() -> Progress:
    return Progress(
        TextColumn("  [bold cyan]{task.description}"),
        BarColumn(bar_width=36),
        DownloadColumn(),
        TransferSpeedColumn(),
        TimeRemainingColumn(),
        console=console,
    )


def summary_panel(videos: list[dict]) -> None:
    table = Table(box=None, show_header=True, header_style="bold", padding=(0, 2))
    table.add_column("Title", style="white", no_wrap=False)
    table.add_column("Video ID", style="dim")
    table.add_column("Slug", style="cyan")
    table.add_column("Status", style="green")

    for v in videos:
        table.add_row(v["title"], v["id"], v["slug"], v["status"])

    console.print()
    console.print(
        Panel(
            table,
            title="[bold green]Ingestion Complete — Ready for Review[/bold green]",
            subtitle="[dim]Log in to the portal to review and publish[/dim]",
        )
    )
    console.print()
