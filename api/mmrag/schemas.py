from typing import Optional

from pydantic import BaseModel, Field, field_validator

from mmrag.remote import SLUG_RE


def _strip(value):
    return value.strip() if isinstance(value, str) else value


class SpaceFields(BaseModel):
    name: str = Field(min_length=3, max_length=80)
    plm_project: str = Field(min_length=1, max_length=120)
    reason: str = Field(min_length=10, max_length=2000)
    slug: Optional[str] = None

    _strip_text = field_validator("name", "plm_project", "reason", mode="before")(_strip)

    @field_validator("slug", mode="before")
    @classmethod
    def _check_slug(cls, value):
        value = _strip(value)
        if not value:
            return None
        if not SLUG_RE.match(value):
            raise ValueError(
                "Use 1-31 lowercase letters, digits or hyphens, starting with a letter or digit"
            )
        return value


class NoteRequired(BaseModel):
    note: str = Field(min_length=3, max_length=2000)

    _strip_note = field_validator("note", mode="before")(_strip)


class OptionalNote(BaseModel):
    note: Optional[str] = Field(default=None, max_length=2000)

    _strip_note = field_validator("note", mode="before")(_strip)


class DeleteRequest(BaseModel):
    reason: str = Field(min_length=3, max_length=2000)

    _strip_reason = field_validator("reason", mode="before")(_strip)
