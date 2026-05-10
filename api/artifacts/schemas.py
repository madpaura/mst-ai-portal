from pydantic import BaseModel, field_validator
from typing import Optional
from datetime import datetime
import re


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


class ArtifactSubmissionCreate(BaseModel):
    name: str
    display_name: str
    artifact_type: str
    description: Optional[str] = None
    instructions: Optional[str] = None
    files: list[ArtifactFile] = []
    tags: list[str] = []

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
        _MAX = 2 * 1024 * 1024  # 2 MB
        total = sum(len(f.content.encode("utf-8")) for f in v)
        if total > _MAX:
            raise ValueError(
                f"Total file content exceeds 2 MB ({total / 1024 / 1024:.1f} MB). "
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


class ValidationIssue(BaseModel):
    severity: str
    file: str
    line: Optional[int] = None
    message: str
    pattern: str


class ValidationResult(BaseModel):
    passed: bool
    errors: list[ValidationIssue] = []
    warnings: list[ValidationIssue] = []


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
    created_at: datetime
    updated_at: datetime
