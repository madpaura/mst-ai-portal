"""MMRAG SSH bridge: command building, setup.sh output parsing, secret redaction."""
import asyncio
import shlex
from unittest.mock import patch

import asyncssh
import pytest
from pydantic import ValidationError

from mmrag import remote
from mmrag.schemas import SpaceFields
from mmrag.service import slugify

STATUS_OUTPUT = """NAME                     IMAGE            COMMAND                  SERVICE    CREATED       STATUS                 PORTS
mmrag-demo-neo4j-1       neo4j:5          "tini -g -- /startup"    neo4j      2 hours ago   Up 2 hours (healthy)   7474/tcp
mmrag-demo-portal-1      mmrag-portal     "uvicorn app.main:ap"    portal     2 hours ago   Up 2 hours (healthy)   127.0.0.1:19601->8080/tcp
mmrag-demo-postgres-1    pgvector:pg16    "docker-entrypoint.s"    postgres   2 hours ago   Up 2 hours (healthy)   5432/tcp
mmrag-demo-rag-app-1     lightrag:v1.5.2  "python /run.py"         rag-app    2 hours ago   Up 2 hours (healthy)   127.0.0.1:19600->9621/tcp
"""


def _states(health):
    return {s["service"]: s["state"] for s in health["services"]}


def test_health_all_services_healthy():
    health = remote.health_from_status("demo", STATUS_OUTPUT)
    assert health["healthy"] is True
    assert set(_states(health)) == {"neo4j", "portal", "postgres", "rag-app"}


def test_health_crashed_container_is_absent_from_output_but_still_fails():
    output = "\n".join(l for l in STATUS_OUTPUT.splitlines() if "portal" not in l)
    health = remote.health_from_status("demo", output)
    assert health["healthy"] is False
    assert _states(health)["portal"] == "missing"


@pytest.mark.parametrize("state, expected", [
    ("Up 2 hours (unhealthy)", "unhealthy"),
    ("Up 3 seconds (health: starting)", "starting"),
    ("Restarting (1) 4 seconds ago", "unhealthy"),
    ("Exited (1) 4 seconds ago", "unhealthy"),
])
def test_health_bad_states(state, expected):
    output = STATUS_OUTPUT.replace("Up 2 hours (healthy)   127.0.0.1:19600", f"{state}   127.0.0.1:19600")
    health = remote.health_from_status("demo", output)
    assert health["healthy"] is False
    assert _states(health)["rag-app"] == expected


def test_parse_list():
    output = (
        "PROJECT        API                                                MGMT\n"
        "p1             https://x.test/mmrag/p1/api/                       https://x.test/mmrag/p1/mgmt/\n"
    )
    assert remote.parse_list(output) == {
        "p1": {"api_url": "https://x.test/mmrag/p1/api/", "mgmt_url": "https://x.test/mmrag/p1/mgmt/"}
    }


def test_redact_removes_the_key_printed_by_rotate_key():
    text = "project : p1\nkey     : mmr_AbC123\nportal  : https://x/ (user: p1, password: <key>)\n"
    redacted = remote.redact(text)
    assert "mmr_AbC123" not in redacted
    assert "key     : [redacted]" in redacted
    assert "password: <key>" in redacted


def test_redact_catches_a_key_anywhere_in_a_line():
    assert "mmr_Secret9" not in remote.redact("curl -H 'X-API-Key: mmr_Secret9' http://x")


def test_clean_strips_colours():
    assert remote.clean("\x1b[32m✓\x1b[0m done") == "✓ done"


def test_parse_backup_path():
    assert remote.parse_backup_path("stopping…\n✓ backup: /opt/backups/p1-1.tar.gz (12K)\n") == "/opt/backups/p1-1.tar.gz"
    assert remote.parse_backup_path("stopping…\n") is None


def test_build_command_quotes_everything():
    with patch.object(remote.settings, "MMRAG_REMOTE_PATH", "/opt/my mmrag"):
        command = remote.build_command(["deploy", "a; rm -rf /"])
    assert command == f"cd {shlex.quote('/opt/my mmrag')} && ./setup.sh deploy {shlex.quote('a; rm -rf /')}"


def test_build_command_pipes_the_destroy_confirmation():
    with patch.object(remote.settings, "MMRAG_REMOTE_PATH", "/opt/mmrag"):
        command = remote.build_command(["destroy", "p1"], stdin_text="p1")
    assert command == "printf '%s\\n' p1 | ( cd /opt/mmrag && ./setup.sh destroy p1 )"


@pytest.mark.parametrize("name, expected", [
    ("Firmware Validation KB", "firmware-validation-kb"),
    ("  --Hello__World!! ", "hello-world"),
    ("x" * 50, "x" * 31),
    ("a" * 30 + " b", "a" * 30),
    ("日本語", ""),
])
def test_slugify(name, expected):
    assert slugify(name) == expected


@pytest.mark.parametrize("slug", ["-bad", "Bad", "has space", "a;b", "$(id)", "a" * 32, "a/b", "a\nb"])
def test_slug_outside_the_setup_sh_rule_is_refused(slug):
    with pytest.raises(ValidationError):
        SpaceFields(name="Valid name", plm_project="PLM", reason="A long enough reason", slug=slug)


@pytest.mark.parametrize("slug", ["a", "p1", "a-b", "1abc", "a" * 31])
def test_slug_accepted(slug):
    fields = SpaceFields(name="Valid name", plm_project="PLM", reason="A long enough reason", slug=slug)
    assert fields.slug == slug


# ── Over a real SSH connection ────────────────────────────────────────────────

class _Server(asyncssh.SSHServer):
    def begin_auth(self, username):
        return True

    def public_key_auth_supported(self):
        return True


async def _run_in_shell(process):
    proc = await asyncio.create_subprocess_shell(
        process.command,
        stdin=asyncio.subprocess.DEVNULL,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.STDOUT,
    )
    output, _ = await proc.communicate()
    process.stdout.write(output.decode())
    process.exit(proc.returncode)


@pytest.fixture
def ssh_host(tmp_path):
    """A local SSH server, with setup.sh a script that echoes what it was given."""
    remote_dir = tmp_path / "mmrag dir"
    remote_dir.mkdir()
    script = remote_dir / "setup.sh"
    script.write_text(
        "#!/usr/bin/env bash\n"
        'if [[ "$1" == key ]]; then printf "project : %s\\n\\e[32mkey     : mmr_RealKey1\\e[0m\\n" "$2"; exit 0; fi\n'
        'if [[ "$1" == rotate-key ]]; then echo "key     : mmr_NewKey2"; exit 0; fi\n'
        'if [[ "$1" == destroy ]]; then read -r ans; echo "answer=$ans"; exit 0; fi\n'
        'if [[ "$1" == fail ]]; then echo boom; exit 3; fi\n'
        'echo "args: $*"\n'
    )
    script.chmod(0o755)

    host_key = asyncssh.generate_private_key("ssh-ed25519")
    client_key = asyncssh.generate_private_key("ssh-ed25519")
    client_key_path = tmp_path / "id_ed25519"
    client_key.write_private_key(str(client_key_path))
    authorized = tmp_path / "authorized_keys"
    client_key.write_public_key(str(authorized))
    return {"dir": remote_dir, "host_key": host_key, "client_key": client_key_path, "authorized": authorized, "tmp": tmp_path}


async def _with_server(ssh_host, known_host_key, body):
    server = await asyncssh.listen(
        "127.0.0.1", 0,
        server_host_keys=[ssh_host["host_key"]],
        authorized_client_keys=str(ssh_host["authorized"]),
        server_factory=_Server,
        process_factory=_run_in_shell,
    )
    port = server.get_port()
    known_hosts = ssh_host["tmp"] / "known_hosts"
    known_hosts.write_text(f"[127.0.0.1]:{port} {known_host_key.export_public_key().decode()}")
    try:
        with patch.multiple(
            remote.settings,
            MMRAG_SSH_HOST="127.0.0.1",
            MMRAG_SSH_PORT=port,
            MMRAG_SSH_USER="mmrag",
            MMRAG_SSH_KEY_PATH=str(ssh_host["client_key"]),
            MMRAG_SSH_KNOWN_HOSTS=str(known_hosts),
            MMRAG_REMOTE_PATH=str(ssh_host["dir"]),
        ):
            return await body()
    finally:
        server.close()
        await server.wait_closed()


def test_run_streams_output_over_ssh(ssh_host):
    seen = []

    async def on_line(line):
        seen.append(line)

    async def body():
        return await remote.run(["deploy", "p1"], on_line=on_line)

    result = asyncio.run(_with_server(ssh_host, ssh_host["host_key"], body))
    assert result.ok
    assert result.output == "args: deploy p1\n"
    assert seen == ["args: deploy p1\n"]


def test_exit_status_is_reported(ssh_host):
    result = asyncio.run(_with_server(ssh_host, ssh_host["host_key"], lambda: remote.run(["fail"])))
    assert result.exit_status == 3
    assert not result.ok


def test_destroy_prompt_is_answered_on_stdin(ssh_host):
    result = asyncio.run(_with_server(ssh_host, ssh_host["host_key"], lambda: remote.run(["destroy", "p1"], stdin_text="p1")))
    assert result.output == "answer=p1\n"


def test_fetch_key_returns_the_key_without_colours(ssh_host):
    key = asyncio.run(_with_server(ssh_host, ssh_host["host_key"], lambda: remote.fetch_key("p1")))
    assert key == "mmr_RealKey1"


def test_run_redacts_the_key_rotate_key_prints(ssh_host):
    result = asyncio.run(_with_server(ssh_host, ssh_host["host_key"], lambda: remote.run(["rotate-key", "p1"])))
    assert "mmr_NewKey2" not in result.output


@pytest.mark.parametrize("output, expected", [
    ("PROJECT  API  MGMT\n", {}),
    ("PROJECT  API  MGMT\np1  https://x/api/  https://x/mgmt/\n", {"p1": {"api_url": "https://x/api/", "mgmt_url": "https://x/mgmt/"}}),
])
def test_list_exiting_1_after_printing_is_not_a_failure(output, expected):
    async def fake_run(*args, **kwargs):
        return remote.RemoteResult(1, output)

    with patch.object(remote, "run", fake_run):
        assert asyncio.run(remote.list_projects()) == expected


def test_list_without_a_header_is_a_failure():
    async def fake_run(*args, **kwargs):
        return remote.RemoteResult(127, "bash: ./setup.sh: No such file or directory\n")

    with patch.object(remote, "run", fake_run):
        with pytest.raises(remote.RemoteError):
            asyncio.run(remote.list_projects())


def test_unknown_host_key_is_refused(ssh_host):
    wrong_key = asyncssh.generate_private_key("ssh-ed25519")

    async def body():
        await remote.run(["list"])

    with pytest.raises(remote.RemoteError):
        asyncio.run(_with_server(ssh_host, wrong_key, body))


def test_not_configured_raises():
    with patch.object(remote.settings, "MMRAG_SSH_HOST", ""):
        with pytest.raises(remote.RemoteNotConfigured):
            asyncio.run(remote.run(["list"]))
