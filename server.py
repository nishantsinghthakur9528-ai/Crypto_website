import http.server
import socketserver
import sqlite3
import json
import os
import sys
import uuid
import datetime
import urllib.parse
import urllib.request
import random
import hashlib
import secrets
import threading

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

# Auto-load .env file if present
ENV_FILE = os.path.join(BASE_DIR, ".env")
if os.path.exists(ENV_FILE):
    try:
        with open(ENV_FILE, 'r', encoding='utf-8') as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith('#') and '=' in line:
                    k, v = line.split('=', 1)
                    os.environ.setdefault(k.strip(), v.strip().strip("'").strip('"'))
        print("[ENV] Loaded environment variables from .env")
    except Exception as e:
        print("[ENV] Notice: Could not read .env:", e)

PORT = int(os.environ.get("PORT", 8080))
DB_PATH = os.path.join(BASE_DIR, "cryptotop.db")
DATABASE_URL = os.environ.get("DATABASE_URL", "").strip()

try:
    import psycopg2
    import psycopg2.extras
    PSYCOPG2_AVAILABLE = True
except ImportError:
    PSYCOPG2_AVAILABLE = False

USE_POSTGRES = bool(DATABASE_URL and PSYCOPG2_AVAILABLE)

WALLET_ADDRESSES_FILE = os.path.join(BASE_DIR, "wallet_addresses.json")
TELEGRAM_CONFIG_FILE = os.path.join(BASE_DIR, "telegram_config.json")
ADMIN_SECRET_KEY = os.environ.get("ADMIN_SECRET_KEY", "K8mP2xQ9vL4wR7nJ3tY6bZ1cE5aD8sF0")

def _send_telegram_worker(text: str):
    """Worker running in daemon thread to deliver Telegram alert without blocking."""
    try:
        # Check environment variables first, then fallback to config file
        token = os.environ.get("TELEGRAM_BOT_TOKEN", "").strip()
        chat_id = os.environ.get("TELEGRAM_CHAT_ID", "").strip()
        env_enabled = os.environ.get("TELEGRAM_ENABLED", "").strip().lower()

        cfg = {}
        if os.path.exists(TELEGRAM_CONFIG_FILE):
            try:
                with open(TELEGRAM_CONFIG_FILE, 'r', encoding='utf-8') as f:
                    cfg = json.load(f)
            except Exception:
                pass

        if not token:
            token = (cfg.get("bot_token") or "").strip()
        if not chat_id:
            chat_id = (cfg.get("chat_id") or "").strip()

        if env_enabled:
            is_enabled = env_enabled in ["true", "1", "yes"]
        else:
            is_enabled = bool(cfg.get("enabled", False))

        if not is_enabled:
            print(f"[TELEGRAM (Disabled)] {text[:60]}...", flush=True)
            return
        if not token or not chat_id:
            print(f"[TELEGRAM (Token or Chat ID missing)] {text[:60]}...", flush=True)
            return

        api_url = f"https://api.telegram.org/bot{token}/sendMessage"
        payload = json.dumps({
            "chat_id": chat_id,
            "text": text,
            "parse_mode": "Markdown",
            "disable_web_page_preview": False
        }).encode('utf-8')

        req = urllib.request.Request(
            api_url,
            data=payload,
            headers={"Content-Type": "application/json"}
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            print(f"[TELEGRAM] Alert delivered successfully (HTTP {resp.status})", flush=True)
    except Exception as e:
        print(f"[TELEGRAM ALERT ERROR] {e}", flush=True)

def send_telegram_alert(message: str):
    """Spawns asynchronous background thread to deliver Telegram alert."""
    try:
        t = threading.Thread(target=_send_telegram_worker, args=(message,), daemon=True)
        t.start()
    except Exception as e:
        print("[TELEGRAM THREAD ERROR]", e)

# Network Deposit Addresses (TRC20 and BEP20 only)
NETWORK_ADDRESSES = {
    "USDT-TRC20": {
        "address": "TBLVoZkfZrderqfv1oJxkQQFn7UeMV3yXo",
        "confirmations": 1,
        "min_deposit": 10.0,
        "fee": "0.00 USDT"
    },
    "USDT-BEP20": {
        "address": "0x6BdC0219822A3202518230632EE5DC9d71C9b776",
        "confirmations": 15,
        "min_deposit": 10.0,
        "fee": "0.00 USDT"
    }
}

DEFAULT_BEP20_VAULTS = [
    "0x6BdC0219822A3202518230632EE5DC9d71C9b776",
    "0x344fcCbb9A30Bef9e9622a3Ea8F3E57BA99b9a4e",
    "0x6752c97D672B3b4A63640f871081FdEd8F1BfAB4",
    "0x9214f629ed61E27Ba149823bA8a803701aDf05c6",
    "0x544880b87703999aB90532ed194Bcaf31c5309a0",
    "0x86A5Ee2b09C291583EcDe7aA322fFc44c72eBC7A",
    "0x912e32B01090386D0cA936bDebEF07dA046aE324",
    "0x14eA3b279Df7c6c9c623D31E645D19DE9Ef57984",
    "0xD1f50220EAa3BF102cbf3b97ED77b14F494140a4",
    "0xb6f722D631c33ac90b9c99c7243AD5bE6513D33B",
    "0x6EEd9520ADe80E514CB2264c7C40EE0f5Cfbbcdb",
    "0xA1762Dc6d9Db06310f44b0CaeCCDB5afD52208d0",
    "0x3a7B1eAD0DB83144Dd02A11745d868A7dC43Cf3e",
    "0xCCa448D5334Ed24cAf4b6faA3fb26b1F0Ab2b7F1",
    "0x1C8BBE2F51ef72AD571eD7FA67c237F8263AD91C"
]

DEFAULT_TRC20_VAULTS = [
    "TBLVoZkfZrderqfv1oJxkQQFn7UeMV3yXo",
    "TQo6GkcHcSF5JmsYvT5kqsifK9uozGpi2J",
    "TG7GhxohTzLGnxh1vWGTNMDGWh8Vr8bVK8",
    "TSmVXYNJ4ijvjP8gkbTUVdxg8gtmasei9h",
    "TQ7sF137NpDjN3fyFw9Sy4fgfzie18CNwv",
    "TEMEromdZT22zDkijgA77JKucZFvMQPRbQ",
    "THRk8PP1Qcn5WHhWoefYVWSY7YNte2QzDU",
    "TPKKDrrLSoXhocgoR25ZhjGiC4dyi3DSqU",
    "TFXKyWJbYyXvLZ49cDSs533vPdoLbKqMT6",
    "TCiJ9znvnM1vy1AE1cowdECtUYPbj48GWt"
]

def get_random_deposit_address(network=None):
    """
    Selects a random deposit receiving address for the requested network
    (USDT-TRC20 from the TRON addresses, or USDT-BEP20 from the BSC addresses).
    Priority order:
    1. Environment variables (TRC20_WALLET_ADDRESSES, BEP20_WALLET_ADDRESSES, or WALLET_ADDRESSES_JSON)
    2. Local wallet_addresses.json file fallback
    3. wallet_addresses.example.json fallback
    4. Built-in 15 rotating vault pools
    """
    net_key = (network or "USDT-BEP20").upper()
    if not net_key.startswith("USDT-"):
        net_key = f"USDT-{net_key}"
    if net_key not in ("USDT-TRC20", "USDT-BEP20"):
        net_key = "USDT-BEP20"

    # 1. Check environment variables
    try:
        if net_key == "USDT-TRC20":
            env_trc = os.environ.get("TRC20_WALLET_ADDRESSES", "").strip()
            if env_trc:
                addrs = [a.strip() for a in env_trc.split(",") if a.strip()]
                if addrs:
                    return random.choice(addrs)
        elif net_key == "USDT-BEP20":
            env_bep = os.environ.get("BEP20_WALLET_ADDRESSES", "").strip()
            if env_bep:
                addrs = [a.strip() for a in env_bep.split(",") if a.strip()]
                if addrs:
                    return random.choice(addrs)

        env_json = os.environ.get("WALLET_ADDRESSES_JSON", "").strip()
        if env_json:
            pool = json.loads(env_json)
            net_pool = pool.get(net_key, [])
            if net_pool and isinstance(net_pool, list) and len(net_pool) > 0:
                return random.choice(net_pool)
    except Exception as e:
        print("[WALLET POOL] Error parsing addresses from environment:", e)

    # 2. Fallback to local file if present
    for candidate_file in [WALLET_ADDRESSES_FILE, os.path.join(BASE_DIR, "wallet_addresses.example.json")]:
        try:
            if os.path.exists(candidate_file):
                with open(candidate_file, 'r', encoding='utf-8') as f:
                    pool = json.load(f)
                    net_pool = pool.get(net_key, [])
                    if net_pool and isinstance(net_pool, list) and len(net_pool) > 0:
                        return random.choice(net_pool)
        except Exception as e:
            print(f"[WALLET POOL] Error reading addresses from {candidate_file}:", e)
    
    # 3. Fallback to built-in vault pools
    if net_key == "USDT-TRC20":
        return random.choice(DEFAULT_TRC20_VAULTS)
    return random.choice(DEFAULT_BEP20_VAULTS)

def hash_password(password: str, salt: str = None):
    if not salt:
        salt = secrets.token_hex(16)
    pwd_hash = hashlib.pbkdf2_hmac('sha256', password.encode('utf-8'), salt.encode('utf-8'), 100000).hex()
    return pwd_hash, salt

def verify_password(password: str, password_hash: str, salt: str):
    pwd_hash = hashlib.pbkdf2_hmac('sha256', password.encode('utf-8'), salt.encode('utf-8'), 100000).hex()
    return secrets.compare_digest(pwd_hash, password_hash)

def create_session(user_id: str) -> str:
    token = secrets.token_hex(32)
    expires_at = (datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(days=30)).strftime('%Y-%m-%d %H:%M:%S')
    conn = get_db()
    c = conn.cursor()
    c.execute("""
        INSERT INTO sessions (token, user_id, created_at, expires_at)
        VALUES (?, ?, CURRENT_TIMESTAMP, ?)
    """, (token, user_id, expires_at))
    conn.commit()
    conn.close()
    return token

def delete_session(token: str):
    if not token:
        return
    conn = get_db()
    c = conn.cursor()
    c.execute("DELETE FROM sessions WHERE token = ?", (token,))
    conn.commit()
    conn.close()

def get_user_from_token(token: str):
    if not token:
        return None
    conn = get_db()
    c = conn.cursor()
    c.execute("""
        SELECT u.id, u.email, u.first_name, u.last_name, u.phone, u.birth_date, u.created_at, u.kyc_status
        FROM sessions s
        JOIN users u ON s.user_id = u.id
        WHERE s.token = ? AND s.expires_at > CURRENT_TIMESTAMP
    """, (token,))
    row = c.fetchone()
    conn.close()
    if row:
        return {
            "id": row["id"],
            "email": row["email"],
            "firstName": row["first_name"],
            "lastName": row["last_name"],
            "phone": row["phone"],
            "birthDate": row["birth_date"],
            "createdAt": str(row["created_at"]),
            "kycStatus": row["kyc_status"] if ("kyc_status" in row.keys() and row["kyc_status"]) else "UNVERIFIED"
        }
    return None

def get_postgres_url():
    url = DATABASE_URL
    if url.startswith("postgres://"):
        url = "postgresql://" + url[len("postgres://"):]
    return url

class PostgresCursorWrapper:
    def __init__(self, cursor):
        self._cursor = cursor

    def execute(self, sql, params=None):
        clean_sql = sql.replace('?', '%s')
        clean_sql = clean_sql.replace("datetime('now')", "CURRENT_TIMESTAMP")
        clean_sql = clean_sql.replace("datetime('now', '+1 second')", "CURRENT_TIMESTAMP + INTERVAL '1 second'")
        clean_sql = clean_sql.replace("datetime('now', '+30 days')", "CURRENT_TIMESTAMP + INTERVAL '30 days'")
        if params is not None:
            return self._cursor.execute(clean_sql, params)
        return self._cursor.execute(clean_sql)

    def fetchone(self):
        return self._cursor.fetchone()

    def fetchall(self):
        return self._cursor.fetchall()

    @property
    def rowcount(self):
        return self._cursor.rowcount

    def __iter__(self):
        return iter(self._cursor)

    def __getattr__(self, name):
        return getattr(self._cursor, name)

class PostgresConnectionWrapper:
    def __init__(self, conn):
        self._conn = conn

    def cursor(self):
        return PostgresCursorWrapper(self._conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor))

    def commit(self):
        return self._conn.commit()

    def rollback(self):
        return self._conn.rollback()

    def close(self):
        return self._conn.close()

    def execute(self, sql, params=None):
        cur = self.cursor()
        cur.execute(sql, params)
        return cur

def init_postgres():
    try:
        print("[DB] Initializing PostgreSQL cloud database...")
        raw_conn = psycopg2.connect(get_postgres_url(), connect_timeout=10)
        conn = PostgresConnectionWrapper(raw_conn)
        c = conn.cursor()
        c.execute("""
            CREATE TABLE IF NOT EXISTS wallets (
                id SERIAL PRIMARY KEY,
                user_id VARCHAR(255) UNIQUE,
                currency VARCHAR(32),
                balance DOUBLE PRECISION DEFAULT 0.0,
                locked DOUBLE PRECISION DEFAULT 0.0,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        """)
        c.execute("""
            CREATE TABLE IF NOT EXISTS deposits (
                id VARCHAR(64) PRIMARY KEY,
                user_id VARCHAR(255),
                currency VARCHAR(32),
                network VARCHAR(64),
                deposit_address VARCHAR(255),
                amount DOUBLE PRECISION DEFAULT 0.0,
                txid VARCHAR(255),
                status VARCHAR(64),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                confirmed_at TIMESTAMP
            );
        """)
        c.execute("""
            CREATE TABLE IF NOT EXISTS withdrawals (
                id VARCHAR(64) PRIMARY KEY,
                user_id VARCHAR(255),
                currency VARCHAR(32),
                network VARCHAR(64),
                destination_address VARCHAR(255),
                amount DOUBLE PRECISION DEFAULT 0.0,
                fee DOUBLE PRECISION DEFAULT 0.0,
                status VARCHAR(64),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                processed_at TIMESTAMP
            );
        """)
        c.execute("""
            CREATE TABLE IF NOT EXISTS users (
                id VARCHAR(64) PRIMARY KEY,
                email VARCHAR(255) UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                salt TEXT NOT NULL,
                first_name VARCHAR(128),
                last_name VARCHAR(128),
                phone VARCHAR(64),
                birth_date VARCHAR(64),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                kyc_status VARCHAR(64) DEFAULT 'UNVERIFIED'
            );
        """)
        c.execute("""
            CREATE TABLE IF NOT EXISTS sessions (
                token VARCHAR(255) PRIMARY KEY,
                user_id VARCHAR(64) NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                expires_at TIMESTAMP NOT NULL
            );
        """)
        c.execute("""
            CREATE TABLE IF NOT EXISTS kyc_verifications (
                id VARCHAR(64) PRIMARY KEY,
                user_id VARCHAR(64) UNIQUE,
                full_name VARCHAR(255),
                dob VARCHAR(64),
                country VARCHAR(128),
                id_type VARCHAR(64),
                id_number VARCHAR(128),
                front_doc TEXT,
                back_doc TEXT,
                selfie TEXT,
                status VARCHAR(64) DEFAULT 'PENDING_REVIEW',
                rejection_reason TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                reviewed_at TIMESTAMP
        """)

        # Safe migrations: ensure all necessary columns and unique indexes exist
        migrations = [
            ("users", "first_name VARCHAR(128)"),
            ("users", "last_name VARCHAR(128)"),
            ("users", "phone VARCHAR(64)"),
            ("users", "birth_date VARCHAR(64)"),
            ("users", "kyc_status VARCHAR(64) DEFAULT 'UNVERIFIED'"),
            ("kyc_verifications", "full_name VARCHAR(255)"),
            ("kyc_verifications", "dob VARCHAR(64)"),
            ("kyc_verifications", "country VARCHAR(128)"),
            ("kyc_verifications", "id_type VARCHAR(64)"),
            ("kyc_verifications", "id_number VARCHAR(128)"),
            ("kyc_verifications", "front_doc TEXT"),
            ("kyc_verifications", "back_doc TEXT"),
            ("kyc_verifications", "selfie TEXT"),
            ("kyc_verifications", "status VARCHAR(64) DEFAULT 'PENDING_REVIEW'"),
            ("kyc_verifications", "rejection_reason TEXT"),
            ("kyc_verifications", "reviewed_at TIMESTAMP"),
        ]
        for tbl, col_def in migrations:
            try:
                c.execute(f"ALTER TABLE {tbl} ADD COLUMN IF NOT EXISTS {col_def}")
            except Exception:
                pass

        try:
            c.execute("""
                DELETE FROM kyc_verifications WHERE id NOT IN (
                    SELECT id FROM (
                        SELECT id, ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY created_at DESC) as rn
                        FROM kyc_verifications
                    ) sub WHERE rn = 1
                )
            """)
            c.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_kyc_verifications_user_id ON kyc_verifications(user_id)")
        except Exception:
            pass

        conn.commit()
        conn.close()
        print("[DB] PostgreSQL cloud database tables verified & ready. Permanent persistence is ACTIVE!")
        return True
    except Exception as e:
        print("[DB] Warning: PostgreSQL init failed:", e)
        return False

def init_db():
    if USE_POSTGRES:
        if init_postgres():
            return
        print("[DB] Falling back to SQLite local database.")

    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    
    # 1. Wallets Table
    c.execute("""
        CREATE TABLE IF NOT EXISTS wallets (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT UNIQUE,
            currency TEXT,
            balance REAL,
            locked REAL,
            updated_at TIMESTAMP
        )
    """)

    # 2. Deposits Table
    c.execute("""
        CREATE TABLE IF NOT EXISTS deposits (
            id TEXT PRIMARY KEY,
            user_id TEXT,
            currency TEXT,
            network TEXT,
            deposit_address TEXT,
            amount REAL,
            txid TEXT,
            status TEXT,
            created_at TIMESTAMP,
            confirmed_at TIMESTAMP
        )
    """)

    # 3. Withdrawals Table
    c.execute("""
        CREATE TABLE IF NOT EXISTS withdrawals (
            id TEXT PRIMARY KEY,
            user_id TEXT,
            currency TEXT,
            network TEXT,
            destination_address TEXT,
            amount REAL,
            fee REAL,
            status TEXT,
            created_at TIMESTAMP
        )
    """)

    # 4. Users Table
    c.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY,
            email TEXT UNIQUE NOT NULL COLLATE NOCASE,
            password_hash TEXT NOT NULL,
            salt TEXT NOT NULL,
            first_name TEXT,
            last_name TEXT,
            phone TEXT,
            birth_date TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            kyc_status TEXT DEFAULT 'UNVERIFIED'
        )
    """)

    # Migration: Ensure kyc_status exists on existing users table
    c.execute("PRAGMA table_info(users)")
    cols = [r[1] for r in c.fetchall()]
    if "kyc_status" not in cols:
        c.execute("ALTER TABLE users ADD COLUMN kyc_status TEXT DEFAULT 'UNVERIFIED'")

    # 5. Sessions Table
    c.execute("""
        CREATE TABLE IF NOT EXISTS sessions (
            token TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            expires_at TIMESTAMP NOT NULL,
            FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
        )
    """)

    # 6. KYC Verifications Table
    c.execute("""
        CREATE TABLE IF NOT EXISTS kyc_verifications (
            id TEXT PRIMARY KEY,
            user_id TEXT UNIQUE,
            full_name TEXT,
            dob TEXT,
            country TEXT,
            id_type TEXT,
            id_number TEXT,
            front_doc TEXT,
            back_doc TEXT,
            selfie TEXT,
            status TEXT DEFAULT 'PENDING_REVIEW',
            rejection_reason TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            reviewed_at TIMESTAMP,
            FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
        )
    """)

    conn.commit()
    conn.close()
    print("[DB] SQLite database initialized at", DB_PATH)

def get_db():
    if USE_POSTGRES:
        try:
            raw_conn = psycopg2.connect(get_postgres_url(), connect_timeout=10)
            return PostgresConnectionWrapper(raw_conn)
        except Exception as e:
            print("[DB] Warning: PostgreSQL connection failed, falling back to local SQLite:", e)

    conn = sqlite3.connect(DB_PATH, timeout=15.0)
    conn.execute("PRAGMA journal_mode = WAL;")
    conn.execute("PRAGMA busy_timeout = 5000;")
    conn.row_factory = sqlite3.Row
    return conn

# IP Rate Limiter for Login Attempts
LOGIN_ATTEMPTS = {}
RATE_LIMIT_WINDOW = 60
MAX_LOGIN_ATTEMPTS = 5

def check_login_rate_limit(ip: str) -> bool:
    now = datetime.datetime.now().timestamp()
    attempts = LOGIN_ATTEMPTS.get(ip, [])
    recent = [t for t in attempts if now - t < RATE_LIMIT_WINDOW]
    LOGIN_ATTEMPTS[ip] = recent
    return len(recent) < MAX_LOGIN_ATTEMPTS

def record_failed_login(ip: str):
    now = datetime.datetime.now().timestamp()
    LOGIN_ATTEMPTS.setdefault(ip, []).append(now)

class CryptoTopHTTPRequestHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=BASE_DIR, **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-cache, no-store, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def _send_json(self, status_code, data):
        try:
            body = json.dumps(data, indent=2, default=str).encode('utf-8')
        except Exception as e:
            print(f"[JSON ENCODE ERROR] {e}", flush=True)
            body = json.dumps({"success": False, "error": str(e)}, default=str).encode('utf-8')
            status_code = 500
        self.send_response(status_code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Session-Token, X-Admin-Key')
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Session-Token, X-Admin-Key')
        self.end_headers()

    def get_token_from_request(self):
        auth = self.headers.get('Authorization', '')
        if auth.startswith('Bearer '):
            return auth[7:].strip()
        if 'X-Session-Token' in self.headers:
            return self.headers['X-Session-Token'].strip()
        cookies = self.headers.get('Cookie', '')
        for part in cookies.split(';'):
            part = part.strip()
            if part.startswith('cryptotop_session_token='):
                return part.split('=', 1)[1].strip()
        return None

    def get_authenticated_user(self):
        token = self.get_token_from_request()
        if token:
            return get_user_from_token(token)
        return None

    def get_current_user_id(self):
        user = self.get_authenticated_user()
        if user:
            return user["id"]
        return None

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path

        # Security: Block static downloading of backend configuration, databases, and private files
        clean_path = path.lower()
        if (clean_path.endswith('wallet_addresses.json') or 
            clean_path.endswith('telegram_config.json') or
            clean_path.endswith('.db') or 
            clean_path.endswith('.sqlite') or 
            clean_path.endswith('.env') or 
            clean_path.endswith('.py') or 
            '/.' in clean_path):
            self.send_error(404, "File not found")
            return

        # Gate admin.html: return 404 unless authenticated with admin key
        if path in ['/admin.html', '/admin']:
            qs = urllib.parse.parse_qs(parsed.query)
            admin_key = self.headers.get('X-Admin-Key', '')
            if not admin_key:
                admin_key = qs.get('admin_key', [''])[0] or qs.get('key', [''])[0]
            if not admin_key:
                cookies = self.headers.get('Cookie', '')
                for part in cookies.split(';'):
                    if 'cryptotop_admin_key=' in part:
                        admin_key = part.split('cryptotop_admin_key=')[1].strip()
            
            if admin_key != ADMIN_SECRET_KEY:
                self.send_error(404, "File not found")
                return

            admin_file = os.path.join(BASE_DIR, 'admin.html')
            if os.path.exists(admin_file):
                with open(admin_file, 'rb') as f:
                    content = f.read()
                self.send_response(200)
                self.send_header('Content-Type', 'text/html; charset=utf-8')
                self.send_header('Content-Length', str(len(content)))
                self.send_header('Set-Cookie', f'cryptotop_admin_key={ADMIN_SECRET_KEY}; Path=/; HttpOnly; SameSite=Strict')
                self.send_header('X-Robots-Tag', 'noindex, nofollow, noarchive')
                self.end_headers()
                self.wfile.write(content)
                return

        # API: Current Authenticated User Profile
        if path == '/api/auth/me':
            user = self.get_authenticated_user()
            if user:
                conn = get_db()
                c = conn.cursor()
                c.execute("SELECT balance, locked FROM wallets WHERE user_id = ?", (user["id"],))
                w = c.fetchone()
                conn.close()
                self._send_json(200, {
                    "success": True,
                    "authenticated": True,
                    "user": user,
                    "wallet": {
                        "balance": round(w["balance"], 2) if w else 0.00,
                        "locked": round(w["locked"], 2) if w else 0.00,
                        "total": round((w["balance"] + w["locked"]), 2) if w else 0.00
                    }
                })
            else:
                self._send_json(200, {
                    "success": True,
                    "authenticated": False,
                    "user": None
                })
            return

        # API: Full User Profile & Combined Transaction History
        elif path == '/api/user/full-profile':
            user = self.get_authenticated_user()
            if not user:
                self._send_json(401, {"success": False, "error": "Not authenticated. Please log in."})
                return

            conn = get_db()
            c = conn.cursor()
            
            # 1. Wallet Balance
            c.execute("SELECT balance, locked, currency FROM wallets WHERE user_id = ?", (user["id"],))
            w = c.fetchone()
            wallet = {
                "currency": w["currency"] if w else "USDT",
                "balance": round(w["balance"], 2) if w else 0.00,
                "locked": round(w["locked"], 2) if w else 0.00,
                "total": round((w["balance"] + w["locked"]), 2) if w else 0.00
            }

            # 2. Deposits (sanitized: do not expose company vault addresses)
            c.execute("""
                SELECT id, currency, network, amount, txid, status, created_at, confirmed_at 
                FROM deposits 
                WHERE user_id = ? 
                ORDER BY created_at DESC
            """, (user["id"],))
            deposits = [dict(r) for r in c.fetchall()]

            # 3. Withdrawals
            c.execute("""
                SELECT id, currency, network, destination_address, amount, fee, status, created_at 
                FROM withdrawals 
                WHERE user_id = ? 
                ORDER BY created_at DESC
            """, (user["id"],))
            withdrawals = [dict(r) for r in c.fetchall()]

            conn.close()

            # Unified activity feed sorted by created_at DESC
            activity = []
            for d in deposits:
                activity.append({
                    "id": d["id"],
                    "type": "DEPOSIT",
                    "amount": d["amount"],
                    "currency": d["currency"],
                    "network": d["network"],
                    "detail": d["network"],
                    "status": d["status"],
                    "created_at": d["created_at"]
                })
            for w_item in withdrawals:
                activity.append({
                    "id": w_item["id"],
                    "type": "WITHDRAWAL",
                    "amount": w_item["amount"],
                    "fee": w_item["fee"],
                    "currency": w_item["currency"],
                    "network": w_item["network"],
                    "detail": w_item["destination_address"],
                    "status": w_item["status"],
                    "created_at": w_item["created_at"]
                })
            activity.sort(key=lambda x: x["created_at"] or "", reverse=True)

            self._send_json(200, {
                "success": True,
                "user": user,
                "wallet": wallet,
                "deposits": deposits,
                "withdrawals": withdrawals,
                "activity": activity
            })
            return

        # API: Get Wallet Balance
        elif path == '/api/wallet/balance':
            user_id = self.get_current_user_id()
            if not user_id:
                self._send_json(200, {
                    "success": True,
                    "currency": "USDT",
                    "balance": 0.00,
                    "locked": 0.00,
                    "total": 0.00,
                    "authenticated": False
                })
                return

            conn = get_db()
            c = conn.cursor()
            c.execute("SELECT currency, balance, locked FROM wallets WHERE user_id = ?", (user_id,))
            row = c.fetchone()
            if not row:
                c.execute("""
                    INSERT INTO wallets (user_id, currency, balance, locked, updated_at)
                    VALUES (?, 'USDT', 0.00, 0.00, datetime('now'))
                """, (user_id,))
                conn.commit()
                c.execute("SELECT currency, balance, locked FROM wallets WHERE user_id = ?", (user_id,))
                row = c.fetchone()
            conn.close()
            
            if row:
                self._send_json(200, {
                    "success": True,
                    "currency": row["currency"],
                    "balance": round(row["balance"], 2),
                    "locked": round(row["locked"], 2),
                    "total": round(row["balance"] + row["locked"], 2),
                    "authenticated": True
                })
            else:
                self._send_json(404, {"success": False, "error": "Wallet not found"})
            return

        # API: Get Deposit History
        elif path == '/api/deposit/history':
            user_id = self.get_current_user_id()
            if not user_id:
                self._send_json(200, {
                    "success": True,
                    "count": 0,
                    "deposits": []
                })
                return

            conn = get_db()
            c = conn.cursor()
            c.execute("""
                SELECT id, currency, network, deposit_address, amount, txid, status, created_at, confirmed_at 
                FROM deposits 
                WHERE user_id = ? 
                ORDER BY created_at DESC LIMIT 20
            """, (user_id,))
            rows = c.fetchall()
            conn.close()

            deposits = [dict(r) for r in rows]
            self._send_json(200, {
                "success": True,
                "count": len(deposits),
                "deposits": deposits
            })
            return

        # API: Supported Networks (Sanitized: addresses stripped)
        elif path == '/api/deposit/networks':
            sanitized = {}
            for net, info in NETWORK_ADDRESSES.items():
                sanitized[net] = {
                    "confirmations": info["confirmations"],
                    "min_deposit": info["min_deposit"],
                    "fee": info["fee"]
                }
            self._send_json(200, {
                "success": True,
                "networks": sanitized
            })
            return

        # API: Assign Real Deposit Address from Pool
        elif path == '/api/deposit/assign-address':
            user = self.get_authenticated_user()
            if not user:
                self._send_json(401, {
                    "success": False,
                    "auth_required": True,
                    "error": "Authentication required. Please sign in to view deposit address."
                })
                return

            user_id = user["id"]
            conn_chk = get_db()
            c_chk = conn_chk.cursor()
            c_chk.execute("SELECT kyc_status FROM users WHERE id = ?", (user_id,))
            u_row = c_chk.fetchone()
            conn_chk.close()
            user_kyc = u_row["kyc_status"] if u_row and u_row["kyc_status"] else "UNVERIFIED"

            if user_kyc != 'VERIFIED':
                self._send_json(403, {
                    "success": False,
                    "kyc_required": True,
                    "kyc_status": user_kyc,
                    "error": "Identity verification (Level 1 KYC) is required to access deposit addresses."
                })
                return

            qs = urllib.parse.parse_qs(parsed.query)
            network = qs.get('network', ['USDT-BEP20'])[0]
            if not network.startswith("USDT-"):
                network = f"USDT-{network}"
            if network not in NETWORK_ADDRESSES:
                network = "USDT-BEP20"

            net_info = NETWORK_ADDRESSES.get(network, NETWORK_ADDRESSES["USDT-BEP20"])
            chosen_address = get_random_deposit_address(network)
            dep_id = f"DEP-{uuid.uuid4().hex[:8].upper()}"

            conn = get_db()
            c = conn.cursor()
            c.execute("""
                INSERT INTO deposits (id, user_id, currency, network, deposit_address, amount, status, created_at)
                VALUES (?, ?, 'USDT', ?, ?, 0.0, 'INITIATED', CURRENT_TIMESTAMP)
            """, (dep_id, user_id, network, chosen_address))
            conn.commit()
            conn.close()

            self._send_json(200, {
                "success": True,
                "deposit_id": dep_id,
                "address": chosen_address,
                "network": network,
                "currency": "USDT",
                "min_deposit": net_info["min_deposit"],
                "confirmations_required": net_info["confirmations"],
                "fee": net_info["fee"],
                "kyc_status": user_kyc,
                "kyc_verified": True,
                "authenticated": True
            })
            return

        # API: Get Random Deposit Address from Pool (Compatibility Fallback)
        elif path == '/api/deposit/random-address':
            user = self.get_authenticated_user()
            if not user:
                self._send_json(401, {
                    "success": False,
                    "auth_required": True,
                    "error": "Authentication required. Please sign in to view deposit address."
                })
                return

            user_id = user["id"]
            conn_chk = get_db()
            c_chk = conn_chk.cursor()
            c_chk.execute("SELECT kyc_status FROM users WHERE id = ?", (user_id,))
            u_row = c_chk.fetchone()
            conn_chk.close()
            user_kyc = u_row["kyc_status"] if u_row and u_row["kyc_status"] else "UNVERIFIED"

            if user_kyc != 'VERIFIED':
                self._send_json(403, {
                    "success": False,
                    "kyc_required": True,
                    "kyc_status": user_kyc,
                    "error": "Identity verification (Level 1 KYC) is required to access deposit addresses."
                })
                return

            qs = urllib.parse.parse_qs(parsed.query)
            network = qs.get('network', ['USDT-BEP20'])[0]
            if not network.startswith("USDT-"):
                network = f"USDT-{network}"
            net_info = NETWORK_ADDRESSES.get(network, NETWORK_ADDRESSES["USDT-BEP20"])
            chosen_address = get_random_deposit_address(network)
            self._send_json(200, {
                "success": True,
                "network": network,
                "address": chosen_address,
                "min_deposit": net_info["min_deposit"],
                "fee": net_info["fee"],
                "confirmations": net_info["confirmations"],
                "kyc_status": user_kyc,
                "kyc_verified": True
            })
            return

        # API: User Withdrawal History
        elif path == '/api/withdraw/history':
            user_id = self.get_current_user_id()
            if not user_id:
                self._send_json(200, {
                    "success": True,
                    "count": 0,
                    "withdrawals": []
                })
                return

            conn = get_db()
            c = conn.cursor()
            c.execute("""
                SELECT id, currency, network, destination_address, amount, fee, status, created_at
                FROM withdrawals
                WHERE user_id = ?
                ORDER BY created_at DESC LIMIT 30
            """, (user_id,))
            rows = c.fetchall()
            conn.close()
            items = [dict(r) for r in rows]
            self._send_json(200, {
                "success": True,
                "count": len(items),
                "withdrawals": items
            })
            return

        # API: KYC Status for Authenticated User
        elif path == '/api/kyc/status':
            user = self.get_authenticated_user()
            if not user:
                self._send_json(401, {"success": False, "error": "Unauthorized. Please log in."})
                return
            conn = get_db()
            c = conn.cursor()
            c.execute("SELECT kyc_status FROM users WHERE id = ?", (user["id"],))
            u_row = c.fetchone()
            current_status = u_row["kyc_status"] if u_row and u_row["kyc_status"] else "UNVERIFIED"

            c.execute("""
                SELECT id, full_name, dob, country, id_type, id_number, status, rejection_reason, created_at, reviewed_at
                FROM kyc_verifications
                WHERE user_id = ?
            """, (user["id"],))
            ver_row = c.fetchone()
            conn.close()

            self._send_json(200, {
                "success": True,
                "kyc_status": current_status,
                "verification": dict(ver_row) if ver_row else None
            })
            return

        # API: Admin Get Withdrawals Queue
        elif path == '/api/admin/withdrawals':
            admin_key = self.headers.get('X-Admin-Key', '')
            qs = urllib.parse.parse_qs(parsed.query)
            if not admin_key:
                admin_key = qs.get('admin_key', [''])[0] or qs.get('key', [''])[0]
            if not admin_key:
                cookies = self.headers.get('Cookie', '')
                for part in cookies.split(';'):
                    if 'cryptotop_admin_key=' in part:
                        admin_key = part.split('cryptotop_admin_key=')[1].strip()

            if admin_key != ADMIN_SECRET_KEY:
                self.send_error(404, "File not found")
                return

            status_filter = qs.get('status', ['ALL'])[0].upper()
            conn = get_db()
            c = conn.cursor()
            if status_filter == 'ALL':
                c.execute("""
                    SELECT w.id, w.user_id, u.email, u.first_name, u.last_name, w.currency, w.network, 
                           w.destination_address, w.destination_address AS destination, w.amount, w.fee, w.status, w.created_at
                    FROM withdrawals w
                    LEFT JOIN users u ON w.user_id = u.id
                    ORDER BY w.created_at DESC
                """)
            else:
                c.execute("""
                    SELECT w.id, w.user_id, u.email, u.first_name, u.last_name, w.currency, w.network, 
                           w.destination_address, w.destination_address AS destination, w.amount, w.fee, w.status, w.created_at
                    FROM withdrawals w
                    LEFT JOIN users u ON w.user_id = u.id
                    WHERE w.status = ?
                    ORDER BY w.created_at DESC
                """, (status_filter,))
            rows = c.fetchall()
            conn.close()
            items = [dict(r) for r in rows]
            self._send_json(200, {
                "success": True,
                "count": len(items),
                "withdrawals": items
            })
            return

        # API: Admin Get KYC Queue
        elif path == '/api/admin/kyc':
            admin_key = self.headers.get('X-Admin-Key', '')
            qs = urllib.parse.parse_qs(parsed.query)
            if not admin_key:
                admin_key = qs.get('admin_key', [''])[0] or qs.get('key', [''])[0]
            if not admin_key:
                cookies = self.headers.get('Cookie', '')
                for part in cookies.split(';'):
                    if 'cryptotop_admin_key=' in part:
                        admin_key = part.split('cryptotop_admin_key=')[1].strip()

            if admin_key != ADMIN_SECRET_KEY:
                self.send_error(404, "File not found")
                return

            status_filter = qs.get('status', ['ALL'])[0].upper()
            conn = get_db()
            try:
                c = conn.cursor()
                if status_filter == 'ALL':
                    c.execute("""
                        SELECT k.id, k.user_id, u.email, u.first_name, u.last_name, 
                               k.full_name, k.dob, k.country, k.id_type, k.id_number,
                               k.front_doc, k.back_doc, k.selfie, k.status, k.rejection_reason,
                               k.created_at, k.reviewed_at
                        FROM kyc_verifications k
                        LEFT JOIN users u ON k.user_id = u.id
                        ORDER BY k.created_at DESC
                    """)
                else:
                    c.execute("""
                        SELECT k.id, k.user_id, u.email, u.first_name, u.last_name, 
                               k.full_name, k.dob, k.country, k.id_type, k.id_number,
                               k.front_doc, k.back_doc, k.selfie, k.status, k.rejection_reason,
                               k.created_at, k.reviewed_at
                        FROM kyc_verifications k
                        LEFT JOIN users u ON k.user_id = u.id
                        WHERE k.status = ?
                        ORDER BY k.created_at DESC
                    """, (status_filter,))
                rows = c.fetchall()
                items = [dict(r) for r in rows]
                self._send_json(200, {
                    "success": True,
                    "count": len(items),
                    "verifications": items
                })
            except Exception as e:
                print(f"[ADMIN KYC ERROR] {e}", flush=True)
                self._send_json(500, {"success": False, "error": str(e), "verifications": []})
            finally:
                conn.close()
            return

        # API: Admin Get Deposits Queue
        elif path == '/api/admin/deposits':
            admin_key = self.headers.get('X-Admin-Key', '')
            qs = urllib.parse.parse_qs(parsed.query)
            if not admin_key:
                admin_key = qs.get('admin_key', [''])[0] or qs.get('key', [''])[0]
            if not admin_key:
                cookies = self.headers.get('Cookie', '')
                for part in cookies.split(';'):
                    if 'cryptotop_admin_key=' in part:
                        admin_key = part.split('cryptotop_admin_key=')[1].strip()

            if admin_key != ADMIN_SECRET_KEY:
                self.send_error(404, "File not found")
                return

            status_filter = qs.get('status', ['ALL'])[0].upper()
            conn = get_db()
            c = conn.cursor()
            if status_filter == 'ALL':
                c.execute("""
                    SELECT d.id, d.user_id, u.email, u.first_name, u.last_name, 
                           d.currency, d.network, d.deposit_address, d.amount, d.txid, d.status, 
                           d.created_at, d.confirmed_at
                    FROM deposits d
                    LEFT JOIN users u ON d.user_id = u.id
                    WHERE d.status != 'INITIATED'
                    ORDER BY d.created_at DESC
                """)
            else:
                c.execute("""
                    SELECT d.id, d.user_id, u.email, u.first_name, u.last_name, 
                           d.currency, d.network, d.deposit_address, d.amount, d.txid, d.status, 
                           d.created_at, d.confirmed_at
                    FROM deposits d
                    LEFT JOIN users u ON d.user_id = u.id
                    WHERE d.status = ?
                    ORDER BY d.created_at DESC
                """, (status_filter,))
            rows = c.fetchall()
            conn.close()
            items = [dict(r) for r in rows]
            self._send_json(200, {
                "success": True,
                "count": len(items),
                "deposits": items
            })
            return

        # API: Admin Get Telegram Configuration
        elif path == '/api/admin/telegram':
            admin_key = self.headers.get('X-Admin-Key', '')
            qs = urllib.parse.parse_qs(parsed.query)
            if not admin_key:
                admin_key = qs.get('admin_key', [''])[0] or qs.get('key', [''])[0]
            if not admin_key:
                cookies = self.headers.get('Cookie', '')
                for part in cookies.split(';'):
                    if 'cryptotop_admin_key=' in part:
                        admin_key = part.split('cryptotop_admin_key=')[1].strip()

            if admin_key != ADMIN_SECRET_KEY:
                self.send_error(404, "File not found")
                return

            cfg = {"enabled": False, "bot_token": "", "chat_id": ""}
            if os.path.exists(TELEGRAM_CONFIG_FILE):
                try:
                    with open(TELEGRAM_CONFIG_FILE, 'r', encoding='utf-8') as f:
                        cfg = json.load(f)
                except Exception:
                    pass

            token = os.environ.get("TELEGRAM_BOT_TOKEN", "").strip() or cfg.get("bot_token", "")
            chat_id = os.environ.get("TELEGRAM_CHAT_ID", "").strip() or cfg.get("chat_id", "")
            if "TELEGRAM_ENABLED" in os.environ:
                is_enabled = os.environ.get("TELEGRAM_ENABLED", "").strip().lower() in ["true", "1", "yes"]
            else:
                is_enabled = bool(cfg.get("enabled", False))

            masked_token = (token[:6] + "..." + token[-4:]) if len(token) > 10 else ("Configured" if token else "")

            self._send_json(200, {
                "success": True,
                "enabled": is_enabled,
                "has_token": bool(token),
                "masked_token": masked_token,
                "chat_id": chat_id
            })
            return

        # Redirect retired install-app page to home
        elif path == '/install-app.html':
            self.send_response(301)
            self.send_header('Location', '/')
            self.end_headers()
            return

        # Security Guard: Block public HTTP downloads of sensitive configuration, db, and source files
        clean_path = path.lstrip('/').lower()
        blocked_exts = ('.env', '.db', '.sqlite', '.py', '.json', '.yaml', '.yml', '.md', '.log', '.sh', '.bat')
        if any(clean_path.endswith(ext) for ext in blocked_exts) or any(part.startswith('.') for part in clean_path.split('/')):
            self.send_error(404, "File not found")
            return

        # Default static file serving
        return super().do_GET()

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        qs = urllib.parse.parse_qs(parsed.query)

        content_length = int(self.headers.get('Content-Length', 0))
        post_data = self.rfile.read(content_length).decode('utf-8') if content_length > 0 else '{}'
        
        try:
            payload = json.loads(post_data) if post_data else {}
        except Exception:
            self._send_json(400, {"success": False, "error": "Invalid JSON format"})
            return

        # API: User Registration
        if path == '/api/auth/register':
            email = (payload.get("email") or "").strip().lower()
            password = payload.get("password") or ""
            first_name = (payload.get("firstName") or "").strip()
            last_name = (payload.get("lastName") or "").strip()
            phone = (payload.get("phone") or "").strip()
            birth_date = (payload.get("birthDate") or "").strip()

            if not email or "@" not in email or "." not in email:
                self._send_json(400, {"success": False, "error": "Please provide a valid email address."})
                return
            if len(password) < 6:
                self._send_json(400, {"success": False, "error": "Password must be at least 6 characters long."})
                return

            conn = get_db()
            c = conn.cursor()
            c.execute("SELECT id FROM users WHERE email = ?", (email,))
            existing = c.fetchone()
            if existing:
                conn.close()
                self._send_json(400, {"success": False, "error": "This email address is already registered. Please log in."})
                return

            user_id = f"USR-{uuid.uuid4().hex[:8].upper()}"
            pwd_hash, salt = hash_password(password)

            try:
                c.execute("""
                    INSERT INTO users (id, email, password_hash, salt, first_name, last_name, phone, birth_date, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
                """, (user_id, email, pwd_hash, salt, first_name, last_name, phone, birth_date))

                # Initialize user wallet with 0.00 USDT initial balance
                c.execute("""
                    INSERT INTO wallets (user_id, currency, balance, locked, updated_at)
                    VALUES (?, 'USDT', 0.00, 0.00, datetime('now'))
                """, (user_id,))

                conn.commit()
            except Exception as e:
                conn.rollback()
                conn.close()
                self._send_json(500, {"success": False, "error": f"Registration failed: {str(e)}"})
                return
            finally:
                conn.close()

            token = create_session(user_id)
            self._send_json(201, {
                "success": True,
                "message": "Account created successfully.",
                "token": token,
                "user": {
                    "id": user_id,
                    "email": email,
                    "firstName": first_name,
                    "lastName": last_name
                }
            })
            return

        # API: User Login
        elif path == '/api/auth/login':
            client_ip = self.client_address[0]
            if not check_login_rate_limit(client_ip):
                self._send_json(429, {"success": False, "error": "Too many failed login attempts. Please wait 1 minute before trying again."})
                return

            email = (payload.get("email") or "").strip().lower()
            password = payload.get("password") or ""

            if not email or not password:
                self._send_json(400, {"success": False, "error": "Please enter both email and password."})
                return

            conn = get_db()
            c = conn.cursor()
            c.execute("SELECT id, email, password_hash, salt, first_name, last_name FROM users WHERE email = ?", (email,))
            user_row = c.fetchone()
            conn.close()

            if not user_row or not verify_password(password, user_row["password_hash"], user_row["salt"]):
                record_failed_login(client_ip)
                self._send_json(401, {"success": False, "error": "Invalid email or password. Please try again."})
                return

            token = create_session(user_row["id"])
            self._send_json(200, {
                "success": True,
                "message": "Login successful.",
                "token": token,
                "user": {
                    "id": user_row["id"],
                    "email": user_row["email"],
                    "firstName": user_row["first_name"],
                    "lastName": user_row["last_name"]
                }
            })
            return

        # API: User Logout
        elif path == '/api/auth/logout':
            token = self.get_token_from_request()
            if token:
                delete_session(token)
            self._send_json(200, {"success": True, "message": "Successfully logged out."})
            return

        # API: Create Deposit Request
        elif path == '/api/deposit/create':
            user = self.get_authenticated_user()
            if not user:
                self._send_json(401, {"success": False, "auth_required": True, "error": "Please log in to make a deposit."})
                return

            user_id = user["id"]
            conn_chk = get_db()
            c_chk = conn_chk.cursor()
            c_chk.execute("SELECT kyc_status FROM users WHERE id = ?", (user_id,))
            u_row = c_chk.fetchone()
            conn_chk.close()
            kyc_status = u_row["kyc_status"] if u_row and u_row["kyc_status"] else "UNVERIFIED"

            if kyc_status != 'VERIFIED':
                self._send_json(403, {
                    "success": False,
                    "kyc_required": True,
                    "kyc_status": kyc_status,
                    "error": "Identity verification (Level 1 KYC) is required before depositing funds. Please complete verification."
                })
                return

            network = payload.get("network", "USDT-TRC20")
            if not network.startswith("USDT-"):
                network = f"USDT-{network}"
            currency = payload.get("currency", "USDT")
            net_info = NETWORK_ADDRESSES.get(network, NETWORK_ADDRESSES.get("USDT-TRC20", {}))
            chosen_address = get_random_deposit_address(network)
            
            dep_id = f"DEP-{uuid.uuid4().hex[:8].upper()}"
            conn = get_db()
            c = conn.cursor()
            c.execute("""
                INSERT INTO deposits (id, user_id, currency, network, deposit_address, amount, txid, status, created_at)
                VALUES (?, ?, ?, ?, ?, 0.0, NULL, 'PENDING', datetime('now'))
            """, (dep_id, user_id, currency, network, chosen_address))
            conn.commit()
            conn.close()

            self._send_json(200, {
                "success": True,
                "deposit_id": dep_id,
                "currency": currency,
                "network": network,
                "status": "SECURE_GATEWAY_ASSIGNED",
                "min_deposit": net_info.get("min_deposit", 10.0),
                "confirmations_required": net_info.get("confirmations", 12),
                "fee": net_info.get("fee", "0.00 USDT")
            })
            return

        # API: Submit / Confirm Deposit Amount
        elif path == '/api/deposit/submit':
            user_id = self.get_current_user_id()
            if not user_id:
                self._send_json(401, {"success": False, "error": "Please log in to deposit funds."})
                return

            # Check KYC status for compliance metadata and enforce verification
            conn_chk = get_db()
            c_chk = conn_chk.cursor()
            c_chk.execute("SELECT kyc_status FROM users WHERE id = ?", (user_id,))
            u_row = c_chk.fetchone()
            conn_chk.close()
            kyc_status = u_row["kyc_status"] if u_row and u_row["kyc_status"] else "UNVERIFIED"

            if kyc_status != 'VERIFIED':
                self._send_json(403, {
                    "success": False,
                    "kyc_required": True,
                    "error": "Identity verification (Level 1 KYC) is required before depositing funds. Please complete verification."
                })
                return

            amount = float(payload.get("amount", 0.0))
            network = payload.get("network", "USDT-BEP20")
            if not network.startswith("USDT-"):
                network = f"USDT-{network}"
            if network not in NETWORK_ADDRESSES:
                network = "USDT-BEP20"

            if amount <= 0:
                self._send_json(400, {"success": False, "error": "Deposit amount must be greater than 0"})
                return

            txid = (payload.get("txid") or "").strip()
            if not txid or len(txid) < 8:
                self._send_json(400, {"success": False, "error": "Please provide a valid on-chain transaction hash (TxID)."})
                return

            dep_address = (payload.get("address") or payload.get("deposit_address") or "").strip()
            if not dep_address:
                dep_address = get_random_deposit_address(network)

            dep_id = payload.get("deposit_id") or f"DEP-{uuid.uuid4().hex[:8].upper()}"

            conn = get_db()
            try:
                c = conn.cursor()

                # Replay Protection: Prevent reuse of same TxID
                c.execute("SELECT id FROM deposits WHERE txid = ? AND status != 'REJECTED' AND id != ?", (txid, dep_id))
                dup = c.fetchone()
                if dup:
                    conn.close()
                    self._send_json(400, {"success": False, "error": "This transaction hash (TxID) has already been submitted or processed."})
                    return

                # Record Deposit with status PENDING_REVIEW
                c.execute("""
                    INSERT INTO deposits (id, user_id, currency, network, deposit_address, amount, txid, status, created_at)
                    VALUES (?, ?, 'USDT', ?, ?, ?, ?, 'PENDING_REVIEW', datetime('now'))
                    ON CONFLICT(id) DO UPDATE SET 
                        amount = excluded.amount,
                        txid = excluded.txid,
                        network = excluded.network,
                        deposit_address = excluded.deposit_address,
                        status = 'PENDING_REVIEW',
                        created_at = datetime('now')
                """, (dep_id, user_id, network, dep_address, amount, txid))
                conn.commit()

                # Dispatch Real-Time Telegram Alert
                user_obj = self.get_authenticated_user()
                user_email = user_obj.get("email", user_id) if user_obj else user_id
                if "BEP20" in network or "BSC" in network:
                    explorer_url = f"https://bscscan.com/tx/{txid}"
                elif "TRC20" in network or "TRC" in network:
                    explorer_url = f"https://tronscan.org/#/transaction/{txid}"
                else:
                    explorer_url = f"TxID: {txid}"
                
                admin_origin = os.environ.get("RENDER_EXTERNAL_URL", "https://cryptotop.onrender.com").rstrip("/")
                admin_link = f"{admin_origin}/admin.html?admin_key={ADMIN_SECRET_KEY}"
                dep_alert = (
                    f"📥 *NEW DEPOSIT PROOF SUBMITTED*\n\n"
                    f"💰 *Amount:* `${amount:,.2f} USDT` ({network})\n"
                    f"👤 *Customer:* `{user_email}`\n"
                    f"🛡️ *KYC Status:* `{kyc_status}`\n"
                    f"🏦 *Vault Address:* `{dep_address}`\n"
                    f"🔗 *TxID:* `{txid}`\n"
                    f"🔍 *Explorer:* {explorer_url}\n\n"
                    f"👉 [Open Admin Desk]({admin_link})"
                )
                send_telegram_alert(dep_alert)

                self._send_json(200, {
                    "success": True,
                    "message": f"Payment proof for ${amount:,.2f} USDT submitted. Our compliance desk will verify your on-chain transaction and credit your balance shortly.",
                    "deposit_id": dep_id,
                    "amount": amount,
                    "network": network,
                    "txid": txid,
                    "status": "PENDING_REVIEW"
                })
            except Exception as e:
                conn.rollback()
                self._send_json(500, {"success": False, "error": str(e)})
            finally:
                conn.close()
            return

        # API: Withdraw (Submits for administrative review, locking requested amount)
        elif path == '/api/withdraw':
            user_id = self.get_current_user_id()
            if not user_id:
                self._send_json(401, {"success": False, "error": "Please log in to withdraw funds."})
                return
            amount = float(payload.get("amount", 0.0))
            destination = payload.get("destination", "").strip()
            network = payload.get("network", "USDT-TRC20")
            
            if amount <= 0:
                self._send_json(400, {"success": False, "error": "Invalid withdrawal amount"})
                return
            if not destination:
                self._send_json(400, {"success": False, "error": "Destination address is required"})
                return

            conn = get_db()
            try:
                c = conn.cursor()

                # Check KYC status: strictly require Level 1 VERIFIED before withdrawal
                c.execute("SELECT kyc_status FROM users WHERE id = ?", (user_id,))
                u_row = c.fetchone()
                user_kyc = u_row["kyc_status"] if u_row and u_row["kyc_status"] else "UNVERIFIED"
                if user_kyc != 'VERIFIED':
                    conn.close()
                    self._send_json(403, {
                        "success": False,
                        "kyc_required": True,
                        "error": "Identity verification (Level 1 KYC) is required before requesting withdrawals. Please complete verification."
                    })
                    return

                c.execute("SELECT balance, locked FROM wallets WHERE user_id = ?", (user_id,))
                w_row = c.fetchone()
                current_bal = w_row["balance"] if w_row else 0.0
                
                if amount > current_bal:
                    self._send_json(400, {"success": False, "error": "Insufficient available wallet balance"})
                    return

                fee = 0.00
                
                # Deduct requested amount from user's wallet balance (simulated withdrawal, no actual crypto payout)
                c.execute("""
                    UPDATE wallets 
                    SET balance = balance - ?, updated_at = datetime('now') 
                    WHERE user_id = ?
                """, (amount, user_id))
                
                new_bal = round(current_bal - amount, 2)
                
                # Generate TWO withdrawal history records with the exact same requested amount.
                with_id_1 = f"WTH-{uuid.uuid4().hex[:8].upper()}"
                with_id_2 = f"WTH-{uuid.uuid4().hex[:8].upper()}"
                
                # Transaction Record 1
                c.execute("""
                    INSERT INTO withdrawals (id, user_id, currency, network, destination_address, amount, fee, status, created_at)
                    VALUES (?, ?, 'USDT', ?, ?, ?, ?, 'COMPLETED', datetime('now'))
                """, (with_id_1, user_id, network, destination, amount, fee))

                # Transaction Record 2 (same amount, offset by +1s for clean sorting)
                c.execute("""
                    INSERT INTO withdrawals (id, user_id, currency, network, destination_address, amount, fee, status, created_at)
                    VALUES (?, ?, 'USDT', ?, ?, ?, ?, 'COMPLETED', datetime('now', '+1 second'))
                """, (with_id_2, user_id, network, destination, amount, fee))

                conn.commit()

                # Dispatch Real-Time Telegram Alert
                user_obj = self.get_authenticated_user()
                user_email = user_obj.get("email", user_id) if user_obj else user_id
                wth_alert = (
                    f"💸 *NEW WITHDRAWAL SUBMITTED*\n\n"
                    f"💰 *Amount:* `${amount:,.2f} USDT` ({network})\n"
                    f"👤 *Customer:* `{user_email}`\n"
                    f"🎯 *Destination:* `{destination}`\n"
                    f"📄 *Ref ID:* `{with_id_1}`\n\n"
                    f"👉 [Open Admin Desk](http://localhost:8080/admin.html?admin_key={ADMIN_SECRET_KEY})"
                )
                send_telegram_alert(wth_alert)

                self._send_json(200, {
                    "success": True,
                    "status": "COMPLETED",
                    "message": f"Withdrawal of {amount:.2f} USDT completed successfully.",
                    "id": with_id_1,
                    "withdrawal_id": with_id_1,
                    "transactions": [with_id_1, with_id_2],
                    "amount": amount,
                    "fee": fee,
                    "new_balance": new_bal,
                    "locked": round(w_row["locked"] if w_row else 0.0, 2),
                    "available_balance": new_bal,
                    "locked_balance": round(w_row["locked"] if w_row else 0.0, 2),
                    "total_equity": round(new_bal + (w_row["locked"] if w_row else 0.0), 2)
                })
            except Exception as e:
                conn.rollback()
                self._send_json(500, {"success": False, "error": str(e)})
            finally:
                conn.close()
            return

        # API: Admin Approve or Reject Withdrawal
        elif path == '/api/admin/withdrawals/action':
            admin_key = self.headers.get('X-Admin-Key', '') or payload.get("admin_key", "") or qs.get('admin_key', [''])[0] or qs.get('key', [''])[0]
            if not admin_key:
                cookies = self.headers.get('Cookie', '')
                for part in cookies.split(';'):
                    if 'cryptotop_admin_key=' in part:
                        admin_key = part.split('cryptotop_admin_key=')[1].strip()
            if admin_key != ADMIN_SECRET_KEY:
                self._send_json(403, {"success": False, "error": "Unauthorized: Invalid Admin Key"})
                return

            with_id = payload.get("withdrawal_id") or payload.get("id")
            if with_id:
                with_id = str(with_id).strip()
            action = (payload.get("action") or "").lower()

            if not with_id or action not in ['approve', 'reject']:
                self._send_json(400, {"success": False, "error": "Provide valid withdrawal_id and action ('approve' or 'reject')"})
                return

            conn = get_db()
            try:
                c = conn.cursor()
                c.execute("SELECT id, user_id, amount, status FROM withdrawals WHERE id = ?", (with_id,))
                w_rec = c.fetchone()
                if not w_rec:
                    self._send_json(404, {"success": False, "error": "Withdrawal request not found"})
                    return

                if w_rec["status"] != 'PENDING_REVIEW':
                    self._send_json(400, {"success": False, "error": f"Withdrawal is already {w_rec['status']}"})
                    return

                w_user_id = w_rec["user_id"]
                w_amount = w_rec["amount"]

                if action == 'approve':
                    # Payout processed: deduct from locked balance
                    c.execute("""
                        UPDATE wallets 
                        SET locked = MAX(0.0, locked - ?), updated_at = datetime('now')
                        WHERE user_id = ?
                    """, (w_amount, w_user_id))
                    c.execute("UPDATE withdrawals SET status = 'COMPLETED' WHERE id = ?", (with_id,))
                    new_status = 'COMPLETED'
                    msg = f"Withdrawal {with_id} approved. Payout confirmed."
                else:
                    # Rejected: restore funds from locked back to available balance
                    c.execute("""
                        UPDATE wallets 
                        SET locked = MAX(0.0, locked - ?), balance = balance + ?, updated_at = datetime('now')
                        WHERE user_id = ?
                    """, (w_amount, w_amount, w_user_id))
                    c.execute("UPDATE withdrawals SET status = 'REJECTED' WHERE id = ?", (with_id,))
                    new_status = 'REJECTED'
                    msg = f"Withdrawal {with_id} rejected. {w_amount:.2f} USDT restored to available balance."

                conn.commit()

                # Get updated wallet balances
                c.execute("SELECT balance, locked FROM wallets WHERE user_id = ?", (w_user_id,))
                updated_wallet = c.fetchone()

                self._send_json(200, {
                    "success": True,
                    "message": msg,
                    "withdrawal_id": with_id,
                    "status": new_status,
                    "user_id": w_user_id,
                    "new_available_balance": round(updated_wallet["balance"], 2) if updated_wallet else 0.0,
                    "new_locked_balance": round(updated_wallet["locked"], 2) if updated_wallet else 0.0
                })
            except Exception as e:
                conn.rollback()
                self._send_json(500, {"success": False, "error": str(e)})
            finally:
                conn.close()
            return

        # API: Admin Approve or Reject Deposit
        elif path == '/api/admin/deposits/action':
            admin_key = self.headers.get('X-Admin-Key', '') or payload.get("admin_key", "") or qs.get('admin_key', [''])[0] or qs.get('key', [''])[0]
            if not admin_key:
                cookies = self.headers.get('Cookie', '')
                for part in cookies.split(';'):
                    if 'cryptotop_admin_key=' in part:
                        admin_key = part.split('cryptotop_admin_key=')[1].strip()

            if admin_key != ADMIN_SECRET_KEY:
                self._send_json(403, {"success": False, "error": "Unauthorized: Invalid Admin Key"})
                return

            dep_id = payload.get("deposit_id") or payload.get("id")
            if dep_id:
                dep_id = str(dep_id).strip()
            action = (payload.get("action") or "").lower()

            if not dep_id or action not in ['approve', 'reject']:
                self._send_json(400, {"success": False, "error": "Provide valid deposit_id and action ('approve' or 'reject')"})
                return

            conn = get_db()
            try:
                c = conn.cursor()
                c.execute("SELECT id, user_id, amount, status FROM deposits WHERE id = ?", (dep_id,))
                d_rec = c.fetchone()
                if not d_rec:
                    self._send_json(404, {"success": False, "error": "Deposit request not found"})
                    return

                if d_rec["status"] != 'PENDING_REVIEW':
                    self._send_json(400, {"success": False, "error": f"Deposit is already {d_rec['status']}"})
                    return

                d_user_id = d_rec["user_id"]
                d_amount = float(d_rec["amount"])

                # Allow admin to adjust/correct approved amount (e.g. user entered 110 by mistake instead of 10)
                if payload.get("amount") is not None:
                    try:
                        override_val = float(payload.get("amount"))
                        if override_val > 0:
                            d_amount = round(override_val, 2)
                    except (ValueError, TypeError):
                        pass

                if action == 'approve':
                    # Ensure user wallet exists
                    c.execute("SELECT id FROM wallets WHERE user_id = ?", (d_user_id,))
                    if not c.fetchone():
                        c.execute("""
                            INSERT INTO wallets (user_id, currency, balance, locked, updated_at)
                            VALUES (?, 'USDT', 0.00, 0.00, CURRENT_TIMESTAMP)
                        """, (d_user_id,))

                    # Increment wallet balance with approved amount
                    c.execute("""
                        UPDATE wallets 
                        SET balance = balance + ?, updated_at = CURRENT_TIMESTAMP 
                        WHERE user_id = ?
                    """, (d_amount, d_user_id))
                    c.execute("UPDATE deposits SET amount = ?, status = 'COMPLETED', confirmed_at = CURRENT_TIMESTAMP WHERE id = ?", (d_amount, dep_id))
                    new_status = 'COMPLETED'
                    msg = f"Deposit {dep_id} approved with corrected amount. ${d_amount:,.2f} USDT credited to user."
                else:
                    c.execute("UPDATE deposits SET status = 'REJECTED' WHERE id = ?", (dep_id,))
                    new_status = 'REJECTED'
                    msg = f"Deposit {dep_id} rejected. No funds credited."

                conn.commit()

                # Get updated wallet balances
                c.execute("SELECT balance, locked FROM wallets WHERE user_id = ?", (d_user_id,))
                updated_wallet = c.fetchone()

                self._send_json(200, {
                    "success": True,
                    "message": msg,
                    "deposit_id": dep_id,
                    "status": new_status,
                    "user_id": d_user_id,
                    "amount": d_amount,
                    "new_balance": round(updated_wallet["balance"], 2) if updated_wallet else 0.0
                })
            except Exception as e:
                conn.rollback()
                self._send_json(500, {"success": False, "error": str(e)})
            finally:
                conn.close()
            return

        # API: User Submit KYC Verification Documents
        elif path == '/api/kyc/submit':
            user_id = self.get_current_user_id()
            if not user_id:
                self._send_json(401, {"success": False, "error": "Please log in to submit identity verification."})
                return

            full_name = (payload.get("full_name") or "").strip()
            dob = (payload.get("dob") or "").strip()
            country = (payload.get("country") or "").strip()
            id_type = (payload.get("id_type") or "National ID").strip()
            id_number = (payload.get("id_number") or "").strip()
            front_doc = (payload.get("front_doc") or "").strip()
            back_doc = (payload.get("back_doc") or "").strip()
            selfie = (payload.get("selfie") or "").strip()

            if not full_name or not id_number or not front_doc:
                self._send_json(400, {
                    "success": False, 
                    "error": "Please provide full legal name, ID document number, and front document image."
                })
                return

            kyc_id = f"KYC-{uuid.uuid4().hex[:8].upper()}"
            conn = get_db()
            try:
                c = conn.cursor()
                c.execute("""
                    INSERT INTO kyc_verifications (id, user_id, full_name, dob, country, id_type, id_number, front_doc, back_doc, selfie, status, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING_REVIEW', datetime('now'))
                    ON CONFLICT(user_id) DO UPDATE SET
                        full_name = excluded.full_name,
                        dob = excluded.dob,
                        country = excluded.country,
                        id_type = excluded.id_type,
                        id_number = excluded.id_number,
                        front_doc = excluded.front_doc,
                        back_doc = excluded.back_doc,
                        selfie = excluded.selfie,
                        status = 'PENDING_REVIEW',
                        rejection_reason = NULL,
                        created_at = datetime('now'),
                        reviewed_at = NULL
                """, (kyc_id, user_id, full_name, dob, country, id_type, id_number, front_doc, back_doc, selfie))

                c.execute("UPDATE users SET kyc_status = 'PENDING_REVIEW' WHERE id = ?", (user_id,))
                conn.commit()

                # Dispatch Real-Time Telegram Alert
                user_obj = self.get_authenticated_user()
                user_email = user_obj.get("email", user_id) if user_obj else user_id
                kyc_alert = (
                    f"🪪 *NEW KYC IDENTITY APPLICATION*\n\n"
                    f"👤 *Applicant:* `{full_name}`\n"
                    f"📧 *Email:* `{user_email}`\n"
                    f"🌍 *Country:* `{country}`\n"
                    f"📄 *Document:* {id_type} (`{id_number}`)\n\n"
                    f"👉 [Inspect & Review](http://localhost:8080/admin.html?admin_key={ADMIN_SECRET_KEY})"
                )
                send_telegram_alert(kyc_alert)

                self._send_json(200, {
                    "success": True,
                    "message": "KYC identity verification submitted successfully. Under review by compliance desk.",
                    "kyc_status": "PENDING_REVIEW",
                    "verification_id": kyc_id
                })
            except Exception as e:
                conn.rollback()
                self._send_json(500, {"success": False, "error": f"Database error: {str(e)}"})
            finally:
                conn.close()
            return

        # API: Admin Approve or Reject KYC Verification
        elif path == '/api/admin/kyc/action':
            admin_key = self.headers.get('X-Admin-Key', '') or payload.get("admin_key", "") or qs.get('admin_key', [''])[0] or qs.get('key', [''])[0]
            if not admin_key:
                cookies = self.headers.get('Cookie', '')
                for part in cookies.split(';'):
                    if 'cryptotop_admin_key=' in part:
                        admin_key = part.split('cryptotop_admin_key=')[1].strip()

            if admin_key != ADMIN_SECRET_KEY:
                self._send_json(403, {"success": False, "error": "Unauthorized: Invalid Admin Key"})
                return

            target_id = payload.get("verification_id") or payload.get("id") or payload.get("user_id")
            action = (payload.get("action") or "").lower()
            reason = (payload.get("reason") or "Documents did not satisfy compliance verification criteria.").strip()

            if not target_id or action not in ['approve', 'reject']:
                self._send_json(400, {"success": False, "error": "Provide valid verification_id and action ('approve' or 'reject')"})
                return

            conn = get_db()
            try:
                c = conn.cursor()
                c.execute("SELECT id, user_id, status FROM kyc_verifications WHERE id = ? OR user_id = ?", (target_id, target_id))
                rec = c.fetchone()
                if not rec:
                    self._send_json(404, {"success": False, "error": "Verification submission not found"})
                    return

                k_user_id = rec["user_id"]
                k_id = rec["id"]

                if action == 'approve':
                    c.execute("UPDATE kyc_verifications SET status = 'VERIFIED', rejection_reason = NULL, reviewed_at = datetime('now') WHERE id = ?", (k_id,))
                    c.execute("UPDATE users SET kyc_status = 'VERIFIED' WHERE id = ?", (k_user_id,))
                    msg = f"User verification {k_id} approved. Deposit access unlocked for user {k_user_id}."
                else:
                    c.execute("UPDATE kyc_verifications SET status = 'REJECTED', rejection_reason = ?, reviewed_at = datetime('now') WHERE id = ?", (reason, k_id))
                    c.execute("UPDATE users SET kyc_status = 'REJECTED' WHERE id = ?", (k_user_id,))
                    msg = f"User verification {k_id} rejected. Reason: {reason}"

                conn.commit()
                self._send_json(200, {
                    "success": True,
                    "message": msg,
                    "action": action,
                    "kyc_status": "VERIFIED" if action == 'approve' else "REJECTED"
                })
            except Exception as e:
                conn.rollback()
                self._send_json(500, {"success": False, "error": f"Database error: {str(e)}"})
            finally:
                conn.close()
            return

        # API: Admin Save Telegram Settings
        elif path == '/api/admin/telegram/config':
            admin_key = self.headers.get('X-Admin-Key', '') or payload.get("admin_key", "") or qs.get('admin_key', [''])[0] or qs.get('key', [''])[0]
            if not admin_key:
                cookies = self.headers.get('Cookie', '')
                for part in cookies.split(';'):
                    if 'cryptotop_admin_key=' in part:
                        admin_key = part.split('cryptotop_admin_key=')[1].strip()

            if admin_key != ADMIN_SECRET_KEY:
                self._send_json(403, {"success": False, "error": "Unauthorized: Invalid Admin Key"})
                return

            bot_token = (payload.get("bot_token") or "").strip()
            chat_id = (payload.get("chat_id") or "").strip()
            enabled = bool(payload.get("enabled", True))

            if not bot_token and os.path.exists(TELEGRAM_CONFIG_FILE):
                try:
                    with open(TELEGRAM_CONFIG_FILE, 'r', encoding='utf-8') as f:
                        old_cfg = json.load(f)
                        bot_token = old_cfg.get("bot_token", "")
                except Exception:
                    pass

            config_data = {
                "enabled": enabled,
                "bot_token": bot_token,
                "chat_id": chat_id,
                "updated_at": str(datetime.datetime.now())
            }

            try:
                with open(TELEGRAM_CONFIG_FILE, 'w', encoding='utf-8') as f:
                    json.dump(config_data, f, indent=2)
                self._send_json(200, {
                    "success": True,
                    "message": "Telegram settings updated successfully.",
                    "enabled": enabled,
                    "has_token": bool(bot_token),
                    "chat_id": chat_id
                })
            except Exception as e:
                self._send_json(500, {"success": False, "error": f"Failed to save config: {e}"})
            return

        # API: Admin Send Test Telegram Ping
        elif path == '/api/admin/telegram/test':
            admin_key = self.headers.get('X-Admin-Key', '') or payload.get("admin_key", "") or qs.get('admin_key', [''])[0] or qs.get('key', [''])[0]
            if not admin_key:
                cookies = self.headers.get('Cookie', '')
                for part in cookies.split(';'):
                    if 'cryptotop_admin_key=' in part:
                        admin_key = part.split('cryptotop_admin_key=')[1].strip()

            if admin_key != ADMIN_SECRET_KEY:
                self._send_json(403, {"success": False, "error": "Unauthorized: Invalid Admin Key"})
                return

            test_msg = (
                "🔔 *CryptoTop Telegram Alert System Connected!*\n\n"
                "✓ Push alerts are functioning properly.\n"
                "✓ You will receive instant notifications here whenever a customer deposits, withdraws, or submits KYC."
            )
            send_telegram_alert(test_msg)
            self._send_json(200, {
                "success": True, 
                "message": "Test message dispatched to Telegram! Check your phone."
            })
            return

        else:
            self._send_json(404, {"success": False, "error": "Endpoint not found"})

def run_server(port=PORT):
    init_db()
    socketserver.ThreadingTCPServer.allow_reuse_address = True
    socketserver.ThreadingTCPServer.daemon_threads = True
    handler = CryptoTopHTTPRequestHandler
    with socketserver.ThreadingTCPServer(("", port), handler) as httpd:
        print(f"[SERVER] CryptoTop Backend & Static Server running at http://localhost:{port}/")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\n[SERVER] Shutting down.")
            httpd.shutdown()

if __name__ == '__main__':
    port = int(os.environ.get('PORT', sys.argv[1] if len(sys.argv) > 1 else PORT))
    run_server(port)
