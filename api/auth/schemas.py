from pydantic import BaseModel
from typing import Optional
from datetime import datetime


class LoginRequest(BaseModel):
    username: str
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class UserResponse(BaseModel):
    id: str
    username: str
    email: Optional[str] = None
    display_name: str
    initials: Optional[str] = None
    role: str
    created_at: datetime


class UserUpdateRequest(BaseModel):
    display_name: Optional[str] = None
    initials: Optional[str] = None
