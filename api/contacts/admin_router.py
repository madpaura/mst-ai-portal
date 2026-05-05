from fastapi import APIRouter, HTTPException, Depends
from auth.dependencies import require_admin
from database import get_db
from contacts.schemas import ContactEntryResponse, ContactEntryCreate, ContactEntryUpdate

router = APIRouter()


def _row_to_entry(r) -> ContactEntryResponse:
    return ContactEntryResponse(
        id=str(r["id"]),
        division=r["division"],
        name=r["name"],
        title=r.get("title") or "",
        email=r["email"],
        is_active=r["is_active"],
        sort_order=r["sort_order"],
        created_at=r["created_at"],
    )


@router.get("", response_model=list[ContactEntryResponse])
async def list_contacts(admin: dict = Depends(require_admin)):
    db = await get_db()
    rows = await db.fetch(
        "SELECT * FROM contact_entries ORDER BY sort_order, division, name"
    )
    return [_row_to_entry(r) for r in rows]


@router.post("", response_model=ContactEntryResponse)
async def create_contact(req: ContactEntryCreate, admin: dict = Depends(require_admin)):
    db = await get_db()
    row = await db.fetchrow(
        """
        INSERT INTO contact_entries (division, name, title, email, is_active, sort_order)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING *
        """,
        req.division.strip(), req.name.strip(), req.title.strip(),
        req.email.strip().lower(), req.is_active, req.sort_order,
    )
    return _row_to_entry(row)


@router.put("/{contact_id}", response_model=ContactEntryResponse)
async def update_contact(contact_id: str, req: ContactEntryUpdate, admin: dict = Depends(require_admin)):
    db = await get_db()
    row = await db.fetchrow("SELECT * FROM contact_entries WHERE id = $1", contact_id)
    if not row:
        raise HTTPException(status_code=404, detail="Contact not found")

    updates = {k: v for k, v in req.model_dump(exclude_none=True).items()}
    if not updates:
        return _row_to_entry(row)

    set_clauses = [f"{k} = ${i+1}" for i, k in enumerate(updates)]
    values = list(updates.values())
    values.append(contact_id)
    await db.execute(
        f"UPDATE contact_entries SET {', '.join(set_clauses)} WHERE id = ${len(values)}",
        *values,
    )
    row = await db.fetchrow("SELECT * FROM contact_entries WHERE id = $1", contact_id)
    return _row_to_entry(row)


@router.delete("/{contact_id}")
async def delete_contact(contact_id: str, admin: dict = Depends(require_admin)):
    db = await get_db()
    result = await db.execute("DELETE FROM contact_entries WHERE id = $1", contact_id)
    if result == "DELETE 0":
        raise HTTPException(status_code=404, detail="Contact not found")
    return {"ok": True}
