import re

# Detects real secrets — these are errors that block submission
_SECRET_PATTERNS: list[tuple[str, str]] = [
    (r'sk-[a-zA-Z0-9]{20,}', 'OpenAI/Anthropic API key'),
    (r'sk-proj-[a-zA-Z0-9_\-]{20,}', 'OpenAI project API key'),
    (r'ghp_[a-zA-Z0-9]{36,}', 'GitHub Personal Access Token'),
    (r'ghs_[a-zA-Z0-9]{36,}', 'GitHub App token'),
    (r'github_pat_[a-zA-Z0-9_]{82}', 'GitHub fine-grained PAT'),
    (r'AKIA[0-9A-Z]{16}', 'AWS Access Key ID'),
    (r'(?i)aws_secret_access_key\s*[=:]\s*["\']?[a-zA-Z0-9/+]{40}', 'AWS Secret Access Key'),
    (r'xox[baprs]-[a-zA-Z0-9_\-]{10,}', 'Slack token'),
    (r'SG\.[a-zA-Z0-9_\-]{22}\.[a-zA-Z0-9_\-]{43}', 'SendGrid API key'),
    (r'AIza[0-9A-Za-z_\-]{35}', 'Google API key'),
    (r'(?i)(password|passwd|pwd)\s*=\s*["\'][^"\']{6,}["\']', 'Hardcoded password'),
    (r'(?i)(api[_-]?key|apikey)\s*=\s*["\'][a-zA-Z0-9_\-]{12,}["\']', 'Hardcoded API key'),
    (r'(?i)secret[_-]?key\s*=\s*["\'][a-zA-Z0-9_\-]{8,}["\']', 'Hardcoded secret key'),
    (r'(?i)(access[_-]?token|auth[_-]?token)\s*=\s*["\'][a-zA-Z0-9_\-\.]{12,}["\']', 'Hardcoded token'),
    # JWT
    (r'eyJ[a-zA-Z0-9_\-]{10,}\.eyJ[a-zA-Z0-9_\-]{10,}', 'Embedded JWT'),
    # Private keys
    (r'-----BEGIN (RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----', 'Private key material'),
    # Connection strings with embedded credentials
    (r'(?i)(postgres|mysql|mongodb)://[^:]+:[^@]+@', 'Database connection string with credentials'),
]

# Patterns that raise warnings (risky but not necessarily malicious)
_RISKY_PATTERNS: list[tuple[str, str]] = [
    (r'(?i)eval\s*\(.{0,80}(request\.|input\(|sys\.argv|os\.environ|\+)', 'eval() with dynamic/user input'),
    (r'(?i)exec\s*\(.{0,80}(request\.|input\(|sys\.argv|os\.environ|\+)', 'exec() with dynamic/user input'),
    (r'(?i)subprocess\.(call|run|Popen).{0,120}shell\s*=\s*True', 'subprocess with shell=True'),
    (r'(?i)os\.system\s*\(.{0,80}(\+|format\(|f["\'])', 'os.system with dynamic argument'),
    (r'(?i)pickle\.loads?\s*\(', 'Unsafe pickle deserialization'),
    (r'(?i)__import__\s*\(.{0,60}(\+|format\()', 'Dynamic __import__'),
    (r'(?i)importlib\.import_module\s*\(.{0,60}(\+|format\()', 'Dynamic importlib usage'),
    (r'(?i)(urllib|requests|httpx)\.(get|post|put|delete|request)\s*\(.{0,120}(token|secret|key|password)', 'HTTP call with potential credential in URL/param'),
    (r'(?i)open\s*\(.{0,80}(\/etc\/|\/proc\/|\.\.\/)', 'File access outside working directory'),
    (r'(?i)(shutil\.rmtree|os\.remove|os\.unlink)\s*\(.{0,80}(\+|format\(|f["\'])', 'Dynamic file deletion'),
]


def validate_files(files: list[dict]) -> dict:
    """
    Runs security checks on submitted artifact files.
    Returns a dict with keys: passed (bool), errors (list), warnings (list).
    Each item has: severity, file, line, message, pattern.
    """
    errors: list[dict] = []
    warnings: list[dict] = []

    for file_obj in files:
        fname = file_obj.get("name", "unknown")
        content = file_obj.get("content", "")
        lines = content.splitlines()

        for lineno, line in enumerate(lines, 1):
            for pattern, description in _SECRET_PATTERNS:
                if re.search(pattern, line):
                    errors.append({
                        "severity": "error",
                        "file": fname,
                        "line": lineno,
                        "message": f"Potential secret detected: {description}",
                        "pattern": description,
                    })

            for pattern, description in _RISKY_PATTERNS:
                if re.search(pattern, line):
                    warnings.append({
                        "severity": "warning",
                        "file": fname,
                        "line": lineno,
                        "message": f"Potentially unsafe pattern: {description}",
                        "pattern": description,
                    })

    return {
        "passed": len(errors) == 0,
        "errors": errors,
        "warnings": warnings,
    }
