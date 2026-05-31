import secrets
from functools import wraps
from flask import session, jsonify, redirect, request
from werkzeug.security import check_password_hash
from .db import db, one, ph


def current_user():
    uid = session.get("uid")
    if not uid:
        return None
    p = ph()
    with db() as conn:
        return one(conn, f"SELECT id, username, full_name, position, role, active, first_login FROM users WHERE id={p} AND active=1", (uid,))


def login_user(username, password):
    p = ph()
    with db() as conn:
        u = one(conn, f"SELECT * FROM users WHERE username={p} AND active=1", (username,))
        if not u or not check_password_hash(u["password_hash"], password):
            return None
        session.clear()
        session["uid"] = u["id"]
        session["csrf"] = secrets.token_urlsafe(24)
        return u


def require_login(fn):
    @wraps(fn)
    def wrap(*a, **kw):
        if not session.get("uid"):
            if request.path.startswith("/api/"):
                return jsonify(ok=False, error="Сесія завершена"), 401
            return redirect("/login")
        return fn(*a, **kw)
    return wrap


def require_role(*roles):
    def deco(fn):
        @wraps(fn)
        def wrap(*a, **kw):
            u = current_user()
            if not u:
                return jsonify(ok=False, error="Сесія завершена"), 401
            if u["role"] not in roles:
                return jsonify(ok=False, error="Недостатньо прав"), 403
            return fn(*a, **kw)
        return wrap
    return deco


def check_csrf():
    token = request.headers.get("X-CSRF-Token") or request.form.get("csrf")
    if not token and request.is_json:
        token = (request.get_json(silent=True) or {}).get("csrf")
    return bool(token and token == session.get("csrf"))


def require_csrf(fn):
    @wraps(fn)
    def wrap(*a, **kw):
        if request.method in ("POST", "PUT", "PATCH", "DELETE") and not check_csrf():
            return jsonify(ok=False, error="CSRF token invalid"), 400
        return fn(*a, **kw)
    return wrap
