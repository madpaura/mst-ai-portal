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


# ── Install how-to guides ─────────────────────────────────────────────────────

def _skill_guide(slug: str, name: str, repo: str) -> str:
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


def _agent_guide(slug: str, name: str, repo: str) -> str:
    return f"""## How to Install {name}

> Agents are role-configured AI personas for Claude Code, stored under `~/.claude/agents/`.

### Prerequisites

- Claude Code installed
- `git` available on your PATH

### Install (global — all projects)

```bash
git clone https://github.com/{repo}.git /tmp/{slug}-src
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
    slug: str, name: str, artifact_type: str, owner_repo: Optional[str] = None,
) -> str:
    """Return a type-appropriate install how-to guide for an artifact/component."""
    repo = owner_repo or "<owner/repo>"
    t = normalize_type(artifact_type)
    if t == "agent":
        return _agent_guide(slug, name, repo)
    if t == "mcp":
        return _mcp_guide(slug, name, repo)
    return _skill_guide(slug, name, repo)


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
