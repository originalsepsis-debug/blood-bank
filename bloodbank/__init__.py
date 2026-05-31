from flask import Flask, request, redirect, session, jsonify
from .config import Config
from .db import init_db, db, one, ph
from .routes import bp


def create_app():
    app = Flask(__name__, template_folder="../templates", static_folder="../static")
    app.config.from_object(Config)
    app.secret_key = app.config["SECRET_KEY"]

    app.config["SESSION_COOKIE_SECURE"] = bool(app.config.get("COOKIE_SECURE"))
    app.config["SESSION_COOKIE_HTTPONLY"] = True
    app.config["SESSION_COOKIE_SAMESITE"] = app.config.get("SESSION_COOKIE_SAMESITE", "Lax")
    app.config["PERMANENT_SESSION_LIFETIME"] = int(app.config.get("SESSION_TIMEOUT_MINUTES", 60)) * 60
    app.config["MAX_CONTENT_LENGTH"] = int(app.config.get("MAX_CONTENT_LENGTH", 50 * 1024 * 1024))

    @app.before_request
    def _security_before_request():
        if app.config.get("REQUIRE_HTTPS"):
            proto = request.headers.get("X-Forwarded-Proto", request.scheme)
            if proto != "https" and not request.host.startswith(("localhost", "127.0.0.1")):
                return redirect(request.url.replace("http://", "https://", 1), code=301)
        if session.get("uid"):
            session.permanent = True
            # Force first-login password change. The browser redirect alone is not enough,
            # because API calls could otherwise be made with the initial temporary password.
            allowed = (
                request.path.startswith('/static/') or
                request.path in ('/change-password', '/logout', '/api/me', '/api/public-health', '/api/render-readiness', '/api/emergency/reset-admin', '/manifest.json', '/offline')
            )
            if not allowed:
                try:
                    with db() as conn:
                        mark = ph()
                        u = one(conn, f"SELECT first_login FROM users WHERE id={mark} AND active=1", (session.get('uid'),))
                    if u and int(u.get('first_login') or 0):
                        if request.path.startswith('/api/'):
                            return jsonify(ok=False, error='Потрібно змінити початковий пароль', require_password_change=True), 428
                        return redirect('/change-password')
                except Exception:
                    session.clear()
                    if request.path.startswith('/api/'):
                        return jsonify(ok=False, error='Сесія завершена'), 401
                    return redirect('/login')


    @app.errorhandler(413)
    def _too_large(_error):
        return {"ok": False, "error": "Файл занадто великий. Зменшіть файл або збільште MAX_CONTENT_LENGTH."}, 413

    app.register_blueprint(bp)
    with app.app_context():
        init_db()
    return app
