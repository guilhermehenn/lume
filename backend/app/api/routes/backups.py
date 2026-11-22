"""Backups pela API: listar e criar."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException

from app.services import backup

router = APIRouter(prefix="/backups", tags=["backups"])


@router.get("")
def list_backups():
    return [b.as_dict() for b in backup.list_backups()]


@router.post("", status_code=201)
def create_backup():
    try:
        info = backup.create_backup("manual")
    except backup.BackupError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    if info is None:
        raise HTTPException(status_code=409, detail="Ainda não há banco de dados para copiar.")
    return info.as_dict()
