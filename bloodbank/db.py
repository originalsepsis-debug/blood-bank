import sqlite3
from contextlib import contextmanager
from flask import current_app
from werkzeug.security import generate_password_hash


def is_pg():
    return bool(current_app.config.get("DATABASE_URL"))


def _pg_url():
    url = current_app.config["DATABASE_URL"]
    if url.startswith("postgres://"):
        url = "postgresql://" + url[len("postgres://"):]
    return url


def connect():
    if is_pg():
        import psycopg2
        import psycopg2.extras
        conn = psycopg2.connect(_pg_url(), cursor_factory=psycopg2.extras.RealDictCursor)
        conn.autocommit = False
        return conn
    if current_app.config.get("POSTGRES_ONLY"):
        raise RuntimeError("POSTGRES_ONLY=1, але DATABASE_URL не заданий")
    conn = sqlite3.connect(current_app.config["SQLITE_PATH"])
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def ph():
    return "%s" if is_pg() else "?"


def row_to_dict(r):
    return dict(r) if r is not None else None


def rows_to_list(rows):
    return [dict(r) for r in rows]


@contextmanager
def db():
    conn = connect()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def q(conn, sql, params=()):
    cur = conn.cursor()
    cur.execute(sql, params)
    return cur


def one(conn, sql, params=()):
    return row_to_dict(q(conn, sql, params).fetchone())


def all_rows(conn, sql, params=()):
    return rows_to_list(q(conn, sql, params).fetchall())


def scalar(conn, sql, params=()):
    r = q(conn, sql, params).fetchone()
    if r is None:
        return None
    if isinstance(r, dict):
        return next(iter(r.values()))
    return r[0]


def exec_sql(conn, sql, params=()):
    return q(conn, sql, params)


def pk_type():
    return "SERIAL PRIMARY KEY" if is_pg() else "INTEGER PRIMARY KEY AUTOINCREMENT"


def ensure_column(conn, table, column, ddl):
    if is_pg():
        exec_sql(conn, f"ALTER TABLE {table} ADD COLUMN IF NOT EXISTS {column} {ddl}")
        return
    cols = [r["name"] for r in all_rows(conn, f"PRAGMA table_info({table})")]
    if column not in cols:
        exec_sql(conn, f"ALTER TABLE {table} ADD COLUMN {column} {ddl}")


def ensure_schema_extensions(conn):
    # Safe idempotent additions for existing V7.0.0/V7.0.1 databases.
    ensure_column(conn, "requests", "deleted_at", "TEXT")
    ensure_column(conn, "requests", "deleted_by", "INTEGER")
    ensure_column(conn, "requests", "delete_reason", "TEXT DEFAULT ''")
    ensure_column(conn, "requests", "restored_at", "TEXT")
    ensure_column(conn, "requests", "restored_by", "INTEGER")

    ensure_column(conn, "stock_units", "deleted_at", "TEXT")
    ensure_column(conn, "stock_units", "deleted_by", "INTEGER")
    ensure_column(conn, "stock_units", "delete_reason", "TEXT DEFAULT ''")
    ensure_column(conn, "stock_units", "restored_at", "TEXT")
    ensure_column(conn, "stock_units", "restored_by", "INTEGER")
    ensure_column(conn, "stock_units", "returned_at", "TEXT")
    ensure_column(conn, "stock_units", "reaction_type", "TEXT DEFAULT ''")
    ensure_column(conn, "stock_units", "reaction_severity", "TEXT DEFAULT ''")
    ensure_column(conn, "stock_units", "reaction_note", "TEXT DEFAULT ''")
    ensure_column(conn, "stock_units", "reaction_recorded_at", "TEXT")
    ensure_column(conn, "movements", "reaction_type", "TEXT DEFAULT ''")
    ensure_column(conn, "movements", "reaction_severity", "TEXT DEFAULT ''")

    ensure_column(conn, "movements", "deleted_at", "TEXT")
    ensure_column(conn, "movements", "deleted_by", "INTEGER")
    ensure_column(conn, "movements", "delete_reason", "TEXT DEFAULT ''")
    ensure_column(conn, "movements", "restored_at", "TEXT")
    ensure_column(conn, "movements", "restored_by", "INTEGER")

    # V7.0.4: full request + patients
    ensure_column(conn, "requests", "patient_id", "INTEGER")
    ensure_column(conn, "requests", "urgency", "TEXT DEFAULT 'routine'")
    ensure_column(conn, "requests", "indication", "TEXT DEFAULT ''")
    ensure_column(conn, "requests", "request_note", "TEXT DEFAULT ''")
    ensure_column(conn, "requests", "nurse_name", "TEXT DEFAULT ''")
    ensure_column(conn, "requests", "nurse_user_id", "INTEGER")
    ensure_column(conn, "requests", "nurse_position", "TEXT DEFAULT ''")
    ensure_column(conn, "requests", "reaction_note", "TEXT DEFAULT ''")
    ensure_column(conn, "requests", "transfusion_history", "TEXT DEFAULT ''")


    # V7.0.6: temperature journal
    ensure_column(conn, "temperature_devices", "deleted_at", "TEXT")
    ensure_column(conn, "temperature_devices", "deleted_by", "INTEGER")
    ensure_column(conn, "temperature_devices", "delete_reason", "TEXT DEFAULT ''")
    ensure_column(conn, "temperature_readings", "deleted_at", "TEXT")
    ensure_column(conn, "temperature_readings", "deleted_by", "INTEGER")
    ensure_column(conn, "temperature_readings", "delete_reason", "TEXT DEFAULT ''")

    # V7.1.4: ownership for patients created outside requests
    ensure_column(conn, "patients", "created_by", "INTEGER")


def init_db():
    with db() as conn:
        pk = pk_type()
        exec_sql(conn, f"""CREATE TABLE IF NOT EXISTS users (
            id {pk}, username TEXT UNIQUE NOT NULL, full_name TEXT NOT NULL, position TEXT DEFAULT '',
            role TEXT NOT NULL CHECK(role IN ('admin','transfusion','doctor','nurse')),
            password_hash TEXT NOT NULL, active INTEGER DEFAULT 1, first_login INTEGER DEFAULT 1,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )""")

        exec_sql(conn, f"""CREATE TABLE IF NOT EXISTS patients (
            id {pk}, full_name TEXT NOT NULL, birth_date TEXT DEFAULT '', address TEXT DEFAULT '', department TEXT DEFAULT '',
            diagnosis TEXT DEFAULT '', patient_status TEXT DEFAULT '', abo TEXT DEFAULT '', rh TEXT DEFAULT '',
            note TEXT DEFAULT '', created_by INTEGER, deleted_at TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        )""")
        exec_sql(conn, f"""CREATE TABLE IF NOT EXISTS requests (
            id {pk}, patient_id INTEGER, patient_name TEXT NOT NULL, birth_date TEXT, address TEXT, department TEXT, diagnosis TEXT,
            patient_status TEXT DEFAULT '', component_type TEXT NOT NULL, abo TEXT NOT NULL, rh TEXT NOT NULL, quantity INTEGER NOT NULL,
            needed_date TEXT, urgency TEXT DEFAULT 'routine', indication TEXT DEFAULT '', request_note TEXT DEFAULT '', transfusion_history TEXT DEFAULT '', reaction_note TEXT DEFAULT '', doctor_name TEXT, doctor_position TEXT, nurse_name TEXT DEFAULT '', nurse_user_id INTEGER, nurse_position TEXT DEFAULT '', requested_by INTEGER,
            status TEXT NOT NULL DEFAULT 'created', reject_reason TEXT DEFAULT '',
            deleted_at TEXT, deleted_by INTEGER, delete_reason TEXT DEFAULT '', restored_at TEXT, restored_by INTEGER,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        )""")
        exec_sql(conn, f"""CREATE TABLE IF NOT EXISTS stock_units (
            id {pk}, component_type TEXT NOT NULL, abo TEXT NOT NULL, rh TEXT NOT NULL, quantity INTEGER NOT NULL DEFAULT 1,
            unit_code TEXT UNIQUE, series TEXT, source TEXT, received_date TEXT, expiry_date TEXT,
            status TEXT NOT NULL DEFAULT 'in_stock', request_id INTEGER, reserved_at TEXT, issued_at TEXT, used_at TEXT, written_off_at TEXT, returned_at TEXT,
            deleted_at TEXT, deleted_by INTEGER, delete_reason TEXT DEFAULT '', restored_at TEXT, restored_by INTEGER,
            note TEXT DEFAULT '', created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        )""")
        exec_sql(conn, f"""CREATE TABLE IF NOT EXISTS movements (
            id {pk}, unit_id INTEGER, request_id INTEGER, action TEXT NOT NULL, quantity INTEGER NOT NULL DEFAULT 1,
            user_id INTEGER, reason TEXT DEFAULT '', details TEXT DEFAULT '',
            deleted_at TEXT, deleted_by INTEGER, delete_reason TEXT DEFAULT '', restored_at TEXT, restored_by INTEGER,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )""")
        exec_sql(conn, f"""CREATE TABLE IF NOT EXISTS report_adjustments (
            id {pk}, period_start TEXT, period_end TEXT, component_type TEXT DEFAULT '', abo TEXT DEFAULT '', rh TEXT DEFAULT '',
            action TEXT NOT NULL, quantity_delta INTEGER NOT NULL DEFAULT 0, reason TEXT DEFAULT '', user_id INTEGER,
            deleted_at TEXT, deleted_by INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )""")

        exec_sql(conn, f"""CREATE TABLE IF NOT EXISTS component_catalog (
            id {pk}, name TEXT UNIQUE NOT NULL, category TEXT DEFAULT '', active INTEGER DEFAULT 1, sort_order INTEGER DEFAULT 0,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )""")
        exec_sql(conn, f"""CREATE TABLE IF NOT EXISTS telegram_config (
            id INTEGER PRIMARY KEY, bot_token TEXT DEFAULT '', enabled INTEGER DEFAULT 0, critical_threshold INTEGER DEFAULT 2,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        )""")
        exec_sql(conn, "INSERT OR IGNORE INTO telegram_config(id, bot_token, enabled, critical_threshold) VALUES (1, '', 0, 2)" if not is_pg() else "INSERT INTO telegram_config(id, bot_token, enabled, critical_threshold) VALUES (1, '', 0, 2) ON CONFLICT (id) DO NOTHING")
        exec_sql(conn, f"""CREATE TABLE IF NOT EXISTS telegram_subscribers (
            id {pk}, user_id INTEGER, chat_id TEXT DEFAULT '', enabled INTEGER DEFAULT 0,
            notify_new_request INTEGER DEFAULT 1, notify_approve INTEGER DEFAULT 1, notify_reject INTEGER DEFAULT 1,
            notify_issue INTEGER DEFAULT 1, notify_used INTEGER DEFAULT 1, notify_critical INTEGER DEFAULT 1,
            notify_expired INTEGER DEFAULT 1, notify_system INTEGER DEFAULT 1, updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        )""")
        exec_sql(conn, f"""CREATE TABLE IF NOT EXISTS telegram_log (
            id {pk}, event TEXT DEFAULT '', chat_id TEXT DEFAULT '', ok INTEGER DEFAULT 0, error TEXT DEFAULT '',
            text TEXT DEFAULT '', created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )""")
        exec_sql(conn, f"""CREATE TABLE IF NOT EXISTS temperature_devices (
            id {pk}, name TEXT NOT NULL, device_type TEXT DEFAULT 'fridge', location TEXT DEFAULT '',
            min_temp REAL NOT NULL DEFAULT 2, max_temp REAL NOT NULL DEFAULT 6, active INTEGER DEFAULT 1,
            deleted_at TEXT, deleted_by INTEGER, delete_reason TEXT DEFAULT '',
            created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        )""")
        exec_sql(conn, f"""CREATE TABLE IF NOT EXISTS temperature_readings (
            id {pk}, device_id INTEGER NOT NULL, measured_at TEXT DEFAULT CURRENT_TIMESTAMP, temperature REAL NOT NULL,
            humidity REAL, status TEXT DEFAULT 'ok', note TEXT DEFAULT '', user_id INTEGER,
            deleted_at TEXT, deleted_by INTEGER, delete_reason TEXT DEFAULT '', created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )""")
        exec_sql(conn, f"""CREATE TABLE IF NOT EXISTS backup_log (
            id {pk}, action TEXT NOT NULL, file_name TEXT DEFAULT '', ok INTEGER DEFAULT 0,
            error TEXT DEFAULT '', details TEXT DEFAULT '', user_id INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )""")
        exec_sql(conn, f"""CREATE TABLE IF NOT EXISTS migration_log (
            id {pk}, action TEXT NOT NULL, source_kind TEXT DEFAULT '', file_name TEXT DEFAULT '', ok INTEGER DEFAULT 0,
            imported_users INTEGER DEFAULT 0, imported_patients INTEGER DEFAULT 0, imported_requests INTEGER DEFAULT 0,
            imported_units INTEGER DEFAULT 0, imported_movements INTEGER DEFAULT 0, skipped INTEGER DEFAULT 0,
            error TEXT DEFAULT '', details TEXT DEFAULT '', user_id INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )""")
        exec_sql(conn, f"""CREATE TABLE IF NOT EXISTS audit_log (
            id {pk}, user_id INTEGER, action TEXT NOT NULL, entity TEXT, entity_id INTEGER, details TEXT DEFAULT '', created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )""")
        exec_sql(conn, f"""CREATE TABLE IF NOT EXISTS login_attempts (
            id {pk}, client_key TEXT UNIQUE NOT NULL, fail_count INTEGER DEFAULT 0, blocked_until REAL DEFAULT 0,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        )""")
        exec_sql(conn, f"""CREATE TABLE IF NOT EXISTS login_events (
            id {pk}, username TEXT DEFAULT '', user_id INTEGER, role TEXT DEFAULT '', full_name TEXT DEFAULT '',
            ip TEXT DEFAULT '', user_agent TEXT DEFAULT '', success INTEGER DEFAULT 0, reason TEXT DEFAULT '',
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )""")
        exec_sql(conn, f"""CREATE TABLE IF NOT EXISTS backup_policy (
            id INTEGER PRIMARY KEY, enabled INTEGER DEFAULT 0, keep_last INTEGER DEFAULT 14,
            last_run_at TEXT, last_file TEXT DEFAULT '', last_ok INTEGER DEFAULT 0, last_error TEXT DEFAULT '',
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        )""")
        ensure_schema_extensions(conn)
        p = ph()

        default_components = [
            ("Цільна кров", "rbc"),
            ("Еритроцити", "rbc"),
            ("Еритроцити в додатковому розчині", "rbc"),
            ("Еритроцити з видаленим лейкоцитарно-тромбоцитарним шаром", "rbc"),
            ("Еритроцити з видаленим лейкоцитарно-тромбоцитарним шаром у додатковому розчині", "rbc"),
            ("Еритроцити збіднені на лейкоцити", "rbc"),
            ("Еритроцити збіднені на лейкоцити у додатковому розчині", "rbc"),
            ("Еритроцити відмиті", "rbc"),
            ("Плазма свіжозаморожена", "plasma"),
            ("Плазма свіжозаморожена збіднена на кріопреципітат", "plasma"),
            ("Плазма свіжозаморожена оброблена методом патогенредукції", "plasma"),
            ("Тромбоцити аферез", "platelets"),
            ("Тромбоцити аферез оброблені методом патогенредукції", "platelets"),
            ("Тромбоцити відновлені", "platelets"),
            ("Кріопреципітат", "cryo"),
        ]
        for idx, (name, category) in enumerate(default_components, start=1):
            if is_pg():
                exec_sql(conn, "INSERT INTO component_catalog(name,category,active,sort_order) VALUES (%s,%s,1,%s) ON CONFLICT (name) DO NOTHING", (name, category, idx))
            else:
                exec_sql(conn, "INSERT OR IGNORE INTO component_catalog(name,category,active,sort_order) VALUES (?,?,1,?)", (name, category, idx))

        exists = one(conn, f"SELECT id FROM users WHERE username={p}", ("Sepsis",))
        if not exists:
            sql = "INSERT INTO users(username,full_name,position,role,password_hash,first_login) VALUES (?,?,?,?,?,1)"
            if is_pg():
                sql = "INSERT INTO users(username,full_name,position,role,password_hash,first_login) VALUES (%s,%s,%s,%s,%s,1)"
            exec_sql(conn, sql, ("Sepsis", "Адміністратор", "Завідувач", "admin", generate_password_hash("1986")))

        if not scalar(conn, "SELECT COUNT(*) FROM backup_policy"):
            exec_sql(conn, "INSERT INTO backup_policy(id, enabled, keep_last) VALUES (1,0,14)")



def insert_and_get_id(conn, table, columns, values):
    """Insert a row and return its own id safely for SQLite/PostgreSQL."""
    marks = ",".join([ph()] * len(columns))
    cols = ",".join(columns)
    if is_pg():
        cur = exec_sql(conn, f"INSERT INTO {table} ({cols}) VALUES ({marks}) RETURNING id", tuple(values))
        row = cur.fetchone()
        return row["id"] if isinstance(row, dict) else row[0]
    cur = exec_sql(conn, f"INSERT INTO {table} ({cols}) VALUES ({marks})", tuple(values))
    return cur.lastrowid


def reset_postgres_sequences(conn, tables=None):
    """After restore/import with explicit ids, make PostgreSQL serial sequences continue after MAX(id)."""
    if not is_pg():
        return []
    tables = tables or [
        "users", "patients", "requests", "stock_units", "movements", "report_adjustments", "component_catalog",
        "telegram_subscribers", "telegram_log", "temperature_devices", "temperature_readings",
        "backup_log", "migration_log", "audit_log", "login_attempts"
    ]
    changed = []
    for table in tables:
        try:
            exec_sql(conn, "SELECT setval(pg_get_serial_sequence(%s,'id'), COALESCE((SELECT MAX(id) FROM " + table + "), 1), true)", (table,))
            changed.append(table)
        except Exception:
            # Some tables may not have a PostgreSQL sequence; ignore safely.
            pass
    return changed
