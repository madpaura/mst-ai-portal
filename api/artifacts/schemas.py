from pydantic import BaseModel, field_validator
from typing import Optional
from datetime import datetime
import re

from config import settings


class ArtifactFile(BaseModel):
    name: str
    content: str

    @field_validator("name")
    @classmethod
    def safe_filename(cls, v: str) -> str:
        # Allow path separators for ZIP-extracted nested paths (e.g. src/main.py)
        if not re.match(r'^[\w\-. /]+$', v):
            raise ValueError("File name contains unsafe characters")
        if '..' in v or v.startswith('/'):
            raise ValueError("File name must not traverse directories")
        return v.strip('/')


class ArtifactGithubTypeConfig(BaseModel):
    url: str = ""
    branch: str = "main"
    folder: str = ""
    token: str = ""


class ArtifactGithubConfig(BaseModel):
    agent: ArtifactGithubTypeConfig = ArtifactGithubTypeConfig()
    skill: ArtifactGithubTypeConfig = ArtifactGithubTypeConfig()
    mcp: ArtifactGithubTypeConfig = ArtifactGithubTypeConfig()


class ArtifactAllowedTypes(BaseModel):
    allowed: list[str] = ["agent", "skill", "mcp"]
    # Combined upload limit (MB) for a submission — surfaced so the New/Edit
    # forms can enforce the same cap as the backend. Ignored on write.
    max_files_mb: int = settings.ARTIFACT_MAX_FILES_MB

    @field_validator("allowed")
    @classmethod
    def valid_types(cls, v: list) -> list:
        valid = {"agent", "skill", "mcp"}
        cleaned = [t for t in v if t in valid]
        if not cleaned:
            raise ValueError("At least one artifact type must be allowed")
        # preserve canonical order and de-dupe
        return [t for t in ("agent", "skill", "mcp") if t in cleaned]


class ArtifactSubmissionCreate(BaseModel):
    name: str
    display_name: str
    artifact_type: str
    description: Optional[str] = None
    instructions: Optional[str] = None
    files: list[ArtifactFile] = []
    tags: list[str] = []
    parent_slug: Optional[str] = None
    version_tag: Optional[str] = None
    version_bump: Optional[str] = None

    @field_validator("version_bump")
    @classmethod
    def valid_bump(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and v not in ("major", "minor", "patch"):
            raise ValueError("version_bump must be major, minor, or patch")
        return v

    @field_validator("name")
    @classmethod
    def safe_name(cls, v: str) -> str:
        v = v.strip().lower()
        if not re.match(r'^[a-z0-9][a-z0-9_\-]*$', v):
            raise ValueError("Name must be slug-like: lowercase letters, digits, hyphens, underscores")
        if len(v) > 64:
            raise ValueError("Name must be 64 characters or fewer")
        return v

    @field_validator("artifact_type")
    @classmethod
    def valid_type(cls, v: str) -> str:
        if v not in ("agent", "skill", "mcp"):
            raise ValueError("artifact_type must be agent, skill, or mcp")
        return v

    @field_validator("files")
    @classmethod
    def check_total_size(cls, v: list) -> list:
        limit_mb = settings.ARTIFACT_MAX_FILES_MB
        max_bytes = limit_mb * 1024 * 1024
        total = sum(len(f.content.encode("utf-8")) for f in v)
        if total > max_bytes:
            raise ValueError(
                f"Total file content exceeds {limit_mb} MB ({total / 1024 / 1024:.1f} MB). "
                "Remove large files or split the submission."
            )
        return v


class ArtifactAnalyzeRequest(BaseModel):
    files: list[ArtifactFile]
    zip_name: str = ""


class ArtifactAnalyzeResponse(BaseModel):
    display_name: str
    description: str
    instructions: Optional[str] = None


class ArtifactSubmissionUpdate(BaseModel):
    display_name: Optional[str] = None
    description: Optional[str] = None
    instructions: Optional[str] = None
    files: Optional[list[ArtifactFile]] = None
    tags: Optional[list[str]] = None
    version_tag: Optional[str] = None

    @field_validator("files")
    @classmethod
    def check_total_size(cls, v: Optional[list]) -> Optional[list]:
        if not v:
            return v
        limit_mb = settings.ARTIFACT_MAX_FILES_MB
        total = sum(len(f.content.encode("utf-8")) for f in v)
        if total > limit_mb * 1024 * 1024:
            raise ValueError(
                f"Total file content exceeds {limit_mb} MB ({total / 1024 / 1024:.1f} MB). "
                "Remove large files or split the submission."
            )
        return v


class ArtifactVersionResponse(BaseModel):
    id: str
    name: str
    artifact_type: str
    version: str
    description: Optional[str]
    instructions: Optional[str]
    files: list[ArtifactFile]
    tags: list[str]
    github_url: Optional[str]
    published_by_name: Optional[str]
    published_at: datetime


class ArtifactVersionInfo(BaseModel):
    current: Optional[str] = None


class ValidationIssue(BaseModel):
    severity: str
    file: str
    line: Optional[int] = None
    message: str
    pattern: Optional[str] = None
    # SkillSpector enrichment (optional — absent on the legacy/scanner-unavailable paths)
    end_line: Optional[int] = None
    rule_id: Optional[str] = None
    category: Optional[str] = None
    risk_level: Optional[str] = None      # LOW | MEDIUM | HIGH | CRITICAL
    confidence: Optional[float] = None
    explanation: Optional[str] = None
    remediation: Optional[str] = None
    code_snippet: Optional[str] = None


class ValidationResult(BaseModel):
    passed: bool
    errors: list[ValidationIssue] = []
    warnings: list[ValidationIssue] = []
    # SkillSpector report summary
    scanner: str = "skillspector"
    score: Optional[int] = None           # 0-100 risk score
    risk_severity: Optional[str] = None   # LOW | MEDIUM | HIGH | CRITICAL
    recommendation: Optional[str] = None  # e.g. "SAFE", "DO NOT INSTALL"
    scanned: bool = True                  # false when type out of scope or scanner unavailable
    used_llm: Optional[bool] = None
    note: Optional[str] = None


class ArtifactSubmissionResponse(BaseModel):
    id: str
    name: str
    display_name: str
    artifact_type: str
    description: Optional[str]
    instructions: Optional[str]
    files: list[ArtifactFile]
    tags: list[str]
    status: str
    validation_results: Optional[ValidationResult]
    submitted_by_id: Optional[str]
    submitted_by_name: Optional[str]
    reviewed_by_id: Optional[str]
    github_url: Optional[str]
    reject_reason: Optional[str]
    parent_slug: Optional[str] = None
    version_tag: Optional[str] = None
    created_at: datetime
    updated_at: datetime
