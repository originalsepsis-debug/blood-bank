
import os, sqlite3, hashlib, secrets, json, time, shutil, zipfile
from datetime import datetime, timedelta
from datetime import datetime
from functools import wraps
from flask import Flask, request, session, redirect, url_for, render_template, jsonify, send_file, g
from werkzeug.middleware.proxy_fix import ProxyFix
from openpyxl import Workbook
from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import A4
from io import BytesIO
try:
    import psycopg2
    import psycopg2.extras
except Exception:
    psycopg2 = None

APP_TITLE = "Банк крові V5.9.6"
DATABASE_URL = os.environ.get("DATABASE_URL", "").strip()
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)
IS_POSTGRES = DATABASE_URL.startswith("postgres")
DB_PATH = os.environ.get("DB_PATH", "blood_bank_v4.db")
BACKUP_DIR = os.environ.get("BACKUP_DIR", "backups")
SESSION_TIMEOUT_MINUTES = int(os.environ.get("SESSION_TIMEOUT_MINUTES","30"))
TELEGRAM_BOT_TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN","")
TELEGRAM_CHAT_ID = os.environ.get("TELEGRAM_CHAT_ID","")
TELEGRAM_BOT_USERNAME = os.environ.get("TELEGRAM_BOT_USERNAME","")
TELEGRAM_ENABLED = os.environ.get("TELEGRAM_ENABLED","1") == "1"
TELEGRAM_SILENT_START = int(os.environ.get("TELEGRAM_SILENT_START","22"))
TELEGRAM_SILENT_END = int(os.environ.get("TELEGRAM_SILENT_END","7"))
TELEGRAM_ANTI_SPAM_MINUTES = int(os.environ.get("TELEGRAM_ANTI_SPAM_MINUTES","10"))
API_TOKEN = os.environ.get("API_TOKEN","")
BACKUP_ENCRYPTION_KEY = os.environ.get("BACKUP_ENCRYPTION_KEY","")
AUTO_BACKUP_HOURS = int(os.environ.get("AUTO_BACKUP_HOURS","24"))
AUTO_BACKUP_ENABLED = os.environ.get("AUTO_BACKUP_ENABLED","1") == "1"
AUTO_BACKUP_HOUR = int(os.environ.get("AUTO_BACKUP_HOUR","3"))
BACKUP_KEEP_DAYS = int(os.environ.get("BACKUP_KEEP_DAYS","14"))
POSTGRES_ONLY = os.environ.get("POSTGRES_ONLY","0") == "1"
SECRET_KEY = os.environ.get("SECRET_KEY") or secrets.token_hex(32)
DEBUG = os.environ.get("DEBUG","0") == "1"
COOKIE_SECURE = os.environ.get("COOKIE_SECURE","0") == "1"
REQUIRE_HTTPS = os.environ.get("REQUIRE_HTTPS","0") == "1"

app = Flask(__name__)
app.secret_key = SECRET_KEY
app.wsgi_app = ProxyFix(app.wsgi_app, x_proto=1, x_host=1)
app.config.update(SESSION_COOKIE_HTTPONLY=True, SESSION_COOKIE_SAMESITE="Lax", SESSION_COOKIE_SECURE=COOKIE_SECURE)

RATE = {}
BANS = {}

def now():
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")

def ensure_dirs():
    if os.path.dirname(DB_PATH):
        os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    os.makedirs(BACKUP_DIR, exist_ok=True)


def db():
    if "db" not in g:
        ensure_dirs()
        if IS_POSTGRES:
            if psycopg2 is None:
                raise RuntimeError("psycopg2-binary is required for PostgreSQL")
            g.db = psycopg2.connect(DATABASE_URL, cursor_factory=psycopg2.extras.RealDictCursor)
            g.db.autocommit = True  # V5.9.5: prevent InFailedSqlTransaction after migration errors
        else:
            g.db = sqlite3.connect(DB_PATH)
            g.db.row_factory = sqlite3.Row
    return g.db

@app.teardown_appcontext
def close_db(e=None):
    conn = g.pop("db", None)
    if conn:
        conn.close()

def sql_convert(sql):
    if IS_POSTGRES:
        return sql.replace("?", "%s")
    return sql


# ================= V5.9.5 REAL POSTGRES TRANSACTION RECOVERY =================
def db_rollback_safe():
    try:
        db().rollback()
    except Exception:
        pass

def db_commit_safe():
    try:
        if not IS_POSTGRES:
            db().commit()
    except Exception:
        pass
# ================= END V5.9.5 REAL POSTGRES TRANSACTION RECOVERY =================

def execute(sql, params=()):
    conn = db()
    try:
        cur = conn.cursor()
        cur.execute(sql_convert(sql), params)
        if not IS_POSTGRES:
            conn.commit()
        return cur
    except Exception:
        try:
            conn.rollback()
        except Exception:
            pass
        raise

def rows(sql, params=()):
    conn = db()
    try:
        cur = conn.cursor()
        cur.execute(sql_convert(sql), params)
        return [dict(x) for x in cur.fetchall()]
    except Exception:
        try:
            conn.rollback()
        except Exception:
            pass
        raise

def row(sql, params=()):
    conn = db()
    try:
        cur = conn.cursor()
        cur.execute(sql_convert(sql), params)
        r = cur.fetchone()
        return dict(r) if r else None
    except Exception:
        try:
            conn.rollback()
        except Exception:
            pass
        raise

def hash_password(password, salt=None):
    salt = salt or secrets.token_hex(16)
    ph = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 200000).hex()
    return salt, ph

def password_ok(password, salt, ph):
    return hash_password(password, salt)[1] == ph

def password_policy_ok(p):
    if not p or len(p) < 6:
        return False, "Пароль мінімум 6 символів"
    return True, ""

def current_user():
    uid = session.get("user_id")
    if not uid: return None
    return row("SELECT id,username,role,full_name,position,active,first_login,spellcheck_enabled FROM users WHERE id=?", (uid,))

def audit(action, details=""):
    u = current_user()
    try:
        execute("INSERT INTO audit(created_at,user_id,username,role,action,details,ip,user_agent) VALUES(?,?,?,?,?,?,?,?)",
                (now(), u.get("id") if u else None, u.get("username") if u else "", u.get("role") if u else "", action, details,
                 request.headers.get("X-Forwarded-For", request.remote_addr or ""), request.headers.get("User-Agent","")))
    except Exception:
        execute("INSERT INTO audit(created_at,user_id,username,role,action,details) VALUES(?,?,?,?,?,?)",
                (now(), u.get("id") if u else None, u.get("username") if u else "", u.get("role") if u else "", action, details))

def notify(user_id, title, body):
    execute("INSERT INTO notifications(created_at,user_id,title,body,read_at) VALUES(?,?,?,?,NULL)", (now(), user_id, title, body))

def create_user(username, password, role, full_name="", position="", active=1, first_login=1):
    salt, ph = hash_password(password)
    if row("SELECT id FROM users WHERE username=?", (username,)):
        return
    execute("""INSERT INTO users(username,password_hash,salt,role,full_name,position,active,created_at,first_login,spellcheck_enabled,failed_logins,locked_until)
               VALUES(?,?,?,?,?,?,?,?,?,1,0,NULL)""", (username, ph, salt, role, full_name, position, active, now(), first_login))

def init_db():
    ensure_dirs()
    if IS_POSTGRES:
        ddl = [
            """CREATE TABLE IF NOT EXISTS users(
                id SERIAL PRIMARY KEY,
                username TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                salt TEXT NOT NULL,
                role TEXT NOT NULL,
                full_name TEXT,
                position TEXT,
                active INTEGER DEFAULT 1,
                created_at TEXT,
                first_login INTEGER DEFAULT 1,
                spellcheck_enabled INTEGER DEFAULT 1,
                failed_logins INTEGER DEFAULT 0,
                locked_until TEXT
            )""",
            """CREATE TABLE IF NOT EXISTS requests(
                id SERIAL PRIMARY KEY,
                created_at TEXT,
                created_by INTEGER,
                doctor_name TEXT,
                doctor_position TEXT,
                patient_name TEXT,
                birth_date TEXT,
                address TEXT,
                patient_status TEXT,
                department TEXT,
                component TEXT,
                patient_group TEXT,
                patient_rh TEXT,
                amount REAL,
                urgency TEXT,
                diagnosis TEXT,
                note TEXT,
                status TEXT DEFAULT 'Нова',
                compatibility_ok INTEGER DEFAULT 1,
                compatibility_warning TEXT,
                approved_by TEXT,
                issued_by TEXT,
                issued_at TEXT,
                pack_no TEXT,
                series TEXT,
                expiry TEXT,
                donor_group TEXT,
                donor_rh TEXT,
                used_at TEXT,
                used_by TEXT,
                use_confirm TEXT,
                writeoff_at TEXT,
                written_by TEXT,
                writeoff_reason TEXT,
                reaction_present TEXT DEFAULT 'Ні',
                reaction_type TEXT,
                reaction_severity TEXT,
                reaction_description TEXT,
                reaction_result TEXT
            )""",
            """CREATE TABLE IF NOT EXISTS stock_entries(
                id SERIAL PRIMARY KEY,
                created_at TEXT,
                user_id INTEGER,
                type TEXT,
                component TEXT,
                donor_group TEXT,
                donor_rh TEXT,
                amount REAL,
                pack_no TEXT,
                series TEXT,
                expiry TEXT,
                patient_name TEXT,
                note TEXT
            )""",
            """CREATE TABLE IF NOT EXISTS audit(
                id SERIAL PRIMARY KEY,
                created_at TEXT,
                user_id INTEGER,
                username TEXT,
                role TEXT,
                action TEXT,
                details TEXT,
                ip TEXT,
                user_agent TEXT
            )""",
            """CREATE TABLE IF NOT EXISTS notifications(
                id SERIAL PRIMARY KEY,
                created_at TEXT,
                user_id INTEGER,
                title TEXT,
                body TEXT,
                read_at TEXT
            )""",
            """CREATE TABLE IF NOT EXISTS trash(
                id SERIAL PRIMARY KEY,
                created_at TEXT,
                source_table TEXT,
                source_id INTEGER,
                data TEXT,
                deleted_by TEXT,
                reason TEXT
            )""",
            """CREATE TABLE IF NOT EXISTS login_attempts(
                id SERIAL PRIMARY KEY,
                created_at TEXT,
                username TEXT,
                ip TEXT,
                user_agent TEXT,
                ok INTEGER
            )""",
            """CREATE TABLE IF NOT EXISTS backups(
                id SERIAL PRIMARY KEY,
                created_at TEXT,
                filename TEXT,
                size_bytes INTEGER,
                created_by TEXT
            )"""
        ]
        for q in ddl:
            execute(q)
    else:
        execute("""CREATE TABLE IF NOT EXISTS users(
            id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, salt TEXT NOT NULL,
            role TEXT NOT NULL, full_name TEXT, position TEXT, active INTEGER DEFAULT 1, created_at TEXT, first_login INTEGER DEFAULT 1,
            spellcheck_enabled INTEGER DEFAULT 1, failed_logins INTEGER DEFAULT 0, locked_until TEXT
        )""")
        execute("""CREATE TABLE IF NOT EXISTS requests(
            id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT, created_by INTEGER, doctor_name TEXT, doctor_position TEXT,
            patient_name TEXT, birth_date TEXT, address TEXT, patient_status TEXT, department TEXT, component TEXT,
            patient_group TEXT, patient_rh TEXT, amount REAL, urgency TEXT, diagnosis TEXT, note TEXT, status TEXT DEFAULT 'Нова',
            compatibility_ok INTEGER DEFAULT 1, compatibility_warning TEXT,
            approved_by TEXT, issued_by TEXT, issued_at TEXT, pack_no TEXT, series TEXT, expiry TEXT, donor_group TEXT, donor_rh TEXT,
            used_at TEXT, used_by TEXT, use_confirm TEXT, writeoff_at TEXT, written_by TEXT, writeoff_reason TEXT,
            reaction_present TEXT DEFAULT 'Ні', reaction_type TEXT, reaction_severity TEXT, reaction_description TEXT, reaction_result TEXT
        )""")
        execute("""CREATE TABLE IF NOT EXISTS stock_entries(
            id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT, user_id INTEGER, type TEXT, component TEXT, donor_group TEXT, donor_rh TEXT,
            amount REAL, pack_no TEXT, series TEXT, expiry TEXT, patient_name TEXT, note TEXT
        )""")
        execute("""CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT,user_id INTEGER,username TEXT,role TEXT,action TEXT,details TEXT,ip TEXT,user_agent TEXT)""")
        execute("""CREATE TABLE IF NOT EXISTS notifications(id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT,user_id INTEGER,title TEXT,body TEXT,read_at TEXT)""")
        execute("""CREATE TABLE IF NOT EXISTS trash(id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT,source_table TEXT,source_id INTEGER,data TEXT,deleted_by TEXT,reason TEXT)""")
        execute("""CREATE TABLE IF NOT EXISTS login_attempts(id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT,username TEXT,ip TEXT,user_agent TEXT,ok INTEGER)""")
        execute("""CREATE TABLE IF NOT EXISTS backups(id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT,filename TEXT,size_bytes INTEGER,created_by TEXT)""")
    
    for sql in [
        "CREATE TABLE IF NOT EXISTS transfusion_events(id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT, request_id INTEGER, patient_name TEXT, component TEXT, pack_no TEXT, nurse_name TEXT, doctor_name TEXT, started_at TEXT, finished_at TEXT, result TEXT, signature TEXT)",
        "CREATE TABLE IF NOT EXISTS reaction_registry(id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT, request_id INTEGER, patient_name TEXT, reaction_type TEXT, severity TEXT, description TEXT, action_taken TEXT, result TEXT, reported_by TEXT)",
        "CREATE TABLE IF NOT EXISTS api_events(id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT, source TEXT, event_type TEXT, payload TEXT)"
    ]:
        try: execute(sql)
        except Exception: pass

    if IS_POSTGRES:
        for sql in [
            "CREATE TABLE IF NOT EXISTS transfusion_events_pg(id SERIAL PRIMARY KEY, created_at TEXT, request_id INTEGER, patient_name TEXT, component TEXT, pack_no TEXT, nurse_name TEXT, doctor_name TEXT, started_at TEXT, finished_at TEXT, result TEXT, signature TEXT)",
            "CREATE TABLE IF NOT EXISTS reaction_registry_pg(id SERIAL PRIMARY KEY, created_at TEXT, request_id INTEGER, patient_name TEXT, reaction_type TEXT, severity TEXT, description TEXT, action_taken TEXT, result TEXT, reported_by TEXT)",
            "CREATE TABLE IF NOT EXISTS api_events_pg(id SERIAL PRIMARY KEY, created_at TEXT, source TEXT, event_type TEXT, payload TEXT)"
        ]:
            try: execute(sql)
            except Exception: pass

    
    # V5_4_1_QR_SCHEMA_FIX: ensure qr_code exists after upgrades
    try:
        execute("ALTER TABLE stock_entries ADD COLUMN qr_code TEXT")
    except Exception:
        pass

    
    # V5.5 Telegram Edition tables
    for sql in [
        "CREATE TABLE IF NOT EXISTS telegram_logs(id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT, event_type TEXT, chat_id TEXT, message TEXT, ok INTEGER, response TEXT)",
        "CREATE TABLE IF NOT EXISTS telegram_queue(id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT, event_type TEXT, chat_id TEXT, message TEXT, attempts INTEGER DEFAULT 0, last_error TEXT, sent INTEGER DEFAULT 0)"
    ]:
        try: execute(sql)
        except Exception: pass
    if IS_POSTGRES:
        for sql in [
            "CREATE TABLE IF NOT EXISTS telegram_logs_pg(id SERIAL PRIMARY KEY, created_at TEXT, event_type TEXT, chat_id TEXT, message TEXT, ok INTEGER, response TEXT)",
            "CREATE TABLE IF NOT EXISTS telegram_queue_pg(id SERIAL PRIMARY KEY, created_at TEXT, event_type TEXT, chat_id TEXT, message TEXT, attempts INTEGER DEFAULT 0, last_error TEXT, sent INTEGER DEFAULT 0)"
        ]:
            try: execute(sql)
            except Exception: pass

        # V5_5_1_STOCK_SCHEMA_FIX
    try:
        execute("ALTER TABLE stock_entries ADD COLUMN qr_code TEXT")
    except Exception:
        pass

    
    # V5.7 Telegram PRO user columns
    for col_sql in [
        "ALTER TABLE users ADD COLUMN telegram_chat_id TEXT",
        "ALTER TABLE users ADD COLUMN telegram_username TEXT",
        "ALTER TABLE users ADD COLUMN telegram_enabled INTEGER DEFAULT 0",
        "ALTER TABLE users ADD COLUMN telegram_notify_new_requests INTEGER DEFAULT 1",
        "ALTER TABLE users ADD COLUMN telegram_notify_critical INTEGER DEFAULT 1",
        "ALTER TABLE users ADD COLUMN telegram_notify_expiring INTEGER DEFAULT 1",
        "ALTER TABLE users ADD COLUMN telegram_notify_reactions INTEGER DEFAULT 1",
        "ALTER TABLE users ADD COLUMN telegram_notify_backups INTEGER DEFAULT 0"
    ]:
        try:
            execute(col_sql)
        except Exception:
            db_rollback_safe()
            pass

    ensure_default_admin()

def make_backup(created_by="system"):
    ensure_dirs()
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    if IS_POSTGRES:
        name = f"blood_bank_pg_backup_{ts}.json.zip"
        path = os.path.join(BACKUP_DIR, name)
        tables=["users","requests","stock_entries","audit","notifications","trash","login_attempts","backups"]
        data={}
        for t in tables:
            try: data[t]=rows(f"SELECT * FROM {t}")
            except Exception: data[t]=[]
        with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
            z.writestr("blood_bank_v4_backup.json", json.dumps(data, ensure_ascii=False))
    else:
        if not os.path.exists(DB_PATH):
            with app.app_context():
                init_db()
        name = f"blood_bank_backup_{ts}.db.zip"
        path = os.path.join(BACKUP_DIR, name)
        with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
            z.write(DB_PATH, "blood_bank_v4.db")
    size = os.path.getsize(path)
    try:
        execute("INSERT INTO backups(created_at,filename,size_bytes,created_by) VALUES(?,?,?,?)", (now(), name, size, created_by))
    except Exception:
        pass
    return path

def abo_compatible(patient, donor, component):
    patient=normalize_group(patient); donor=normalize_group(donor); component=(component or "").lower()
    if not patient or not donor: return True, ""
    if "плаз" in component:
        allowed={"0":["0","A","B","AB"],"A":["A","AB"],"B":["B","AB"],"AB":["AB"]}
    else:
        allowed={"0":["0"],"A":["0","A"],"B":["0","B"],"AB":["0","A","B","AB"]}
    ok = donor in allowed.get(patient, [])
    return ok, "" if ok else f"ABO несумісність: пацієнт {patient}, донор {donor}"

def rh_compatible(patient_rh, donor_rh):
    patient_rh=normalize_rh(patient_rh); donor_rh=normalize_rh(donor_rh)
    if not patient_rh or not donor_rh: return True, ""
    ok = not (patient_rh == "-" and donor_rh == "+")
    return ok, "" if ok else "Rh несумісність"


def normalize_group(x):
    x=(x or "").upper().strip()
    if x in ["O(I)","0(I)","O","0","I"]: return "0"
    if x in ["A(II)","A","II"]: return "A"
    if x in ["B(III)","B","III"]: return "B"
    if x in ["AB(IV)","AB","IV"]: return "AB"
    return x

def normalize_rh(x):
    x=(x or "").upper().strip()
    if x in ["RH+","PLUS","+","POSITIVE"]: return "+"
    if x in ["RH-","MINUS","-","NEGATIVE"]: return "-"
    return x


def maybe_auto_backup():
    try:
        last = row("SELECT created_at FROM backups ORDER BY id DESC LIMIT 1")
        if not last:
            make_backup("auto")
            return True
        dt = datetime.strptime(last["created_at"], "%Y-%m-%d %H:%M:%S")
        if datetime.now() - dt > timedelta(hours=AUTO_BACKUP_HOURS):
            make_backup("auto")
            telegram_alert("Банк крові: автоматичний backup створено")
            return True
    except Exception:
        return False
    return False


def signature_hash(text):
    salt = SECRET_KEY[:16]
    return hashlib.sha256((salt + "|" + str(text or "")).encode()).hexdigest()

def api_token_required(f):
    @wraps(f)
    def w(*a, **kw):
        if not API_TOKEN:
            return jsonify(ok=False,error="API_TOKEN не налаштований"), 403
        token = request.headers.get("X-API-Token","")
        if token != API_TOKEN:
            return jsonify(ok=False,error="API token invalid"), 403
        return f(*a, **kw)
    return w

def v54_table(base_name):
    if IS_POSTGRES and base_name in ["transfusion_events","reaction_registry","api_events"]:
        return base_name + "_pg"
    return base_name


FIELD_LABELS_UA = {
    "patient_name": "ПІБ пацієнта",
    "birth_date": "Дата народження",
    "department": "Відділення",
    "component": "Компонент крові",
    "patient_group": "Група крові",
    "patient_rh": "Резус",
    "amount": "Кількість",
    "diagnosis": "Діагноз",
    "stock_component": "Компонент",
    "stock_group": "Група крові",
    "stock_rh": "Резус",
}

def validate_required_ua(data, fields):
    for f in fields:
        v = data.get(f, "")
        if v is None or str(v).strip() == "":
            return False, f'Заповніть поле: {FIELD_LABELS_UA.get(f, f)}', f
    return True, "", ""


def telegram_table(name):
    if IS_POSTGRES and name in ["telegram_logs","telegram_queue"]:
        return name + "_pg"
    return name

def telegram_in_silent_time():
    try:
        h = datetime.now().hour
        if TELEGRAM_SILENT_START == TELEGRAM_SILENT_END:
            return False
        if TELEGRAM_SILENT_START > TELEGRAM_SILENT_END:
            return h >= TELEGRAM_SILENT_START or h < TELEGRAM_SILENT_END
        return TELEGRAM_SILENT_START <= h < TELEGRAM_SILENT_END
    except Exception:
        return False

def telegram_recent_duplicate(event_type, message):
    try:
        table = telegram_table("telegram_logs")
        recent = rows(f"SELECT created_at,message FROM {table} WHERE event_type=? AND ok=1 ORDER BY id DESC LIMIT 20", (event_type,))
        cutoff = datetime.now() - timedelta(minutes=TELEGRAM_ANTI_SPAM_MINUTES)
        for r in recent:
            try:
                dt = datetime.strptime(r["created_at"], "%Y-%m-%d %H:%M:%S")
                if dt >= cutoff and r.get("message") == message:
                    return True
            except Exception:
                pass
    except Exception:
        pass
    return False

def telegram_log(event_type, chat_id, message, ok, response):
    try:
        table = telegram_table("telegram_logs")
        execute(f"INSERT INTO {table}(created_at,event_type,chat_id,message,ok,response) VALUES(?,?,?,?,?,?)",
                (now(), event_type, str(chat_id or ""), str(message or "")[:3900], 1 if ok else 0, str(response or "")[:1000]))
    except Exception:
        pass

def telegram_queue_message(event_type, chat_id, message, error=""):
    try:
        table = telegram_table("telegram_queue")
        execute(f"INSERT INTO {table}(created_at,event_type,chat_id,message,attempts,last_error,sent) VALUES(?,?,?,?,?,?,0)",
                (now(), event_type, str(chat_id or ""), str(message or "")[:3900], 0, str(error or "")[:1000]))
    except Exception:
        pass

def telegram_send_message(message, event_type="system", chat_id=None, force=False):
    if not TELEGRAM_ENABLED:
        return False, "Telegram disabled"
    if not TELEGRAM_BOT_TOKEN:
        return False, "TELEGRAM_BOT_TOKEN missing"
    chat_id = chat_id or TELEGRAM_CHAT_ID
    if not chat_id:
        return False, "TELEGRAM_CHAT_ID missing"
    if telegram_in_silent_time() and not force and event_type not in ["critical","reaction","security"]:
        return False, "silent time"
    if telegram_recent_duplicate(event_type, message) and not force:
        return False, "duplicate suppressed"
    try:
        import urllib.request, urllib.parse
        data = urllib.parse.urlencode({
            "chat_id": chat_id,
            "text": str(message or "")[:3900],
            "parse_mode": "HTML",
            "disable_web_page_preview": "true"
        }).encode()
        url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage"
        with urllib.request.urlopen(url, data=data, timeout=8) as resp:
            body = resp.read().decode("utf-8", "ignore")
        telegram_log(event_type, chat_id, message, True, body)
        return True, body
    except Exception as e:
        telegram_log(event_type, chat_id, message, False, e)
        telegram_queue_message(event_type, chat_id, message, e)
        return False, str(e)

def telegram_alert(text, event_type="system", force=False):
    ok, resp = telegram_send_message(text, event_type=event_type, force=force)
    return ok

def telegram_event_new_request(req):
    msg = (
        "🩸 <b>Нова вимога</b>\\n"
        f"Пацієнт: {req.get('patient_name','')}\\n"
        f"Відділення: {req.get('department','')}\\n"
        f"Компонент: {req.get('component','')}\\n"
        f"Група/Rh: {req.get('patient_group','')} {req.get('patient_rh','')}\\n"
        f"Кількість: {req.get('amount','')}"
    )
    return telegram_broadcast_roles(msg, ("admin","transfusion"), "new_request")

def telegram_event_reaction(req_id, reaction_type, severity, patient=""):
    msg = (
        "⚠️ <b>Трансфузійна реакція</b>\\n"
        f"Вимога №{req_id}\\n"
        f"Пацієнт: {patient}\\n"
        f"Тип: {reaction_type}\\n"
        f"Тяжкість: {severity}"
    )
    return telegram_broadcast_roles(msg, ("admin","transfusion"), "reaction", force=True)

def telegram_event_backup(ok=True):
    return telegram_broadcast_roles("✅ Backup створено" if ok else "❌ Backup помилка", ("admin","transfusion"), "backup")

def telegram_retry_queue(limit=20):
    table = telegram_table("telegram_queue")
    q = rows(f"SELECT * FROM {table} WHERE sent=0 ORDER BY id ASC LIMIT {int(limit)}")
    sent = 0
    for item in q:
        ok, resp = telegram_send_message(item.get("message",""), item.get("event_type","system"), item.get("chat_id") or TELEGRAM_CHAT_ID, force=True)
        if ok:
            execute(f"UPDATE {table} SET sent=1, attempts=attempts+1, last_error='' WHERE id=?", (item["id"],))
            sent += 1
        else:
            execute(f"UPDATE {table} SET attempts=attempts+1, last_error=? WHERE id=?", (str(resp)[:1000], item["id"]))
    return sent


def run_db_indexes():
    for name, table, col in [
        ("idx_requests_status","requests","status"),
        ("idx_requests_created_at","requests","created_at"),
        ("idx_requests_patient_name","requests","patient_name"),
        ("idx_stock_component","stock_entries","component"),
        ("idx_stock_expiry","stock_entries","expiry"),
        ("idx_audit_created_at","audit","created_at"),
    ]:
        try: execute(f"CREATE INDEX IF NOT EXISTS {name} ON {table}({col})")
        except Exception: pass

def cleanup_old_backups():
    try:
        cutoff = datetime.now() - timedelta(days=BACKUP_KEEP_DAYS)
        for b in rows("SELECT * FROM backups ORDER BY id"):
            try:
                dt = datetime.strptime(b["created_at"], "%Y-%m-%d %H:%M:%S")
                if dt < cutoff:
                    fp=os.path.join(BACKUP_DIR,b["filename"])
                    if os.path.exists(fp): os.remove(fp)
                    execute("DELETE FROM backups WHERE id=?", (b["id"],))
            except Exception: pass
    except Exception: pass

def make_rollback_snapshot(label="manual"):
    try:
        os.makedirs(BACKUP_DIR, exist_ok=True)
        fn=f"rollback_{label}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.zip"
        p=os.path.join(BACKUP_DIR,fn)
        with zipfile.ZipFile(p,"w",zipfile.ZIP_DEFLATED) as z:
            if os.path.exists(DB_PATH): z.write(DB_PATH, os.path.basename(DB_PATH))
            for folder in ["templates","static"]:
                if os.path.exists(folder):
                    for root,dirs,files in os.walk(folder):
                        for f in files:
                            full=os.path.join(root,f); z.write(full, full)
        execute("INSERT INTO backups(created_at,filename,created_by) VALUES(?,?,?)", (now(),fn,"rollback"))
        return p
    except Exception:
        return None

def nightly_backup_if_due():
    if not AUTO_BACKUP_ENABLED: return False
    try:
        if datetime.now().hour != AUTO_BACKUP_HOUR: return False
        last=row("SELECT created_at FROM backups WHERE created_by='nightly' ORDER BY id DESC LIMIT 1")
        if last and datetime.strptime(last["created_at"], "%Y-%m-%d %H:%M:%S").date()==datetime.now().date(): return False
        make_backup("nightly"); cleanup_old_backups()
        try: telegram_event_backup(True)
        except Exception: pass
        return True
    except Exception:
        try: telegram_event_backup(False)
        except Exception: pass
        return False

def health_payload():
    ok=True; err=""
    try: row("SELECT 1 AS ok")
    except Exception as e: ok=False; err=str(e)
    age=None
    try:
        b=row("SELECT created_at FROM backups ORDER BY id DESC LIMIT 1")
        if b:
            dt=datetime.strptime(b["created_at"], "%Y-%m-%d %H:%M:%S")
            age=round((datetime.now()-dt).total_seconds()/3600,2)
    except Exception: pass
    return {"ok":ok,"version":"V5.6.3","database":"ok" if ok else "error","database_error":err,"postgres":IS_POSTGRES,"telegram_configured":bool(TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID),"backup_age_hours":age,"auto_backup_enabled":AUTO_BACKUP_ENABLED,
        "admin_count": len(rows("SELECT id FROM users WHERE role=\'admin\' AND active=1")),"time":now()}


def ensure_default_admin():
    """V5.6.4: створює першого admin, якщо в БД немає активного admin."""
    try:
        admin = row("SELECT * FROM users WHERE role='admin' AND active=1 LIMIT 1")
        if admin:
            return False
        existing = row("SELECT * FROM users WHERE username=?", ("Sepsis",))
        if existing:
            execute("UPDATE users SET role='admin', active=1, must_change_password=1 WHERE username=?", ("Sepsis",))
            return True
        create_user("Sepsis","1986","admin","Адміністратор","Завідувач",1,1)
        try:
            audit("admin_bootstrap", "Default admin Sepsis created")
        except Exception:
            db_rollback_safe()
            pass
        return True
    except Exception as e:
        try:
            print("ADMIN_BOOTSTRAP_ERROR:", e)
        except Exception:
            db_rollback_safe()
            pass
        return False


def telegram_user_enabled(user_id=None, event_type=None):
    try:
        if user_id is None:
            u = current_user()
            user_id = u.get("id")
        u = row("SELECT * FROM users WHERE id=?", (user_id,))
        if not u:
            return False
        if not u.get("telegram_enabled") or not u.get("telegram_chat_id"):
            return False
        if event_type == "new_request" and int(u.get("telegram_notify_new_requests") or 0) != 1:
            return False
        if event_type == "critical" and int(u.get("telegram_notify_critical") or 0) != 1:
            return False
        if event_type == "expiring" and int(u.get("telegram_notify_expiring") or 0) != 1:
            return False
        if event_type == "reaction" and int(u.get("telegram_notify_reactions") or 0) != 1:
            return False
        if event_type == "backup" and int(u.get("telegram_notify_backups") or 0) != 1:
            return False
        return True
    except Exception:
        return False

def telegram_send_to_user(user_id, message, event_type="system", force=False):
    try:
        u = row("SELECT * FROM users WHERE id=?", (user_id,))
        if not u or not u.get("telegram_chat_id"):
            return False, "user telegram not configured"
        if not telegram_user_enabled(user_id, event_type) and not force:
            return False, "user telegram disabled"
        return telegram_send_message(message, event_type=event_type, chat_id=u.get("telegram_chat_id"), force=force)
    except Exception as e:
        return False, str(e)

def telegram_broadcast_roles(message, roles=("admin","transfusion"), event_type="system", force=False):
    sent = 0
    try:
        placeholders = ",".join(["?"]*len(roles))
        users = rows(f"SELECT * FROM users WHERE active=1 AND role IN ({placeholders})", tuple(roles))
        for u in users:
            ok, _ = telegram_send_to_user(u["id"], message, event_type=event_type, force=force)
            if ok:
                sent += 1
    except Exception:
        pass
    # fallback to global chat id
    if sent == 0 and TELEGRAM_CHAT_ID:
        ok, _ = telegram_send_message(message, event_type=event_type, force=force)
        if ok:
            sent += 1
    return sent

def telegram_link_url(user=None):
    try:
        u = user or current_user()
        username = TELEGRAM_BOT_USERNAME.strip().lstrip("@")
        if not username:
            return ""
        return f"https://t.me/{username}?start=link_{u.get('id')}_{u.get('username')}"
    except Exception:
        return ""

def telegram_process_update(update):
    try:
        msg = update.get("message") or update.get("edited_message") or {}
        text = (msg.get("text") or "").strip()
        chat = msg.get("chat") or {}
        from_user = msg.get("from") or {}
        chat_id = str(chat.get("id") or "")
        tg_username = from_user.get("username") or chat.get("username") or ""
        if not chat_id:
            return "no chat"

        if text.startswith("/start"):
            parts = text.split(maxsplit=1)
            payload = parts[1] if len(parts) > 1 else ""
            if payload.startswith("link_"):
                bits = payload.split("_")
                uid = None
                try:
                    uid = int(bits[1])
                except Exception:
                    uid = None
                if uid:
                    execute("""UPDATE users SET telegram_chat_id=?, telegram_username=?, telegram_enabled=1
                               WHERE id=?""", (chat_id, tg_username, uid))
                    telegram_send_message("✅ Telegram підключено до користувача в системі Банк крові.", "link", chat_id=chat_id, force=True)
                    return "linked"
            telegram_send_message("👋 Бот Банку крові активний. Команди: /stock /critical /requests /expiring", "start", chat_id=chat_id, force=True)
            return "start"

        if text.startswith("/stock"):
            stock = rows("SELECT component, donor_group, donor_rh, SUM(amount) AS total FROM stock_entries GROUP BY component, donor_group, donor_rh ORDER BY component LIMIT 25")
            lines = ["📦 <b>Склад крові</b>"]
            for s in stock:
                lines.append(f"{s.get('component','')} {s.get('donor_group','')} {s.get('donor_rh','')}: {s.get('total',0)}")
            telegram_send_message("\\n".join(lines) if len(lines)>1 else "Склад порожній", "command", chat_id=chat_id, force=True)
            return "stock"

        if text.startswith("/critical"):
            alerts = get_alerts_data() if "get_alerts_data" in globals() else {}
            low = alerts.get("low", []) if isinstance(alerts, dict) else []
            lines = ["🔴 <b>Критичні залишки</b>"]
            for x in low[:20]:
                lines.append(f"{x.get('component','')} {x.get('donor_group','')} {x.get('donor_rh','')}: {x.get('amount','')}")
            telegram_send_message("\\n".join(lines) if len(lines)>1 else "✅ Критичних залишків немає", "command", chat_id=chat_id, force=True)
            return "critical"

        if text.startswith("/requests"):
            req = rows("SELECT id,patient_name,department,component,status FROM requests ORDER BY id DESC LIMIT 10")
            lines = ["📋 <b>Останні вимоги</b>"]
            for r in req:
                lines.append(f"№{r.get('id')} {r.get('patient_name','')} — {r.get('component','')} — {r.get('status','')}")
            telegram_send_message("\\n".join(lines) if len(lines)>1 else "Вимог немає", "command", chat_id=chat_id, force=True)
            return "requests"

        if text.startswith("/expiring"):
            alerts = get_alerts_data() if "get_alerts_data" in globals() else {}
            exp = alerts.get("expiry", []) if isinstance(alerts, dict) else []
            lines = ["⏰ <b>Термін придатності</b>"]
            for x in exp[:20]:
                lines.append(f"{x.get('component','')} {x.get('donor_group','')} {x.get('donor_rh','')} до {x.get('expiry','')}: {x.get('amount','')}")
            telegram_send_message("\\n".join(lines) if len(lines)>1 else "✅ Немає близьких термінів", "command", chat_id=chat_id, force=True)
            return "expiring"

        telegram_send_message("Команди: /stock /critical /requests /expiring", "command", chat_id=chat_id, force=True)
        return "unknown"
    except Exception as e:
        return f"error: {e}"


def ensure_telegram_user_columns_safe():
    cols = [
        ("telegram_chat_id", "TEXT"),
        ("telegram_username", "TEXT"),
        ("telegram_enabled", "INTEGER DEFAULT 0"),
        ("telegram_notify_new_requests", "INTEGER DEFAULT 1"),
        ("telegram_notify_critical", "INTEGER DEFAULT 1"),
        ("telegram_notify_expiring", "INTEGER DEFAULT 1"),
        ("telegram_notify_reactions", "INTEGER DEFAULT 1"),
        ("telegram_notify_backups", "INTEGER DEFAULT 0"),
    ]
    for name, typ in cols:
        try:
            execute(f"ALTER TABLE users ADD COLUMN {name} {typ}")
        except Exception:
            db_rollback_safe()
            pass
    return True

@app.before_request
def before():
    # V593_PUBLIC_EMERGENCY_PATHS
    if request.path in ["/api/health-debug","/api/emergency-db-fix","/api/public-health"]:
        return None
    # V592_CSRF_EXEMPT_SECURITY_LOGIN_ATTEMPT
    if request.path == "/api/security/login-attempt":
        return None
    if REQUIRE_HTTPS and request.headers.get("X-Forwarded-Proto","https") != "https":
        return redirect(request.url.replace("http://","https://"), code=301)
    ip = request.headers.get("X-Forwarded-For", request.remote_addr or "local").split(",")[0]
    t = time.time()
    if BANS.get(ip,0) > t:
        return jsonify(ok=False,error="Забагато запитів"), 429
    key = (ip, int(t//60))
    RATE[key] = RATE.get(key,0)+1
    if RATE[key] > 240:
        BANS[ip] = t + 120
        return jsonify(ok=False,error="Rate limit"), 429
    if session.get("user_id"):
        last = session.get("last_seen", t)
        if t - last > SESSION_TIMEOUT_MINUTES*60:
            session.clear()
            if request.path.startswith("/api/"):
                return jsonify(ok=False,error="Сесія завершена"), 401
            return redirect(url_for("index"))
        session["last_seen"] = t
    if request.method in ["POST","PUT","DELETE"] and request.path.startswith("/api/"):
        if request.path.startswith("/api/external/") and API_TOKEN and request.headers.get("X-API-Token","") == API_TOKEN:
            pass
        elif session.get("csrf") != request.headers.get("X-CSRF-Token"):
            return jsonify(ok=False,error="CSRF token invalid"), 403

@app.after_request
def headers(resp):
    resp.headers["X-Frame-Options"]="SAMEORIGIN"
    resp.headers["X-Content-Type-Options"]="nosniff"
    resp.headers["Referrer-Policy"]="same-origin"
    resp.headers["Content-Security-Policy"]="default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'"
    return resp

def login_required(f):
    @wraps(f)
    def w(*a, **kw):
        if not current_user(): return redirect(url_for("index"))
        return f(*a, **kw)
    return w

def role_required(*roles):
    def deco(f):
        @wraps(f)
        def w(*a, **kw):
            u = current_user()
            if not u or u["role"] not in roles:
                return jsonify(ok=False,error="Недостатньо прав"), 403
            return f(*a, **kw)
        return w
    return deco

@app.route("/")
def index():
    # V572_SAFE_INDEX
    try:
        safe_startup_check()
    except Exception:
        pass
    # V565_INDEX_ADMIN_BOOTSTRAP
    try:
        ensure_default_admin()
    except Exception:
        pass
    if "csrf" not in session: session["csrf"] = secrets.token_hex(24)
    session["last_seen"] = time.time()
    u = current_user()
    if not u: return render_template("login.html", title=APP_TITLE)
    if u["first_login"]: return render_template("change_password.html", title=APP_TITLE, user=u, csrf=session["csrf"])
    return render_template("app.html", title=APP_TITLE, user=u, csrf=session["csrf"])

@app.post("/login")
def login():
    # V595_LOGIN_ROLLBACK_BEFORE_SELECT
    db_rollback_safe()
    # V594_LOGIN_ROLLBACK_BEFORE_SELECT
    db_rollback_safe()
    # V593_LOGIN_SAFE_START
    try:
        v593_fix_all_known_migrations()
    except Exception as e:
        try: print("V593_LOGIN_MIGRATION_ERROR:", e)
        except Exception: pass
    # V572_SAFE_LOGIN
    try:
        safe_startup_check()
    except Exception:
        pass
    # V571_LOGIN_TELEGRAM_MIGRATION
    try:
        ensure_telegram_user_columns_safe()
    except Exception:
        pass
    # V565_LOGIN_ADMIN_BOOTSTRAP
    try:
        ensure_default_admin()
    except Exception as e:
        print("ADMIN_BOOTSTRAP_LOGIN_ERROR:", e)
    username = request.form.get("username","").strip()
    password = request.form.get("password","")
    ip = request.headers.get("X-Forwarded-For", request.remote_addr or "")
    u = row("SELECT * FROM users WHERE username=?", (username,))
    ok = False
    msg = "Невірний логін або пароль"
    if u and u.get("locked_until"):
        try:
            if datetime.strptime(u["locked_until"], "%Y-%m-%d %H:%M:%S") > datetime.now():
                msg = "Акаунт тимчасово заблоковано"
            else:
                execute("UPDATE users SET locked_until=NULL,failed_logins=0 WHERE id=?", (u["id"],))
                u = row("SELECT * FROM users WHERE username=?", (username,))
        except Exception: pass
    if u and u["active"] and not u.get("locked_until") and password_ok(password, u["salt"], u["password_hash"]):
        ok = True
    execute("INSERT INTO login_attempts(created_at,username,ip,ok) VALUES(?,?,?,?)", (now(), username, ip, 1 if ok else 0))
    if not ok:
        if u:
            failed=(u.get("failed_logins") or 0)+1
            lock=None
            if failed>=5: lock=(datetime.now()+timedelta(minutes=15)).strftime("%Y-%m-%d %H:%M:%S")
            execute("UPDATE users SET failed_logins=?,locked_until=? WHERE id=?", (failed,lock,u["id"]))
        return render_template("login.html", title=APP_TITLE, error=msg)
    session.clear(); session["user_id"] = u["id"]; session["csrf"] = secrets.token_hex(24)
    session["last_seen"] = time.time()
    execute("UPDATE users SET failed_logins=0,locked_until=NULL WHERE id=?", (u["id"],))
    audit("login","Вхід у систему")
    return redirect(url_for("index"))

@app.get("/logout")
def logout():
    session.clear()
    return redirect(url_for("index"))

@app.post("/change-password")
@login_required
def change_password():
    u = current_user()
    old = request.form.get("old_password","")
    p1 = request.form.get("new_password","")
    p2 = request.form.get("new_password2","")
    stored = row("SELECT * FROM users WHERE id=?", (u["id"],))
    if not password_ok(old, stored["salt"], stored["password_hash"]):
        return render_template("change_password.html", title=APP_TITLE, user=u, csrf=session["csrf"], error="Старий пароль невірний")
    if p1 != p2:
        return render_template("change_password.html", title=APP_TITLE, user=u, csrf=session["csrf"], error="Паролі не співпадають")
    ok,msg = password_policy_ok(p1)
    if not ok:
        return render_template("change_password.html", title=APP_TITLE, user=u, csrf=session["csrf"], error=msg)
    salt, ph = hash_password(p1)
    execute("UPDATE users SET salt=?,password_hash=?,first_login=0 WHERE id=?", (salt,ph,u["id"]))
    audit("change_password","Користувач змінив пароль")
    return redirect(url_for("index"))

@app.get("/api/me")
@login_required
def api_me(): return jsonify(current_user())

@app.get("/api/users")
@login_required
def api_users():
    u=current_user()
    if u["role"]=="admin":
        return jsonify(rows("SELECT id,username,role,full_name,position,active,created_at FROM users ORDER BY id"))
    if u["role"]=="transfusion":
        return jsonify(rows("SELECT id,username,role,full_name,position,active,created_at FROM users WHERE role IN ('doctor','nurse') ORDER BY id"))
    return jsonify(ok=False,error="Недостатньо прав"),403

@app.post("/api/users/create")
@role_required("admin","transfusion")
def api_user_create():
    u=current_user(); d=request.json or {}
    role=d.get("role")
    if u["role"]=="transfusion" and role not in ["doctor","nurse"]:
        return jsonify(ok=False,error="Трансфузіолог може створювати тільки лікарів і медсестер")
    if role not in ["admin","transfusion","doctor","nurse"]:
        return jsonify(ok=False,error="Невірна роль")
    username=(d.get("username") or "").strip()
    password=d.get("password") or ""
    ok,msg=password_policy_ok(password)
    if not username or not ok: return jsonify(ok=False,error=msg or "Логін обов’язковий")
    try:
        create_user(username,password,role,d.get("full_name",""),d.get("position",""),1,1)
        audit("create_user", username)
        return jsonify(ok=True)
    except Exception as e:
        return jsonify(ok=False,error=str(e))

@app.post("/api/users/update")
@role_required("admin","transfusion")
def api_user_update():
    cu=current_user(); d=request.json or {}; uid=int(d.get("id"))
    target=row("SELECT * FROM users WHERE id=?", (uid,))
    if not target: return jsonify(ok=False,error="Користувача не знайдено")
    if target["username"]=="Sepsis" and cu["username"]!="Sepsis": return jsonify(ok=False,error="Sepsis може редагувати тільки Sepsis")
    if cu["role"]=="transfusion" and target["role"] not in ["doctor","nurse"]: return jsonify(ok=False,error="Трансфузіолог керує тільки лікарями/медсестрами")
    allowed={}
    for k in ["full_name","position","role","active"]:
        if k in d: allowed[k]=d[k]
    if "role" in allowed:
        if cu["role"]=="transfusion" and allowed["role"] not in ["doctor","nurse"]: return jsonify(ok=False,error="Трансфузіолог може призначати тільки doctor/nurse")
        if allowed["role"] not in ["admin","transfusion","doctor","nurse"]: return jsonify(ok=False,error="Невірна роль")
    if "username" in d:
        username=(d.get("username") or "").strip()
        if len(username)<3: return jsonify(ok=False,error="Логін мінімум 3 символи")
        if row("SELECT id FROM users WHERE username=? AND id<>?",(username,uid)): return jsonify(ok=False,error="Такий логін вже існує")
        allowed["username"]=username
    if "password" in d and d.get("password"):
        ok,msg=password_policy_ok(d["password"])
        if not ok: return jsonify(ok=False,error=msg)
        salt,ph=hash_password(d["password"])
        allowed["salt"]=salt; allowed["password_hash"]=ph; allowed["first_login"]=1
    if "active" in allowed: allowed["active"]=1 if allowed["active"] else 0
    if not allowed: return jsonify(ok=False,error="Немає змін")
    execute("UPDATE users SET "+",".join([f"{k}=?" for k in allowed])+" WHERE id=?", tuple(list(allowed.values())+[uid]))
    audit("update_user", "user updated")
    notify(uid,"Профіль змінено","Ваш профіль змінено.")
    return jsonify(ok=True, password_changed=("password_hash" in allowed))

@app.get("/api/requests")
@login_required
def api_requests():
    u=current_user()
    if u["role"]=="doctor": return jsonify(rows("SELECT * FROM requests WHERE created_by=? ORDER BY id DESC",(u["id"],)))
    return jsonify(rows("SELECT * FROM requests ORDER BY id DESC"))

@app.get("/api/requests/mine")
@login_required
def api_requests_mine():
    return jsonify(rows("SELECT * FROM requests WHERE created_by=? ORDER BY id DESC",(current_user()["id"],)))

@app.post("/api/request/create")
@role_required("doctor","admin","transfusion")
def api_request_create():
    u=current_user(); d=request.json or {}
    for k in ["patient_name","birth_date","department","component","patient_group","patient_rh","amount","diagnosis"]:
        if not d.get(k): return jsonify(ok=False,error=f"Заповніть поле: {FIELD_LABELS_UA.get(k,k)}", field=k), 400
    execute("""INSERT INTO requests(created_at,created_by,doctor_name,doctor_position,patient_name,birth_date,address,patient_status,department,component,patient_group,patient_rh,amount,urgency,diagnosis,note,status)
               VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (now(),u["id"],u["full_name"],u["position"],d["patient_name"],d["birth_date"],d.get("address",""),d.get("patient_status",""),d["department"],d["component"],d["patient_group"],d["patient_rh"],float(d["amount"]),d.get("urgency","Планово"),d["diagnosis"],d.get("note",""),"Нова"))
    audit("create_request", d["patient_name"])
    telegram_event_new_request(d)
    return jsonify(ok=True)

@app.post("/api/request/action")
@role_required("admin","transfusion")
def api_request_action():
    u=current_user(); d=request.json or {}; rid=int(d.get("id")); action=d.get("action")
    if action=="approve": execute("UPDATE requests SET status='Погоджено',approved_by=? WHERE id=?", (u["full_name"] or u["username"], rid))
    elif action=="reject": execute("UPDATE requests SET status='Відмовлено' WHERE id=?", (rid,))
    elif action=="issue":
        req = row("SELECT * FROM requests WHERE id=?", (rid,))
        ok1,w1 = abo_compatible(req["patient_group"], d.get("donor_group",""), req["component"])
        ok2,w2 = rh_compatible(req["patient_rh"], d.get("donor_rh",""))
        warning = "; ".join([x for x in [w1,w2] if x])
        comp_ok = 1 if (ok1 and ok2) else 0
        if not comp_ok and not d.get("override"):
            return jsonify(ok=False,error=warning or "Несумісність крові")
        execute("""UPDATE requests SET status='Видано',issued_by=?,issued_at=?,donor_group=?,donor_rh=?,pack_no=?,series=?,expiry=?,compatibility_ok=?,compatibility_warning=? WHERE id=?""",
                (u["full_name"] or u["username"],now(),d.get("donor_group",""),d.get("donor_rh",""),d.get("pack_no",""),d.get("series",""),d.get("expiry",""),comp_ok,warning,rid))
    else: return jsonify(ok=False,error="Невідома дія")
    audit("request_action", f"{rid}:{action}")
    return jsonify(ok=True)

@app.post("/api/request/used")
@role_required("admin","transfusion","doctor","nurse")
def api_request_used():
    d=request.json or {}
    if not d.get("use_date") or not d.get("used_by") or not d.get("use_confirm"): return jsonify(ok=False,error="Заповніть дату, хто підтвердив і підтвердження")
    execute("UPDATE requests SET status='Використано',used_at=?,used_by=?,use_confirm=? WHERE id=?", (d["use_date"],d["used_by"],d["use_confirm"],int(d["id"])))
    audit("request_used", str(d["id"]))
    return jsonify(ok=True)

@app.post("/api/request/writeoff")
@role_required("admin","transfusion","doctor","nurse")
def api_request_writeoff():
    d=request.json or {}
    if not d.get("writeoff_date") or not d.get("written_by") or not d.get("writeoff_reason"): return jsonify(ok=False,error="Заповніть дату, хто списав і причину")
    execute("UPDATE requests SET status='Списано',writeoff_at=?,written_by=?,writeoff_reason=? WHERE id=?", (d["writeoff_date"],d["written_by"],d["writeoff_reason"],int(d["id"])))
    audit("request_writeoff", str(d["id"]))
    return jsonify(ok=True)

@app.post("/api/request/reaction")
@role_required("admin","transfusion","doctor","nurse")
def api_reaction():
    d=request.json or {}
    execute("""UPDATE requests SET reaction_present=?,reaction_type=?,reaction_severity=?,reaction_description=?,reaction_result=? WHERE id=?""",
            (d.get("reaction_present","Так"),d.get("reaction_type",""),d.get("reaction_severity",""),d.get("reaction_description",""),d.get("reaction_result",""),int(d["id"])))
    audit("reaction", str(d["id"]))
    return jsonify(ok=True)

@app.get("/api/doctor/reminders")
@role_required("doctor","admin","transfusion")
def api_doc_reminders():
    u=current_user()
    q="SELECT * FROM requests WHERE status='Видано' AND (used_at IS NULL OR writeoff_at IS NULL)"
    params=()
    if u["role"]=="doctor":
        q+=" AND created_by=?"; params=(u["id"],)
    return jsonify(rows(q+" ORDER BY id DESC", params))

@app.post("/api/stock/add")
@role_required("admin","transfusion")
def api_stock_add():
    try:
        u=current_user()
        d=request.json or {}
        component = d.get("component") or d.get("stock_component") or ""
        donor_group = d.get("donor_group") or d.get("stock_group") or d.get("group") or ""
        donor_rh = d.get("donor_rh") or d.get("stock_rh") or d.get("rh") or ""
        amount_raw = d.get("amount") or d.get("qty") or d.get("quantity") or ""
        stock_type = d.get("type") or "Надходження"
        if not component:
            return jsonify(ok=False,error="Заповніть поле: Компонент"), 400
        if not amount_raw:
            return jsonify(ok=False,error="Заповніть поле: Кількість"), 400
        try:
            amount = float(str(amount_raw).replace(",", "."))
        except Exception:
            return jsonify(ok=False,error="Кількість має бути числом"), 400
        execute("""INSERT INTO stock_entries(created_at,user_id,type,component,donor_group,donor_rh,amount,pack_no,series,expiry,patient_name,note,qr_code)
                   VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (now(),u["id"],stock_type,component,donor_group,donor_rh,amount,d.get("pack_no",""),d.get("series",""),d.get("expiry",""),d.get("patient_name",""),d.get("note",""),d.get("qr_code","")))
        audit("stock_add", component)
        return jsonify(ok=True)
    except Exception as e:
        audit("stock_add_error", str(e))
        return jsonify(ok=False,error=f"Помилка складу: {str(e)}"), 500

@app.get("/api/stock")
@login_required
def api_stock():
    return jsonify(rows("""SELECT component,donor_group as 'group',donor_rh as rh,SUM(CASE WHEN type='Надходження' THEN amount ELSE -amount END) qty
                           FROM stock_entries GROUP BY component,donor_group,donor_rh ORDER BY component"""))

@app.get("/api/alerts")
@login_required
def api_alerts():
    low=rows("""SELECT component,donor_group as "group",donor_rh as rh,SUM(CASE WHEN type='Надходження' THEN amount ELSE -amount END) qty
                FROM stock_entries GROUP BY component,donor_group,donor_rh HAVING SUM(CASE WHEN type='Надходження' THEN amount ELSE -amount END)<5""")
    all_exp=rows("SELECT * FROM stock_entries WHERE expiry IS NOT NULL AND expiry<>'' ORDER BY expiry")
    exp=[]
    try:
        from datetime import date
        today=datetime.now().date()
        for x in all_exp:
            try:
                if datetime.strptime(x.get("expiry",""), "%Y-%m-%d").date() <= today + timedelta(days=7):
                    exp.append(x)
            except Exception:
                pass
    except Exception:
        exp=[]
    return jsonify(low=low, expiry=exp)

@app.get("/api/audit")
@role_required("admin","transfusion")
def api_audit(): return jsonify(rows("SELECT * FROM audit ORDER BY id DESC LIMIT 200"))

@app.get("/api/notifications")
@login_required
def api_notifications():
    return jsonify(rows("SELECT * FROM notifications WHERE user_id=? ORDER BY id DESC LIMIT 50",(current_user()["id"],)))

@app.get("/api/login-history")
@role_required("admin")
def api_login_history(): return jsonify(rows("SELECT * FROM login_attempts ORDER BY id DESC LIMIT 200"))

@app.get("/api/reports/preview")
@role_required("admin","transfusion")
def api_reports_preview():
    return jsonify(rows=rows("SELECT id,created_at,patient_name,component,amount,status,department,doctor_name FROM requests ORDER BY id DESC LIMIT 500"))

@app.get("/api/reports/reactions")
@role_required("admin","transfusion")
def api_reports_reactions(): return jsonify(rows=rows("SELECT * FROM requests WHERE reaction_present='Так' ORDER BY id DESC"))


def setup_pdf_font(c, size=12):
    try:
        from reportlab.pdfbase import pdfmetrics
        from reportlab.pdfbase.ttfonts import TTFont
        candidates = ["/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSansCondensed.ttf", "DejaVuSans.ttf"]
        for fp in candidates:
            if os.path.exists(fp):
                pdfmetrics.registerFont(TTFont("DejaVu", fp))
                c.setFont("DejaVu", size)
                return "DejaVu"
    except Exception:
        pass
    c.setFont("Helvetica", size)
    return "Helvetica"

def pdf_text(c, x, y, text):
    try:
        c.drawString(x, y, str(text or ""))
    except Exception:
        safe = str(text or "").encode("latin-1", "replace").decode("latin-1")
        c.drawString(x, y, safe)


@app.get("/reports/request/<int:rid>.pdf")
@login_required
def request_pdf(rid):
    req = row("SELECT * FROM requests WHERE id=?", (rid,))
    if not req:
        return "Not found", 404
    bio = BytesIO()
    c = canvas.Canvas(bio, pagesize=A4)
    try:
        setup_pdf_font(c, 12)
    except Exception:
        try: c.setFont("Helvetica", 12)
        except Exception: pass
    y = 800
    try:
        pdf_text(c, 40, y, f"Вимога №{rid}")
    except Exception:
        c.drawString(40, y, f"Request #{rid}")
    y -= 30
    fields = [
        ("Пацієнт", req.get("patient_name","")),
        ("Дата народження", req.get("birth_date","")),
        ("Відділення", req.get("department","")),
        ("Компонент", req.get("component","")),
        ("Група/Rh", f"{req.get('patient_group','')} {req.get('patient_rh','')}"),
        ("Кількість", req.get("amount","")),
        ("Статус", req.get("status","")),
        ("Діагноз", req.get("diagnosis","")),
        ("Лікар", req.get("doctor_name","")),
        ("Пакет", req.get("pack_no","")),
        ("Серія", req.get("series","")),
        ("Термін", req.get("expiry","")),
        ("Сумісність", req.get("compatibility_warning","") or "OK"),
    ]
    for k, v in fields:
        try:
            pdf_text(c, 40, y, f"{k}: {v}")
        except Exception:
            c.drawString(40, y, f"{k}: {v}")
        y -= 20
        if y < 60:
            c.showPage()
            try: setup_pdf_font(c, 12)
            except Exception: pass
            y = 800
    c.save()
    bio.seek(0)
    return send_file(bio, as_attachment=True, download_name=f"request_{rid}.pdf")

@app.get("/reports/export/<fmt>")
@role_required("admin","transfusion")
def report_export(fmt):
    data=rows("SELECT id,created_at,patient_name,component,amount,status FROM requests ORDER BY id DESC")
    if fmt=="xlsx":
        wb=Workbook(); ws=wb.active; ws.append(["ID","Дата","Пацієнт","Компонент","К-сть","Статус"])
        for x in data: ws.append([x["id"],x["created_at"],x["patient_name"],x["component"],x["amount"],x["status"]])
        bio=BytesIO(); wb.save(bio); bio.seek(0); return send_file(bio, as_attachment=True, download_name="requests.xlsx")
    bio=BytesIO(); c=canvas.Canvas(bio,pagesize=A4); setup_pdf_font(c,11); y=800; pdf_text(c,40,y,"Звіт по вимогах"); y-=30
    for x in data[:40]: pdf_text(c,40,y,f'{x["id"]} {x["patient_name"]} {x["component"]} {x["status"]}'); y-=18
    c.save(); bio.seek(0); return send_file(bio, as_attachment=True, download_name="requests.pdf")

@app.get("/backup")
@role_required("admin")
def backup():
    init_db()
    return send_file(DB_PATH, as_attachment=True, download_name="blood_bank_backup.db")

@app.post("/api/admin/delete-record")
@role_required("admin","transfusion")
def delete_record():
    d=request.json or {}; table=d.get("table"); rid=int(d.get("id"))
    if table not in ["requests","stock_entries","users","audit"]:
        return jsonify(ok=False,error="Недозволена таблиця")
    u = current_user()
    if table == "users":
        target = row("SELECT * FROM users WHERE id=?", (rid,))
        if not target:
            return jsonify(ok=False,error="Не знайдено")
        if target["username"] == "Sepsis":
            return jsonify(ok=False,error="Sepsis видаляти не можна")
        if u["role"] == "transfusion" and target["role"] not in ["doctor","nurse"]:
            return jsonify(ok=False,error="Трансфузіолог може видаляти тільки лікарів/медсестер")
    rec=row(f"SELECT * FROM {table} WHERE id=?", (rid,))
    if not rec:
        return jsonify(ok=False,error="Не знайдено")
    execute("INSERT INTO trash(created_at,source_table,source_id,data,deleted_by,reason) VALUES(?,?,?,?,?,?)", (now(),table,rid,json.dumps(rec,ensure_ascii=False),u["username"],d.get("reason","")))
    execute(f"DELETE FROM {table} WHERE id=?", (rid,))
    audit("delete_record", f"{table}:{rid}")
    return jsonify(ok=True)

@app.get("/api/trash")
@role_required("admin")
def trash(): return jsonify(rows("SELECT * FROM trash ORDER BY id DESC"))


@app.post("/api/trash/restore")
@role_required("admin")
def restore_record():
    d = request.json or {}
    tid = int(d.get("id"))
    tr = row("SELECT * FROM trash WHERE id=?", (tid,))
    if not tr:
        return jsonify(ok=False,error="Запис у кошику не знайдено")
    table = tr["source_table"]
    if table not in ["requests","stock_entries","users","audit"]:
        return jsonify(ok=False,error="Відновлення для цієї таблиці не дозволено")
    data = json.loads(tr["data"] or "{}")
    old_id = data.get("id")

    # If original ID already exists, insert without ID to avoid conflict.
    exists = row(f"SELECT id FROM {table} WHERE id=?", (old_id,)) if old_id is not None else None
    restore_data = dict(data)
    if exists and "id" in restore_data:
        restore_data.pop("id", None)

    # For users: block duplicate username on restore.
    if table == "users" and restore_data.get("username"):
        existing_user = row("SELECT id FROM users WHERE username=?", (restore_data["username"],))
        if existing_user:
            restore_data["username"] = restore_data["username"] + "_restored_" + str(tid)

    cols = list(restore_data.keys())
    vals = [restore_data[c] for c in cols]
    placeholders = ",".join(["?"] * len(cols))
    execute(f"INSERT INTO {table} ({','.join(cols)}) VALUES ({placeholders})", tuple(vals))
    execute("DELETE FROM trash WHERE id=?", (tid,))
    audit("restore_record", f"{table}:{old_id}")
    return jsonify(ok=True)

@app.get("/api/security/integrity")
@role_required("admin")
def integrity(): return jsonify(ok=True, time=now(), db_exists=os.path.exists(DB_PATH))

@app.post("/api/spellcheck")
@login_required
def spellcheck():
    text=(request.json or {}).get("text","")
    issues=[]
    for bad in ["темммпература","пацієнтт","гемоглобінн"]:
        if bad in text: issues.append({"word":bad,"suggestion":bad.replace("ммм","м").replace("тт","т").replace("нн","н")})
    return jsonify(ok=True, issues=issues)

# ===== RENDER / GUNICORN STARTUP DB INIT =====
try:
    with app.app_context():
        init_db()
except Exception as e:
    print("DB startup init error:", e)


@app.get("/api/dashboard")
@login_required
def api_dashboard():
    return jsonify(
        requests=rows("SELECT status, COUNT(*) count FROM requests GROUP BY status"),
        components=rows("SELECT component, SUM(amount) amount FROM requests GROUP BY component"),
        departments=rows("SELECT department, COUNT(*) count FROM requests GROUP BY department"),
        reactions=rows("SELECT reaction_type, COUNT(*) count FROM requests WHERE reaction_present='Так' GROUP BY reaction_type"),
        daily=rows("SELECT substr(created_at,1,10) day, COUNT(*) count FROM requests GROUP BY substr(created_at,1,10) ORDER BY day DESC LIMIT 14")
    )

@app.get("/api/patients/history")
@login_required
def api_patient_history():
    name=request.args.get("name","").strip()
    if not name: return jsonify(rows=[])
    return jsonify(rows=rows("SELECT * FROM requests WHERE patient_name LIKE ? ORDER BY id DESC", (f"%{name}%",)))

@app.get("/api/backups")
@role_required("admin")
def api_backups():
    return jsonify(rows("SELECT * FROM backups ORDER BY id DESC"))

@app.post("/api/backups/create")
@role_required("admin")
def api_backup_create():
    path=make_backup(current_user()["username"])
    audit("backup_create", os.path.basename(path))
    telegram_event_backup(True)
    return jsonify(ok=True, filename=os.path.basename(path))

@app.get("/api/backups/download/<int:bid>")
@role_required("admin")
def api_backup_download(bid):
    b=row("SELECT * FROM backups WHERE id=?", (bid,))
    return send_file(os.path.join(BACKUP_DIR,b["filename"]), as_attachment=True, download_name=b["filename"])

@app.post("/api/backups/restore")
@role_required("admin")
def api_backup_restore():
    d=request.json or {}; bid=int(d.get("id"))
    b=row("SELECT * FROM backups WHERE id=?", (bid,))
    if not b: return jsonify(ok=False,error="Backup не знайдено")
    if IS_POSTGRES:
        return jsonify(ok=False,error="Для PostgreSQL restore виконуйте через Render PostgreSQL Backups або імпорт JSON вручну. Download backup доступний.")
    make_backup("before_restore")
    with zipfile.ZipFile(os.path.join(BACKUP_DIR,b["filename"])) as z:
        z.extract("blood_bank_v4.db", BACKUP_DIR)
    shutil.copy(os.path.join(BACKUP_DIR,"blood_bank_v4.db"), DB_PATH)
    audit("backup_restore", b["filename"])
    return jsonify(ok=True)


@app.get("/api/system/db")
def api_system_db():
    try:
        u = row("SELECT COUNT(*) AS count FROM users")
        return jsonify(ok=True, postgres=IS_POSTGRES, users=u.get("count", 0))
    except Exception as e:
        return jsonify(ok=False, postgres=IS_POSTGRES, error=str(e)), 500


    try:
        import urllib.request, urllib.parse
        data = urllib.parse.urlencode({"chat_id": TELEGRAM_CHAT_ID, "text": text}).encode()
        url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage"
        urllib.request.urlopen(url, data=data, timeout=5)
        return True
    except Exception:
        return False

@app.post("/api/stock/auto-expire")
@role_required("admin","transfusion")
def api_stock_auto_expire():
    expired = []
    all_items = rows("SELECT * FROM stock_entries WHERE type='Надходження' AND expiry IS NOT NULL AND expiry<>''")
    today = datetime.now().date()
    for x in all_items:
        try:
            if datetime.strptime(x.get("expiry",""), "%Y-%m-%d").date() < today:
                execute("""INSERT INTO stock_entries(created_at,user_id,type,component,donor_group,donor_rh,amount,pack_no,series,expiry,patient_name,note,qr_code)
                           VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                        (now(), current_user()["id"], "Списання", x.get("component",""), x.get("donor_group",""), x.get("donor_rh",""), x.get("amount",0), x.get("pack_no",""), x.get("series",""), x.get("expiry",""), "", "Автосписання: закінчився термін", x.get("qr_code","")))
                expired.append(x)
        except Exception:
            db_rollback_safe()
            pass
    audit("auto_expire", f"expired={len(expired)}")
    if expired:
        telegram_alert(f"Банк крові: автосписано прострочені компоненти: {len(expired)}")
    return jsonify(ok=True, expired=len(expired))

@app.get("/api/transfusions")
@login_required
def api_transfusions():
    return jsonify(rows("""SELECT id,created_at,patient_name,component,amount,status,doctor_name,issued_at,used_at,pack_no,series,donor_group,donor_rh,reaction_present,reaction_type
                           FROM requests
                           WHERE status IN ('Видано','Використано','Списано') OR used_at IS NOT NULL OR issued_at IS NOT NULL
                           ORDER BY id DESC LIMIT 500"""))

@app.get("/api/barcode/<code>")
@login_required
def api_barcode(code):
    return jsonify(ok=True, code=code, label=f"Пакет/QR: {code}")


@app.post("/api/notifications/test")
@login_required
def api_notifications_test():
    u=current_user()
    notify(u["id"], "Тестове повідомлення", "Browser notification / PWA перевірка")
    telegram_alert(f"🔔 Тестове повідомлення для {u['username']}", "test", force=True)
    return jsonify(ok=True)

@app.get("/api/audit/security")
@role_required("admin")
def api_audit_security():
    return jsonify(
        failed_logins=rows("SELECT username, ip, user_agent, created_at FROM login_attempts WHERE ok=0 ORDER BY id DESC LIMIT 100"),
        recent_actions=rows("SELECT created_at,username,role,action,details,ip,user_agent FROM audit ORDER BY id DESC LIMIT 100")
    )


@app.post("/api/transfusions/event")
@role_required("admin","transfusion","doctor","nurse")
def api_transfusion_event():
    d=request.json or {}
    req_id=int(d.get("request_id") or d.get("id") or 0)
    req=row("SELECT * FROM requests WHERE id=?", (req_id,))
    if not req:
        return jsonify(ok=False,error="Вимогу не знайдено")
    sig = signature_hash(f"{req_id}|{current_user()['username']}|{now()}|{d.get('result','')}")
    table=v54_table("transfusion_events")
    execute(f"""INSERT INTO {table}(created_at,request_id,patient_name,component,pack_no,nurse_name,doctor_name,started_at,finished_at,result,signature)
                VALUES(?,?,?,?,?,?,?,?,?,?,?)""",
            (now(),req_id,req.get("patient_name",""),req.get("component",""),req.get("pack_no",""),d.get("nurse_name",current_user().get("full_name","")),req.get("doctor_name",""),d.get("started_at",""),d.get("finished_at",""),d.get("result",""),sig))
    audit("transfusion_event", f"request={req_id}")
    return jsonify(ok=True, signature=sig)

@app.get("/api/transfusions/events")
@login_required
def api_transfusion_events():
    table=v54_table("transfusion_events")
    return jsonify(rows(f"SELECT * FROM {table} ORDER BY id DESC LIMIT 500"))

@app.post("/api/reactions/register")
@role_required("admin","transfusion","doctor","nurse")
def api_reactions_register():
    d=request.json or {}
    table=v54_table("reaction_registry")
    execute(f"""INSERT INTO {table}(created_at,request_id,patient_name,reaction_type,severity,description,action_taken,result,reported_by)
                VALUES(?,?,?,?,?,?,?,?,?)""",
            (now(),int(d.get("request_id") or 0),d.get("patient_name",""),d.get("reaction_type",""),d.get("severity",""),d.get("description",""),d.get("action_taken",""),d.get("result",""),current_user().get("username","")))
    audit("reaction_register", d.get("patient_name",""))
    telegram_event_reaction(int(d.get("request_id") or 0), d.get("reaction_type",""), d.get("severity",""), d.get("patient_name",""))
    return jsonify(ok=True)

@app.get("/api/reactions/registry")
@login_required
def api_reactions_registry():
    table=v54_table("reaction_registry")
    return jsonify(rows(f"SELECT * FROM {table} ORDER BY id DESC LIMIT 500"))

@app.post("/api/external/event")
@api_token_required
def api_external_event():
    d=request.json or {}
    table=v54_table("api_events")
    execute(f"INSERT INTO {table}(created_at,source,event_type,payload) VALUES(?,?,?,?)",
            (now(),d.get("source","external"),d.get("event_type",""),json.dumps(d,ensure_ascii=False)))
    return jsonify(ok=True)

@app.get("/api/external/status")
@api_token_required
def api_external_status():
    return jsonify(ok=True, version="V5.5", postgres=IS_POSTGRES, time=now())

@app.get("/api/security/full-audit")
@role_required("admin")
def api_security_full_audit():
    return jsonify(
        audit=rows("SELECT * FROM audit ORDER BY id DESC LIMIT 500"),
        failed=rows("SELECT * FROM login_attempts WHERE ok=0 ORDER BY id DESC LIMIT 200"),
        users=rows("SELECT id,username,role,active,created_at,failed_logins,locked_until FROM users ORDER BY id")
    )

@app.get("/api/backup/encryption-status")
@role_required("admin")
def api_backup_encryption_status():
    return jsonify(ok=True, enabled=bool(BACKUP_ENCRYPTION_KEY), note="V5.4 placeholder: use Render PostgreSQL backups or encrypted external backup worker for full production.")


@app.get("/api/version")
def api_version():
    return jsonify(ok=True, version="V5.5", title="Банк крові V5.9.6")


@app.get("/api/telegram/status")
@role_required("admin","transfusion")
def api_telegram_status():
    return jsonify(
        ok=True,
        enabled=TELEGRAM_ENABLED,
        bot_configured=bool(TELEGRAM_BOT_TOKEN),
        chat_configured=bool(TELEGRAM_CHAT_ID),
        silent_now=telegram_in_silent_time(),
        silent_start=TELEGRAM_SILENT_START,
        silent_end=TELEGRAM_SILENT_END,
        anti_spam_minutes=TELEGRAM_ANTI_SPAM_MINUTES
    )

@app.post("/api/telegram/test")
@role_required("admin","transfusion")
def api_telegram_test():
    u=current_user()
    ok, resp = telegram_send_message(
        f"✅ <b>Тест Telegram</b>\\nСистема: Банк крові\\nКористувач: {u.get('username','')}\\nЧас: {now()}",
        event_type="test",
        force=True
    )
    return jsonify(ok=ok, response=str(resp)[:1000])

@app.get("/api/telegram/logs")
@role_required("admin","transfusion")
def api_telegram_logs():
    table = telegram_table("telegram_logs")
    return jsonify(rows(f"SELECT * FROM {table} ORDER BY id DESC LIMIT 200"))

@app.get("/api/telegram/queue")
@role_required("admin","transfusion")
def api_telegram_queue():
    table = telegram_table("telegram_queue")
    return jsonify(rows(f"SELECT * FROM {table} ORDER BY id DESC LIMIT 200"))

@app.post("/api/telegram/retry")
@role_required("admin","transfusion")
def api_telegram_retry():
    sent = telegram_retry_queue()
    return jsonify(ok=True, sent=sent)


@app.get("/api/health")
def api_health():
    hp=health_payload()
    return jsonify(hp), (200 if hp.get("ok") else 503)

@app.post("/api/backups/nightly-run")
@role_required("admin")
def api_backups_nightly_run():
    try:
        p=make_backup("nightly")
        cleanup_old_backups()
        try: telegram_event_backup(True)
        except Exception: pass
        return jsonify(ok=True, filename=os.path.basename(p))
    except Exception as e:
        return jsonify(ok=False,error=str(e)),500

@app.post("/api/backups/rollback-snapshot")
@role_required("admin")
def api_rollback_snapshot():
    p=make_rollback_snapshot("manual")
    return jsonify(ok=bool(p), filename=os.path.basename(p) if p else "")

@app.get("/api/audit/export/<fmt>")
@role_required("admin")
def api_audit_export(fmt):
    data=rows("SELECT created_at,username,role,action,details,ip,user_agent FROM audit ORDER BY id DESC LIMIT 5000")
    fmt=fmt.lower()
    if fmt=="csv":
        bio=BytesIO()
        header=["created_at","username","role","action","details","ip","user_agent"]
        lines=[",".join(header)]
        for r in data:
            vals=[str(r.get(k,"")).replace('"','""') for k in header]
            lines.append(",".join([f'"{v}"' for v in vals]))
        bio.write("\n".join(lines).encode("utf-8-sig")); bio.seek(0)
        return send_file(bio,as_attachment=True,download_name="audit.csv",mimetype="text/csv")
    if fmt=="xlsx":
        wb=Workbook(); ws=wb.active; ws.title="Audit"
        header=["created_at","username","role","action","details","ip","user_agent"]; ws.append(header)
        for r in data: ws.append([r.get(k,"") for k in header])
        bio=BytesIO(); wb.save(bio); bio.seek(0)
        return send_file(bio,as_attachment=True,download_name="audit.xlsx")
    return jsonify(ok=False,error="fmt must be csv or xlsx"),400

@app.post("/api/maintenance/run")
@role_required("admin")
def api_maintenance_run():
    run_db_indexes(); cleanup_old_backups(); nightly_backup_if_due()
    try: telegram_retry_queue()
    except Exception: pass
    return jsonify(ok=True)


@app.post("/api/admin/bootstrap")
def api_admin_bootstrap():
    token = request.headers.get("X-API-Token","")
    if not API_TOKEN or token != API_TOKEN:
        return jsonify(ok=False,error="API token invalid"), 403
    created = ensure_default_admin()
    return jsonify(ok=True, created=created, login="Sepsis", password="1986")


@app.route("/api/admin/bootstrap-browser", methods=["GET","POST"])
def api_admin_bootstrap_browser():
    token = request.headers.get("X-API-Token","") or request.args.get("token","")
    if not API_TOKEN or token != API_TOKEN:
        return jsonify(ok=False,error="API token invalid"), 403
    created = ensure_default_admin()
    return jsonify(ok=True, created=created, login="Sepsis", password="1986")


@app.get("/api/telegram/me")
@login_required
def api_telegram_me():
    try:
        ensure_telegram_user_columns_safe()
        u=current_user()
        link=telegram_link_url(u)
        return jsonify(ok=True,
            telegram_chat_id=u.get("telegram_chat_id",""),
            telegram_username=u.get("telegram_username",""),
            telegram_enabled=bool(u.get("telegram_enabled")),
            link_url=link,
            bot_username=TELEGRAM_BOT_USERNAME,
            settings={
                "new_requests": int(u.get("telegram_notify_new_requests") or 0),
                "critical": int(u.get("telegram_notify_critical") or 0),
                "expiring": int(u.get("telegram_notify_expiring") or 0),
                "reactions": int(u.get("telegram_notify_reactions") or 0),
                "backups": int(u.get("telegram_notify_backups") or 0)
            })
    except Exception as e:
        return jsonify(ok=False, error=f"Telegram me error: {str(e)}"), 500

@app.post("/api/telegram/me/settings")
@login_required
def api_telegram_me_settings():
    try:
        ensure_telegram_user_columns_safe()
        u=current_user()
        d=request.json or {}
        execute("""UPDATE users SET telegram_enabled=?, telegram_notify_new_requests=?, telegram_notify_critical=?,
                   telegram_notify_expiring=?, telegram_notify_reactions=?, telegram_notify_backups=? WHERE id=?""",
                (1 if d.get("telegram_enabled") else 0,
                 1 if d.get("new_requests") else 0,
                 1 if d.get("critical") else 0,
                 1 if d.get("expiring") else 0,
                 1 if d.get("reactions") else 0,
                 1 if d.get("backups") else 0,
                 u["id"]))
        return jsonify(ok=True)
    except Exception as e:
        return jsonify(ok=False, error=f"Telegram settings error: {str(e)}"), 500

@app.post("/api/telegram/me/test")
@login_required
def api_telegram_me_test():
    u=current_user()
    ok, resp = telegram_send_to_user(u["id"], f"✅ Тест персонального Telegram для {u.get('full_name') or u.get('username')}", "test", force=True)
    return jsonify(ok=ok, response=str(resp)[:1000])

@app.route("/telegram/webhook", methods=["GET","POST"])
def telegram_webhook():
    if request.method == "GET":
        return jsonify(ok=True, info="Telegram webhook endpoint active")
    update = request.json or {}
    result = telegram_process_update(update)
    return jsonify(ok=True, result=result)

@app.post("/api/telegram/poll")
@role_required("admin","transfusion")
def api_telegram_poll():
    if not TELEGRAM_BOT_TOKEN:
        return jsonify(ok=False,error="TELEGRAM_BOT_TOKEN missing"), 400
    try:
        import urllib.request, json as _json
        url=f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/getUpdates"
        with urllib.request.urlopen(url, timeout=8) as resp:
            data=_json.loads(resp.read().decode("utf-8","ignore"))
        count=0
        for upd in data.get("result",[]):
            telegram_process_update(upd)
            count += 1
        return jsonify(ok=True, processed=count)
    except Exception as e:
        return jsonify(ok=False,error=str(e)), 500


def ensure_telegram_user_columns_safe():
    try:
        cols = [
            ("telegram_chat_id","TEXT"),
            ("telegram_username","TEXT"),
            ("telegram_enabled","INTEGER"),
            ("telegram_notify_new_requests","INTEGER"),
            ("telegram_notify_critical","INTEGER"),
            ("telegram_notify_expiring","INTEGER"),
            ("telegram_notify_reactions","INTEGER"),
            ("telegram_notify_backups","INTEGER"),
        ]
        for name, typ in cols:
            try:
                execute(f"ALTER TABLE users ADD COLUMN {name} {typ}")
            except Exception:
                pass
        for name, val in {
            "telegram_enabled":0,
            "telegram_notify_new_requests":1,
            "telegram_notify_critical":1,
            "telegram_notify_expiring":1,
            "telegram_notify_reactions":1,
            "telegram_notify_backups":0,
        }.items():
            try:
                execute(f"UPDATE users SET {name}=? WHERE {name} IS NULL", (val,))
            except Exception:
                pass
        return True
    except Exception as e:
        try: print("TELEGRAM_SAFE_MIGRATION_ERROR:", e)
        except Exception: pass
        return False

def safe_startup_check():
    errors=[]
    for fn_name in ["ensure_telegram_user_columns_safe","ensure_default_admin","run_db_indexes"]:
        try:
            fn=globals().get(fn_name)
            if fn: fn()
        except Exception as e:
            errors.append(fn_name + ":" + str(e))
    if errors:
        try: print("SAFE_STARTUP_ERRORS:", " | ".join(errors))
        except Exception: pass
    try:
        ensure_traceability_tables()
    except Exception as e:
        errors.append('traceability:' + str(e))
    try:
        ensure_v59_tables()
    except Exception as e:
        errors.append('v59:' + str(e))
    return errors


# V592_LOGIN_ATTEMPTS_MIGRATION_MARKER: ALTER TABLE login_attempts ADD COLUMN ip_address

def ensure_login_attempts_columns_v592():
    try:
        execute("""CREATE TABLE IF NOT EXISTS login_attempts(
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            created_at TEXT,
            username TEXT,
            ip_address TEXT,
            ok INTEGER DEFAULT 0,
            user_agent TEXT
        )""")
    except Exception:
        pass
    for col, typ in [
        ("created_at","TEXT"),
        ("username","TEXT"),
        ("ip_address","TEXT"),
        ("ok","INTEGER DEFAULT 0"),
        ("user_agent","TEXT")
    ]:
        try:
            execute(f"ALTER TABLE login_attempts ADD COLUMN {col} {typ}")
        except Exception:
            db_rollback_safe()
            pass
    return True

@app.get("/api/health-debug")
def api_health_debug():
    out={"ok":False,"version":"V5.9.3"}
    try:
        out["db_select"]=row("SELECT 1 AS ok")
        out["migrations"]=v593_fix_all_known_migrations()
        out["admins"]=len(rows("SELECT id FROM users WHERE role='admin' AND active=1"))
        out["ok"]=True
    except Exception as e:
        out["error"]=str(e)
    return jsonify(out), (200 if out.get("ok") else 500)

@app.errorhandler(500)
def v572_error_page(e):
    try: print("V572_500:", e)
    except Exception: pass
    return render_template("login.html", error="Помилка сервера. Відкрий /api/health-debug або Render Logs."), 500


# ================= V5.8.1 TRACEABILITY CORE =================
def ensure_traceability_tables():
    try:
        execute("""CREATE TABLE IF NOT EXISTS incompatibility_log(
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            created_at TEXT,
            request_id INTEGER,
            patient_name TEXT,
            patient_group TEXT,
            patient_rh TEXT,
            donor_group TEXT,
            donor_rh TEXT,
            component TEXT,
            reason TEXT,
            override_used INTEGER DEFAULT 0,
            issued_by TEXT,
            workstation TEXT,
            ip_address TEXT,
            notes TEXT
        )""")
    except Exception:
        pass
    try:
        execute("""CREATE TABLE IF NOT EXISTS package_traceability(
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            package_code TEXT,
            action_type TEXT,
            patient_name TEXT,
            request_id INTEGER,
            user_name TEXT,
            department TEXT,
            created_at TEXT,
            notes TEXT
        )""")
    except Exception:
        pass
    return True

def _v581_user_name():
    try:
        return current_user().get("username","")
    except Exception:
        return "system"

def log_traceability(package_code, action_type, patient_name="", request_id=None, department="", notes=""):
    ensure_traceability_tables()
    try:
        execute("""INSERT INTO package_traceability(package_code,action_type,patient_name,request_id,user_name,department,created_at,notes)
                   VALUES(?,?,?,?,?,?,?,?)""",
                (package_code or "", action_type or "", patient_name or "", request_id, _v581_user_name(), department or "", now(), notes or ""))
        return True
    except Exception as e:
        try: print("TRACEABILITY_LOG_ERROR:", e)
        except Exception: pass
        return False

def log_incompatibility(request_id, req, donor_group, donor_rh, component, reason, override_used=0, notes=""):
    ensure_traceability_tables()
    try:
        execute("""INSERT INTO incompatibility_log(created_at,request_id,patient_name,patient_group,patient_rh,donor_group,donor_rh,component,reason,override_used,issued_by,workstation,ip_address,notes)
                   VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (now(), request_id, req.get("patient_name",""), req.get("patient_group",""), req.get("patient_rh",""),
                 donor_group or "", donor_rh or "", component or req.get("component",""), reason or "", 1 if override_used else 0,
                 _v581_user_name(), request.headers.get("User-Agent","")[:500], request.remote_addr or "", notes or ""))
        try:
            telegram_broadcast_roles(
                f"🔴 <b>НЕСУМІСНІСТЬ</b>\nПацієнт: {req.get('patient_name','')}\nКомпонент: {component or req.get('component','')}\nПацієнт: {req.get('patient_group','')} {req.get('patient_rh','')}\nДонор: {donor_group} {donor_rh}\nПричина: {reason}",
                ("admin","transfusion"), "critical", True
            )
        except Exception:
            db_rollback_safe()
            pass
        return True
    except Exception as e:
        try: print("INCOMPATIBILITY_LOG_ERROR:", e)
        except Exception: pass
        return False

def barcode_find_package(code):
    code = str(code or "").strip()
    if not code:
        return None
    try:
        return row("SELECT * FROM stock_entries WHERE qr_code=? OR pack_no=? OR series=? ORDER BY id DESC LIMIT 1", (code, code, code))
    except Exception:
        return None

@app.get("/api/incompatibility")
@role_required("admin","transfusion")
def api_incompatibility_list():
    ensure_traceability_tables()
    return jsonify(rows("SELECT * FROM incompatibility_log ORDER BY id DESC LIMIT 500"))

@app.get("/api/traceability/package/<code>")
@login_required
def api_traceability_package(code):
    ensure_traceability_tables()
    return jsonify(rows("SELECT * FROM package_traceability WHERE package_code=? ORDER BY id DESC LIMIT 200", (code,)))

@app.post("/api/traceability/log")
@login_required
def api_traceability_log():
    d = request.json or {}
    ok = log_traceability(d.get("package_code") or d.get("qr_code"), d.get("action_type"), d.get("patient_name",""), d.get("request_id"), d.get("department",""), d.get("notes",""))
    return jsonify(ok=ok)

@app.post("/api/barcode/scan")
@login_required
def api_barcode_scan():
    d = request.json or {}
    code = (d.get("code") or d.get("barcode") or d.get("qr_code") or "").strip()
    if not code:
        return jsonify(ok=False,error="Немає QR/штрихкоду"), 400
    pkg = barcode_find_package(code)
    if not pkg:
        return jsonify(ok=False,error="Пакет не знайдено", code=code), 404
    log_traceability(code, "scan", pkg.get("patient_name",""), None, "", "barcode scan")
    return jsonify(ok=True, package=pkg, code=code)

@app.post("/api/barcode/issue-check")
@login_required
def api_barcode_issue_check():
    d = request.json or {}
    request_id = int(d.get("request_id") or 0)
    code = (d.get("code") or d.get("barcode") or d.get("qr_code") or "").strip()
    req = row("SELECT * FROM requests WHERE id=?", (request_id,))
    pkg = barcode_find_package(code)
    if not req:
        return jsonify(ok=False,error="Вимогу не знайдено"), 404
    if not pkg:
        return jsonify(ok=False,error="Пакет не знайдено"), 404
    donor_group = pkg.get("donor_group","")
    donor_rh = pkg.get("donor_rh","")
    reasons = []
    try:
        if not abo_compatible(donor_group, req.get("patient_group","")):
            reasons.append("ABO несумісність")
    except Exception:
        if donor_group != req.get("patient_group",""):
            reasons.append("ABO несумісність")
    if donor_rh and req.get("patient_rh") and donor_rh != req.get("patient_rh"):
        reasons.append("Rh відмінність")
    try:
        if pkg.get("expiry") and pkg.get("expiry") < datetime.now().strftime("%Y-%m-%d"):
            reasons.append("Пакет прострочений")
    except Exception:
        pass
    if reasons:
        reason = "; ".join(reasons)
        log_incompatibility(request_id, req, donor_group, donor_rh, pkg.get("component",""), reason, 0, "barcode issue-check")
        return jsonify(ok=False, compatible=False, red_alert=True, reason=reason, request=req, package=pkg)
    log_traceability(code, "issue_check_ok", req.get("patient_name",""), request_id, req.get("department",""), "compatible")
    return jsonify(ok=True, compatible=True, reason="Сумісно", request=req, package=pkg)

@app.post("/api/barcode/issue")
@role_required("admin","transfusion")
def api_barcode_issue():
    d = request.json or {}
    request_id = int(d.get("request_id") or 0)
    code = (d.get("code") or d.get("barcode") or d.get("qr_code") or "").strip()
    req = row("SELECT * FROM requests WHERE id=?", (request_id,))
    pkg = barcode_find_package(code)
    if not req or not pkg:
        return jsonify(ok=False,error="Не знайдено вимогу або пакет"), 404
    donor_group = pkg.get("donor_group","")
    donor_rh = pkg.get("donor_rh","")
    reasons = []
    try:
        if not abo_compatible(donor_group, req.get("patient_group","")):
            reasons.append("ABO несумісність")
    except Exception:
        if donor_group != req.get("patient_group",""):
            reasons.append("ABO несумісність")
    if donor_rh and req.get("patient_rh") and donor_rh != req.get("patient_rh"):
        reasons.append("Rh відмінність")
    if reasons and not d.get("override"):
        reason = "; ".join(reasons)
        log_incompatibility(request_id, req, donor_group, donor_rh, pkg.get("component",""), reason, 0, "barcode issue")
        return jsonify(ok=False, compatible=False, red_alert=True, reason=reason)
    execute("UPDATE requests SET status=?, donor_group=?, donor_rh=?, pack_no=?, series=?, expiry=? WHERE id=?",
            ("видано", donor_group, donor_rh, pkg.get("pack_no",""), pkg.get("series",""), pkg.get("expiry",""), request_id))
    log_traceability(code, "issued", req.get("patient_name",""), request_id, req.get("department",""), "barcode issue")
    audit("barcode_issue", f"request={request_id}; barcode={code}")
    return jsonify(ok=True, issued=True)
# ================= END V5.8.1 TRACEABILITY CORE =================


# ================= V5.9 PRODUCTION TRACEABILITY SUITE =================
def ensure_v59_tables():
    try:
        ensure_traceability_tables()
    except Exception:
        pass
    for sql in [
        """CREATE TABLE IF NOT EXISTS fridge_temperature_log(
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            fridge_name TEXT,
            temperature REAL,
            entered_by TEXT,
            created_at TEXT,
            alert_triggered INTEGER DEFAULT 0,
            notes TEXT
        )""",
        """CREATE TABLE IF NOT EXISTS component_writeoffs(
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            created_at TEXT,
            package_code TEXT,
            component TEXT,
            amount REAL,
            reason TEXT,
            written_by TEXT,
            notes TEXT
        )""",
        """CREATE TABLE IF NOT EXISTS daily_reports(
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            created_at TEXT,
            report_type TEXT,
            report_text TEXT,
            sent_telegram INTEGER DEFAULT 0
        )""",
        """CREATE TABLE IF NOT EXISTS login_attempts(
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            created_at TEXT,
            username TEXT,
            ip_address TEXT,
            ok INTEGER DEFAULT 0,
            user_agent TEXT
        )""",
        """CREATE TABLE IF NOT EXISTS device_sessions(
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            created_at TEXT,
            username TEXT,
            ip_address TEXT,
            user_agent TEXT,
            event_type TEXT
        )"""
    ]:
        try: execute(sql)
        except Exception: pass
    return True

def v59_today():
    return datetime.now().strftime("%Y-%m-%d")

def v59_scalar(sql, params=()):
    try:
        r=row(sql, params)
        if not r: return 0
        return list(r.values())[0]
    except Exception:
        return 0

def v59_dashboard_stats():
    ensure_v59_tables()
    today=v59_today()
    return {
        "issued_today": v59_scalar("SELECT COUNT(*) FROM requests WHERE status LIKE ? AND created_at LIKE ?", ("%видано%", today+"%")),
        "used_today": v59_scalar("SELECT COUNT(*) FROM requests WHERE status LIKE ? AND created_at LIKE ?", ("%використ%", today+"%")),
        "writeoffs_today": v59_scalar("SELECT COUNT(*) FROM component_writeoffs WHERE created_at LIKE ?", (today+"%",)),
        "incompat_today": v59_scalar("SELECT COUNT(*) FROM incompatibility_log WHERE created_at LIKE ?", (today+"%",)),
        "active_requests": v59_scalar("SELECT COUNT(*) FROM requests WHERE status NOT LIKE ? AND status NOT LIKE ? AND status NOT LIKE ?", ("%відмов%", "%списан%", "%використ%")),
        "stock_items": v59_scalar("SELECT COUNT(*) FROM stock_entries"),
        "temperature_alerts_today": v59_scalar("SELECT COUNT(*) FROM fridge_temperature_log WHERE alert_triggered=1 AND created_at LIKE ?", (today+"%",))
    }

def v59_daily_report_text():
    s=v59_dashboard_stats()
    lines=[
        "📊 <b>Добовий звіт банку крові</b>",
        f"Дата: {v59_today()}",
        f"📦 Записів складу: {s.get('stock_items',0)}",
        f"📋 Активні вимоги: {s.get('active_requests',0)}",
        f"✅ Видано сьогодні: {s.get('issued_today',0)}",
        f"♻️ Списано сьогодні: {s.get('writeoffs_today',0)}",
        f"🔴 Несумісності сьогодні: {s.get('incompat_today',0)}",
        f"🌡️ Температурні тривоги: {s.get('temperature_alerts_today',0)}",
    ]
    try:
        al=get_alerts_data()
        lines.append(f"⚠️ Критичні залишки: {len(al.get('low',[]))}")
        lines.append(f"⏰ Близькі терміни: {len(al.get('expiry',[]))}")
    except Exception:
        pass
    return "\n".join(lines)

@app.get("/api/dashboard/pro")
@login_required
def api_dashboard_pro():
    return jsonify(v59_dashboard_stats())

@app.post("/api/temperature/add")
@login_required
def api_temperature_add():
    ensure_v59_tables()
    d=request.json or {}
    fridge=(d.get("fridge_name") or d.get("fridge") or "").strip()
    if not fridge:
        return jsonify(ok=False,error="Вкажіть холодильник"),400
    try:
        temp=float(str(d.get("temperature")).replace(",","."))
    except Exception:
        return jsonify(ok=False,error="Температура має бути числом"),400
    alert=1 if temp>6 or temp< -35 else 0
    execute("INSERT INTO fridge_temperature_log(fridge_name,temperature,entered_by,created_at,alert_triggered,notes) VALUES(?,?,?,?,?,?)",
            (fridge,temp,_v581_user_name(),now(),alert,d.get("notes","")))
    if alert:
        try:
            telegram_broadcast_roles(f"🌡️ <b>Температурна тривога</b>\n{fridge}: {temp}°C", ("admin","transfusion"), "critical", True)
        except Exception: pass
    return jsonify(ok=True, alert=bool(alert))

@app.get("/api/temperature")
@login_required
def api_temperature_list():
    ensure_v59_tables()
    return jsonify(rows("SELECT * FROM fridge_temperature_log ORDER BY id DESC LIMIT 500"))

@app.post("/api/writeoff")
@role_required("admin","transfusion")
def api_writeoff_component():
    ensure_v59_tables()
    d=request.json or {}
    code=(d.get("package_code") or d.get("qr_code") or "").strip()
    reason=(d.get("reason") or "").strip()
    if not code: return jsonify(ok=False,error="Вкажіть код пакета"),400
    if not reason: return jsonify(ok=False,error="Вкажіть причину списання"),400
    pkg=barcode_find_package(code)
    component=pkg.get("component","") if pkg else d.get("component","")
    amount=float(pkg.get("amount") or d.get("amount") or 0) if (pkg or d.get("amount")) else 0
    execute("INSERT INTO component_writeoffs(created_at,package_code,component,amount,reason,written_by,notes) VALUES(?,?,?,?,?,?,?)",
            (now(),code,component,amount,reason,_v581_user_name(),d.get("notes","")))
    try:
        execute("UPDATE stock_entries SET amount=0,note=? WHERE qr_code=? OR pack_no=? OR series=?", (f"Списано: {reason}",code,code,code))
    except Exception: pass
    log_traceability(code,"writeoff","",None,"",reason)
    audit("component_writeoff", f"{code}: {reason}")
    return jsonify(ok=True)

@app.get("/api/writeoffs")
@role_required("admin","transfusion")
def api_writeoffs():
    ensure_v59_tables()
    return jsonify(rows("SELECT * FROM component_writeoffs ORDER BY id DESC LIMIT 500"))

@app.get("/api/traceability/search")
@login_required
def api_traceability_search():
    ensure_v59_tables()
    q=(request.args.get("q") or "").strip()
    if not q: return jsonify([])
    like="%"+q+"%"
    return jsonify(rows("""SELECT * FROM package_traceability
                           WHERE package_code LIKE ? OR patient_name LIKE ? OR notes LIKE ?
                           ORDER BY id DESC LIMIT 300""",(like,like,like)))

@app.post("/api/telegram/daily-report")
@role_required("admin","transfusion")
def api_telegram_daily_report():
    ensure_v59_tables()
    text=v59_daily_report_text()
    sent=0
    try:
        sent=telegram_broadcast_roles(text,("admin","transfusion"),"report",True)
    except Exception:
        sent=0
    execute("INSERT INTO daily_reports(created_at,report_type,report_text,sent_telegram) VALUES(?,?,?,?)",
            (now(),"daily",text,1 if sent else 0))
    return jsonify(ok=True, sent=sent, report=text)

@app.get("/api/daily-reports")
@role_required("admin","transfusion")
def api_daily_reports():
    ensure_v59_tables()
    return jsonify(rows("SELECT * FROM daily_reports ORDER BY id DESC LIMIT 100"))

@app.post("/api/security/login-attempt")
def api_security_login_attempt():
    try:
        ensure_login_attempts_columns_v592()
        d=request.json or {}
        execute("INSERT INTO login_attempts(created_at,username,ip_address,ok,user_agent) VALUES(?,?,?,?,?)",
                (now(),str(d.get("username",""))[:120],request.remote_addr or "",1 if d.get("ok") else 0,request.headers.get("User-Agent","")[:500]))
        return jsonify(ok=True)
    except Exception as e:
        return jsonify(ok=False,error=f"login attempt log error: {str(e)}"), 500

@app.get("/api/security/login-attempts")
@role_required("admin")
def api_security_login_attempts():
    ensure_v59_tables()
    return jsonify(rows("SELECT * FROM login_attempts ORDER BY id DESC LIMIT 300"))
# ================= END V5.9 PRODUCTION TRACEABILITY SUITE =================


@app.get("/api/security/login-attempt-test")
def api_security_login_attempt_test():
    try:
        ensure_login_attempts_columns_v592()
        return jsonify(ok=True, count=len(rows("SELECT id FROM login_attempts LIMIT 5")))
    except Exception as e:
        return jsonify(ok=False,error=str(e)),500


# ================= V5.9.3 EMERGENCY HEALTH / DB FIX =================
def v593_safe_exec(sql, params=()):
    try:
        execute(sql, params)
        return True, ""
    except Exception as e:
        db_rollback_safe()
        return False, str(e)

def v593_fix_all_known_migrations():
    """
    Safe public emergency migration for old Render PostgreSQL/SQLite schemas.
    Does not require login. Does not expose secrets.
    """
    errors=[]
    try:
        init_db()
    except Exception as e:
        errors.append("init_db:"+str(e))

    for fn_name in [
        "ensure_telegram_user_columns_safe",
        "ensure_traceability_tables",
        "ensure_v59_tables",
        "ensure_login_attempts_columns_v592",
        "ensure_default_admin"
    ]:
        try:
            fn=globals().get(fn_name)
            if fn:
                fn()
        except Exception as e:
            errors.append(fn_name+":"+str(e))

    # Extra defensive columns for known tables
    table_cols = {
        "login_attempts": [
            ("created_at","TEXT"),("username","TEXT"),("ip_address","TEXT"),("ok","INTEGER"),("user_agent","TEXT")
        ],
        "users": [
            ("telegram_chat_id","TEXT"),("telegram_username","TEXT"),("telegram_enabled","INTEGER"),
            ("telegram_notify_new_requests","INTEGER"),("telegram_notify_critical","INTEGER"),
            ("telegram_notify_expiring","INTEGER"),("telegram_notify_reactions","INTEGER"),("telegram_notify_backups","INTEGER")
        ],
        "fridge_temperature_log": [
            ("fridge_name","TEXT"),("temperature","REAL"),("entered_by","TEXT"),("created_at","TEXT"),("alert_triggered","INTEGER"),("notes","TEXT")
        ],
        "component_writeoffs": [
            ("created_at","TEXT"),("package_code","TEXT"),("component","TEXT"),("amount","REAL"),("reason","TEXT"),("written_by","TEXT"),("notes","TEXT")
        ],
        "daily_reports": [
            ("created_at","TEXT"),("report_type","TEXT"),("report_text","TEXT"),("sent_telegram","INTEGER")
        ],
        "incompatibility_log": [
            ("created_at","TEXT"),("request_id","INTEGER"),("patient_name","TEXT"),("patient_group","TEXT"),("patient_rh","TEXT"),
            ("donor_group","TEXT"),("donor_rh","TEXT"),("component","TEXT"),("reason","TEXT"),("override_used","INTEGER"),
            ("issued_by","TEXT"),("workstation","TEXT"),("ip_address","TEXT"),("notes","TEXT")
        ],
        "package_traceability": [
            ("package_code","TEXT"),("action_type","TEXT"),("patient_name","TEXT"),("request_id","INTEGER"),("user_name","TEXT"),
            ("department","TEXT"),("created_at","TEXT"),("notes","TEXT")
        ]
    }
    for table, cols in table_cols.items():
        for col, typ in cols:
            ok, err = v593_safe_exec(f"ALTER TABLE {table} ADD COLUMN {col} {typ}")
            # duplicate column is expected, ignore all ALTER errors
            pass

    try:
        safe_startup_check()
    except Exception as e:
        errors.append("safe_startup_check:"+str(e))

    return errors

@app.get("/api/public-health")
def api_public_health_v593():
    out={"ok":False,"version":"V5.9.3"}
    try:
        out["db_select"]=row("SELECT 1 AS ok")
        out["migrations"]=v593_fix_all_known_migrations()
        out["admins"]=len(rows("SELECT id FROM users WHERE role='admin' AND active=1"))
        out["ok"]=True
    except Exception as e:
        out["error"]=str(e)
    return jsonify(out), (200 if out.get("ok") else 500)

@app.get("/api/emergency-db-fix")
def api_emergency_db_fix_v593():
    out={"ok":False,"version":"V5.9.3"}
    try:
        out["migrations"]=v593_fix_all_known_migrations()
        out["admins"]=len(rows("SELECT id FROM users WHERE role='admin' AND active=1"))
        out["ok"]=True
    except Exception as e:
        out["error"]=str(e)
    return jsonify(out), (200 if out.get("ok") else 500)
# ================= END V5.9.3 EMERGENCY HEALTH / DB FIX =================


@app.get("/api/tx-reset")
def api_tx_reset_v594():
    db_rollback_safe()
    return jsonify(ok=True, version="V5.9.5", message="transaction rolled back")


@app.get("/api/ui/role-config")
@login_required
def api_ui_role_config():
    u=current_user()
    role=u.get("role","")
    if role in ("admin","transfusion"):
        allowed=["dashboard","stock","requests","reports","users","telegram","pwa","monitor","audit","maintenance","barcode","traceability","incompat","dashboardPro","temperature","writeoff","dailyReport"]
    elif role=="doctor":
        allowed=["dashboard","requests","patients","history","telegram","pwa"]
    elif role=="nurse":
        allowed=["dashboard","requests","stock","barcode","traceability","temperature","telegram","pwa"]
    else:
        allowed=["dashboard","requests"]
    return jsonify(ok=True, role=role, allowed=allowed)

@app.get("/manifest.json")
def manifest():
    return send_file("static/manifest.json", mimetype="application/manifest+json")

@app.get("/service-worker.js")
def sw():
    return send_file("static/service-worker.js", mimetype="application/javascript")

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT",5000)), debug=DEBUG)
