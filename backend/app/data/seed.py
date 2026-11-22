"""Dados mínimos para o app funcionar."""

from __future__ import annotations

import uuid

from sqlmodel import Session, select

from app.data.db import get_engine
from app.data.models import User

LOCAL_USER_NAME = "Usuário local"


def ensure_local_user() -> uuid.UUID:
    """Garante que existe o usuário local (hoje o app tem um só). Retorna o id."""
    with Session(get_engine()) as session:
        user = session.exec(select(User).limit(1)).first()
        if user is None:
            user = User(name=LOCAL_USER_NAME)
            session.add(user)
            session.commit()
            session.refresh(user)
        return user.id
