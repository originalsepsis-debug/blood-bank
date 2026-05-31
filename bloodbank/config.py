import os
import secrets


class Config:
    VERSION = "V7.4.2 RENDER_PYTHON_VERSION_FIX"
    DATABASE_URL = os.getenv("DATABASE_URL", "").strip()
    POSTGRES_ONLY = os.getenv("POSTGRES_ONLY", "0") == "1"
    SQLITE_PATH = os.getenv("SQLITE_PATH", "blood_bank_v7.sqlite3")
    SECRET_KEY_RANDOM = not bool(os.getenv("SECRET_KEY"))
    SECRET_KEY = os.getenv("SECRET_KEY") or secrets.token_hex(32)
    API_TOKEN = os.getenv("API_TOKEN", "")
    BACKUP_DIR = os.getenv("BACKUP_DIR", "backups")
    COOKIE_SECURE = os.getenv("COOKIE_SECURE", "0") == "1"
    REQUIRE_HTTPS = os.getenv("REQUIRE_HTTPS", "0") == "1"
    TELEGRAM_BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN", "").strip()

    SESSION_TIMEOUT_MINUTES = int(os.getenv("SESSION_TIMEOUT_MINUTES", "60"))
    SESSION_COOKIE_SAMESITE = os.getenv("SESSION_COOKIE_SAMESITE", "Lax")
    MAX_CONTENT_LENGTH = int(os.getenv("MAX_CONTENT_LENGTH", str(50 * 1024 * 1024)))
    # In production/Render mode readiness token must be configured.
    REQUIRE_API_TOKEN = os.getenv("REQUIRE_API_TOKEN", "").strip() == "1"
