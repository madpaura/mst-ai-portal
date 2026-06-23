"""
Type-aware install how-to guides + the "About" LLM prompt.

Shared by the Forge GitHub sync worker (`forge/sync_worker.py`) and the Artifact
Hub publish flow (`artifacts/admin_router.py`) so both produce identical,
type-appropriate install instructions and a friendly, length-capped About text.

Artifact/component types are normalised here: the marketplace uses
`mcp_server` while the hub uses `mcp` — both map to the same guide.
"""
import re
import hashlib
from typing import Optional


def normalize_type(t: Optional[str]) -> str:
    t = (t or "").lower()
    if t in ("mcp", "mcp_server", "mcp-server"):
        return "mcp"
    if t == "agent":
        return "agent"
    return "skill"


# ── Repo-URL helpers (host-aware install commands) ────────────────────────────

def clean_repo_url(git_url: Optional[str]) -> Optional[str]:
    """Return a clean, browsable HTTPS repo URL (no credentials, no trailing .git)."""
    if not git_url:
        return None
    url = git_url.strip()
    # Normalise SSH form: git@host:owner/repo(.git) → https://host/owner/repo
    m = re.match(r'git@([^:]+):(.+)', url)
    if m:
        url = f"https://{m.group(1)}/{m.group(2)}"
    # Strip any embedded credentials (https://user:token@host/…)
    url = re.sub(r'^(https?://)[^@/]+@', r'\1', url)
    url = url.rstrip('/')
    if url.endswith('.git'):
        url = url[:-4]
    return url or None


def _resolve_repo(owner_repo: Optional[str], repo_url: Optional[str]) -> tuple[str, str, str]:
    """Resolve the repo references used inside install guides.

    Returns ``(repo_ref, clone_url, browse_url)`` where:
    - ``repo_ref`` is what `npx skills add` / discovery commands use — the
      ``owner/repo`` shorthand for github.com, or the full HTTPS URL for any
      other (self-hosted / enterprise) host so the CLI hits the right server.
    - ``clone_url`` is the ``git clone`` target (``…​.git``).
    - ``browse_url`` is the clean HTTPS URL for links.
    """
    clean = clean_repo_url(repo_url)
    if not clean and owner_repo:
        clean = f"https://github.com/{owner_repo}"
    if not clean:
        clean = "https://github.com/<owner>/<repo>"

    m = re.match(r'https?://([^/]+)/(.+)', clean)
    host = m.group(1).lower() if m else "github.com"
    path = m.group(2) if m else (owner_repo or "<owner>/<repo>")

    is_github_com = host in ("github.com", "www.github.com")
    repo_ref = path if is_github_com else clean
    clone_url = f"{clean}.git"
    return repo_ref, clone_url, clean


# ── Install how-to guides ─────────────────────────────────────────────────────

def _skill_guide(slug: str, name: str, repo: str, clone_url: str) -> str:
    return f"""## How to Install {name}

> Agent skills extend what Claude Code and other AI coding agents can do.

### Prerequisites

Node.js 16+ — verify with:

```bash
node --version
```

### One-Time Setup (recommended)

Install the `skills` CLI globally so you never wait for `npx` to re-download it:

```bash
npm install -g skills
```

From here you can replace `npx skills` with `skills` in any command below.

### Discover

List everything available in the repo before installing:

```bash
npx skills add {repo} --list
```

### Install

Install this skill globally (available in every project):

```bash
npx skills add {repo} --skill {slug} --agent claude-code --global --yes
```

Install into the current project only (commit `./.claude/skills/` with your repo):

```bash
npx skills add {repo} --skill {slug} --agent claude-code --yes
```

### Install Scopes

| Flag | Where files land | Use case |
|------|------------------|----------|
| `--global` (`-g`) | `~/.claude/skills/` | Available in all projects |
| *(no flag)* | `./.claude/skills/` | This project only, committable |

### Manual Install (restricted or self-hosted repos)

If `npx skills add {repo}` can't reach the repo directly — a self-hosted / enterprise
Git server, a private repo, or one behind a corporate TLS proxy — clone it first and
install from the local checkout instead.

```bash
# 1. Clone the repo (drop -c http.sslVerify=false once your cert chain is trusted)
git -c http.sslVerify=false clone {clone_url} /tmp/{slug}-src

# 2. Install the skill from the local path
npx skills add /tmp/{slug}-src --skill {slug} --agent claude-code --global --yes
```

If access is still restricted, download the skill folder manually and copy it
straight into your skills directory:

```bash
mkdir -p ~/.claude/skills
cp -r /tmp/{slug}-src/{slug} ~/.claude/skills/{slug}
ls ~/.claude/skills/{slug}/SKILL.md   # sanity check
```

Restart Claude Code, then run `npx skills list --agent claude-code` to confirm.

### After Installing

```bash
npx skills list --agent claude-code   # confirm it is installed
ls ~/.claude/skills/                  # verify Claude Code can see it
```

### Update

```bash
npx skills update {slug}
```

### Remove

```bash
npx skills remove {slug}
```
"""


def _agent_guide(slug: str, name: str, repo: str, clone_url: str) -> str:
    return f"""## How to Install {name}

> Agents are role-configured AI personas for Claude Code, stored under `~/.claude/agents/`.

### Prerequisites

- Claude Code installed
- `git` available on your PATH

### Install (global — all projects)

```bash
git clone {clone_url} /tmp/{slug}-src
cp -r /tmp/{slug}-src/{slug} ~/.claude/agents/
```

If this agent is also published to the skills registry, you can instead run:

```bash
npx skills add {repo} --agent {slug} --global --yes
```

### Install (this project only)

```bash
mkdir -p .claude/agents
cp -r /tmp/{slug}-src/{slug} .claude/agents/
```

### Verify

```bash
ls ~/.claude/agents/
```

Restart Claude Code — the agent then appears in your available-agents list.

### Update

Re-run the clone + copy above, or if installed via the registry:

```bash
npx skills update {slug}
```

### Remove

```bash
rm -rf ~/.claude/agents/{slug}
```
"""


def _mcp_guide(slug: str, name: str, repo: str) -> str:
    return f"""## How to Install {name}

> {name} is a Model Context Protocol (MCP) server that exposes tools and data to Claude.

### Prerequisites

- Claude Code (or another MCP-capable client)
- Node.js 18+ for `npx`-based servers

### Quick Add (Claude CLI)

```bash
claude mcp add {slug} -- npx -y {repo}
```

### Manual Configuration

Add the server to your MCP config (`~/.claude/mcp.json`, or your client's config file):

```json
{{
  "mcpServers": {{
    "{slug}": {{
      "command": "npx",
      "args": ["-y", "{repo}"]
    }}
  }}
}}
```

Restart your client so it picks up the new server.

### Verify

```bash
claude mcp list
```

The server should appear as `{slug}`, and its tools become available to Claude.

### Remove

```bash
claude mcp remove {slug}
```
"""


def generate_howto_guide(
    slug: str, name: str, artifact_type: str,
    owner_repo: Optional[str] = None, repo_url: Optional[str] = None,
) -> str:
    """Return a type-appropriate install how-to guide for an artifact/component.

    ``repo_url`` (the actual sync/publish source, e.g. an enterprise GitHub host)
    takes precedence so manual `git clone` / `npx skills add` steps point at the
    real host rather than always defaulting to github.com. ``owner_repo`` is the
    legacy ``owner/repo`` shorthand, used as a fallback.
    """
    repo_ref, clone_url, _browse = _resolve_repo(owner_repo, repo_url)
    t = normalize_type(artifact_type)
    if t == "agent":
        return _agent_guide(slug, name, repo_ref, clone_url)
    if t == "mcp":
        return _mcp_guide(slug, name, repo_ref)
    return _skill_guide(slug, name, repo_ref, clone_url)


# ── About section (LLM) ───────────────────────────────────────────────────────

ABOUT_WORD_LIMIT = 200

# Bump this whenever build_about_prompt changes so stored Abouts are regenerated
# on the next sync (the source hash is namespaced by this version).
ABOUT_PROMPT_VERSION = "2"


def about_source_hash(source_text: str) -> str:
    """Version-namespaced hash of the About source, so a prompt change forces a refresh."""
    h = hashlib.sha256((source_text or "").encode("utf-8")).hexdigest()
    return f"{ABOUT_PROMPT_VERSION}:{h}"


def build_about_prompt(name: str, artifact_type: str, source_text: str) -> str:
    """Prompt the LLM to turn raw README/description text into a friendly About blurb."""
    t = normalize_type(artifact_type)
    type_word = {"agent": "AI agent", "mcp": "MCP server", "skill": "agent skill"}[t]
    source = (source_text or "").strip()[:4000]
    return (
        f'Write a clear, friendly "About" section for a {type_word} called "{name}", '
        f"shown in an internal AI tools marketplace.\n\n"
        f"Source material (README / description):\n"
        f'"""\n{source}\n"""\n\n'
        f"Format the answer in **Markdown** so it renders nicely:\n"
        f"- Start with one short bold sentence summarising what it is.\n"
        f"- Then a `**Key features**` (or `**What it does**`) line followed by a "
        f"Markdown bullet list (`- item`) of 3-5 concise points.\n"
        f"- End with a one-line `**When to use:**` note.\n"
        f"- Use **bold** for key terms and `inline code` for commands/file names where natural.\n\n"
        f"Rules:\n"
        f"- Plain, approachable English for a technical but busy audience.\n"
        f"- HARD LIMIT: {ABOUT_WORD_LIMIT} words maximum.\n"
        f"- Do NOT include a top-level heading (no `#`/`##` title) and do NOT wrap the whole answer in code fences.\n"
        f"Return only the Markdown About text."
    )


def clamp_words(text: str, limit: int = ABOUT_WORD_LIMIT) -> str:
    """Cap the About at `limit` words while preserving Markdown line structure."""
    text = (text or "").strip()
    # Strip an accidental wrapping code fence (```markdown … ```), language tag and all.
    if text.startswith("```"):
        text = re.sub(r'^```[A-Za-z0-9_-]*\n?', '', text)
        text = re.sub(r'\n?```\s*$', '', text).strip()
    if len(text.split()) <= limit:
        return text
    # Truncate to `limit` words but keep the original whitespace/newlines between them,
    # so bullet lists and paragraph breaks survive the cut.
    count = 0
    out: list[str] = []
    for tok in re.split(r'(\s+)', text):
        if tok == '' or tok.isspace():
            out.append(tok)
            continue
        if count >= limit:
            break
        out.append(tok)
        count += 1
    return ''.join(out).rstrip() + '…'
