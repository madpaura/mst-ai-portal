from pydantic import BaseModel
from typing import Optional
from datetime import datetime


class ForgeSettingResponse(BaseModel):
    id: str
    git_url: str
    git_token: Optional[str] = None
    git_branch: str = "main"
    scan_paths: list[str] = ["."]
    update_frequency: str = "nightly"
    llm_provider: str = "openai"
    llm_model: str = "gpt-4o-mini"
    llm_api_key: Optional[str] = None
    auto_update_release_tag: bool = True
    # Transcript service
    transcript_service_url: Optional[str] = None
    transcript_service_api_key: Optional[str] = None
    transcript_model: str = "large-v3"
    is_active: bool = True
    created_at: datetime
    updated_at: datetime


class ForgeSettingCreate(BaseModel):
    git_url: str
    git_token: Optional[str] = None
    git_branch: str = "main"
    scan_paths: list[str] = ["."]
    update_frequency: str = "nightly"
    llm_provider: str = "openai"
    llm_model: str = "gpt-4o-mini"
    llm_api_key: Optional[str] = None
    auto_update_release_tag: bool = True
    transcript_service_url: Optional[str] = None
    transcript_service_api_key: Optional[str] = None
    transcript_model: str = "large-v3"


class ForgeSettingUpdate(BaseModel):
    git_url: Optional[str] = None
    git_token: Optional[str] = None
    git_branch: Optional[str] = None
    scan_paths: Optional[list[str]] = None
    update_frequency: Optional[str] = None
    llm_provider: Optional[str] = None
    llm_model: Optional[str] = None
    llm_api_key: Optional[str] = None
    auto_update_release_tag: Optional[bool] = None
    transcript_service_url: Optional[str] = None
    transcript_service_api_key: Optional[str] = None
    transcript_model: Optional[str] = None
    is_active: Optional[bool] = None


class ForgeSyncJobResponse(BaseModel):
    id: int
    settings_id: str
    trigger_type: str
    status: str
    components_found: int = 0
    components_updated: int = 0
    components_created: int = 0
    error: Optional[str] = None
    log: Optional[str] = None
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    created_at: datetime
