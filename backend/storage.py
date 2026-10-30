"""SQLite storage.

All persistence goes through this module. The Flask API and the MCP servers both use it,
which is safe because SQLite runs in WAL mode and each call opens its own short-lived
connection. Schema changes are applied by `_migrate`, which adds missing columns to an
existing database."""
from __future__ import annotations

import json
import re
import secrets
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from typing import Any, Iterable, Iterator

from backend.config import get_settings
from backend.logging_setup import get_logger
from backend.schemas import METRIC_KEYS

log = get_logger("storage")

_METRIC_COLUMNS = ", ".join(f"{k} REAL" for k in METRIC_KEYS)

_SCHEMA = f"""
CREATE TABLE IF NOT EXISTS users (
    user_id         TEXT PRIMARY KEY,
    display_name    TEXT NOT NULL,
    persona         TEXT,
    is_synthetic    INTEGER NOT NULL DEFAULT 0,
    checkin_consent INTEGER NOT NULL DEFAULT 1,
    created_at      TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS feature_sessions (
    session_id       TEXT PRIMARY KEY,
    user_id          TEXT NOT NULL,
    day              TEXT NOT NULL,
    input_mode       TEXT,
    {_METRIC_COLUMNS},
    keystroke_count  INTEGER,
    word_count       INTEGER,
    created_at       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user_day ON feature_sessions (user_id, day);
CREATE TABLE IF NOT EXISTS memories (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    TEXT NOT NULL,
    day        TEXT NOT NULL,
    kind       TEXT NOT NULL,
    text       TEXT NOT NULL,
    meta_json  TEXT,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_memories_user_kind ON memories (user_id, kind, day);
CREATE TABLE IF NOT EXISTS evidence_cache (
    query_key    TEXT PRIMARY KEY,
    fetched_at   TEXT NOT NULL,
    results_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS notifications (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    TEXT NOT NULL,
    created_at TEXT NOT NULL,
    kind       TEXT NOT NULL,
    title      TEXT NOT NULL,
    body       TEXT NOT NULL,
    signal     TEXT,
    run_id     TEXT,
    is_read    INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications (user_id, is_read, id);
CREATE TABLE IF NOT EXISTS watch_state (
    user_id       TEXT PRIMARY KEY,
    last_signal   TEXT,
    last_as_of    TEXT,
    last_checked  TEXT NOT NULL,
    last_analysis TEXT
);
CREATE TABLE IF NOT EXISTS analysis_runs (
    run_id      TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL,
    as_of       TEXT NOT NULL,
    created_at  TEXT NOT NULL,
    result_json TEXT NOT NULL
);
"""

# Columns added after the first release: (table, column, definition).
_MIGRATIONS = (
    ("users", "checkin_consent", "INTEGER NOT NULL DEFAULT 1"),
    ("feature_sessions", "input_mode", "TEXT"),
)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="microseconds")


@contextmanager
def _connect() -> Iterator[sqlite3.Connection]:
    """Open a short-lived connection; commit on success, roll back on error."""
    settings = get_settings()
    settings.db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(settings.db_path, timeout=30)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def _migrate(conn: sqlite3.Connection) -> None:
    """Add any column that an older database file is missing."""
    for table, column, definition in _MIGRATIONS:
        existing = {row["name"] for row in conn.execute(f"PRAGMA table_info({table})")}
        if column not in existing:
            conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {definition}")
            log.info("Migrated: added %s.%s", table, column)


def init_db() -> None:
    """Create tables if they do not exist yet, then apply migrations."""
    with _connect() as conn:
        conn.executescript(_SCHEMA)
        _migrate(conn)


def _user_row(row: sqlite3.Row | None) -> dict[str, Any] | None:
    if row is None:
        return None
    user = dict(row)
    user["is_synthetic"] = bool(user["is_synthetic"])
    user["checkin_consent"] = bool(user["checkin_consent"])
    return user


def upsert_user(user_id: str, display_name: str, persona: str | None = None, is_synthetic: bool = False) -> None:
    """Create a user, or refresh the name/persona of an existing one (consent is preserved)."""
    init_db()
    with _connect() as conn:
        conn.execute(
            """INSERT INTO users (user_id, display_name, persona, is_synthetic, created_at)
               VALUES (?, ?, ?, ?, ?)
               ON CONFLICT(user_id) DO UPDATE SET
                   display_name=excluded.display_name,
                   persona=excluded.persona,
                   is_synthetic=excluded.is_synthetic""",
            (user_id, display_name, persona, int(is_synthetic), _now()),
        )
    log.info("Upserted user %s (synthetic=%s)", user_id, is_synthetic)


def create_user(display_name: str, checkin_consent: bool = True) -> dict[str, Any]:
    """Create a real (non-synthetic) person with a generated, text-free identifier."""
    name = " ".join(display_name.split())[:60]
    if not name:
        raise ValueError("display_name is required")
    slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")[:24] or "user"
    user_id = f"{slug}-{secrets.token_hex(3)}"
    upsert_user(user_id, name)
    set_checkin_consent(user_id, checkin_consent)
    return get_user(user_id)  # type: ignore[return-value]


def set_checkin_consent(user_id: str, consent: bool) -> None:
    init_db()
    with _connect() as conn:
        conn.execute("UPDATE users SET checkin_consent = ? WHERE user_id = ?", (int(consent), user_id))
    log.info("Check-in consent for %s set to %s", user_id, consent)


def list_users() -> list[dict[str, Any]]:
    init_db()
    with _connect() as conn:
        rows = conn.execute(
            """SELECT u.user_id, u.display_name, u.persona, u.is_synthetic, u.checkin_consent,
                      COUNT(s.session_id) AS session_count,
                      MIN(s.day) AS first_day, MAX(s.day) AS last_day
               FROM users u LEFT JOIN feature_sessions s ON s.user_id = u.user_id
               GROUP BY u.user_id ORDER BY u.is_synthetic, u.display_name"""
        ).fetchall()
    return [_user_row(r) for r in rows]  # type: ignore[misc]


def get_user(user_id: str) -> dict[str, Any] | None:
    init_db()
    with _connect() as conn:
        row = conn.execute("SELECT * FROM users WHERE user_id = ?", (user_id,)).fetchone()
    return _user_row(row)


def delete_user_data(user_id: str) -> dict[str, int]:
    """Erase everything stored for a user (privacy: the right to delete)."""
    init_db()
    with _connect() as conn:
        counts = {
            "feature_sessions": conn.execute("DELETE FROM feature_sessions WHERE user_id = ?", (user_id,)).rowcount,
            "memories": conn.execute("DELETE FROM memories WHERE user_id = ?", (user_id,)).rowcount,
            "analysis_runs": conn.execute("DELETE FROM analysis_runs WHERE user_id = ?", (user_id,)).rowcount,
            "notifications": conn.execute("DELETE FROM notifications WHERE user_id = ?", (user_id,)).rowcount,
            "watch_state": conn.execute("DELETE FROM watch_state WHERE user_id = ?", (user_id,)).rowcount,
            "users": conn.execute("DELETE FROM users WHERE user_id = ?", (user_id,)).rowcount,
        }
    log.info("Deleted data for user %s: %s", user_id, counts)
    return counts


def export_user(user_id: str) -> dict[str, Any]:
    """Everything stored about a user, as plain data (privacy: the right to a copy)."""
    user = get_user(user_id)
    if user is None:
        raise LookupError(f"no user '{user_id}'")
    sessions = fetch_sessions(user_id)
    with _connect() as conn:
        memories = [dict(r) for r in conn.execute(
            "SELECT id, day, kind, text, meta_json, created_at FROM memories WHERE user_id = ? ORDER BY id", (user_id,))]
    for memory in memories:
        memory["meta"] = json.loads(memory.pop("meta_json") or "{}")
    return {"exported_at": _now(), "user": user, "feature_sessions": sessions, "memories": memories,
            "analysis_runs": list_runs(user_id, limit=1000)}


def insert_sessions(payloads: Iterable[dict[str, Any]]) -> int:
    """Insert already-validated payloads (replacing any with the same session_id)."""
    init_db()
    columns = ["session_id", "user_id", "day", "input_mode", *METRIC_KEYS, "keystroke_count", "word_count",
               "created_at"]
    placeholders = ", ".join("?" for _ in columns)
    now = _now()
    rows = [tuple(p.get(c) if c != "created_at" else now for c in columns) for p in payloads]
    with _connect() as conn:
        conn.executemany(
            f"INSERT OR REPLACE INTO feature_sessions ({', '.join(columns)}) VALUES ({placeholders})", rows
        )
    log.info("Stored %d feature session(s)", len(rows))
    return len(rows)


def fetch_sessions(user_id: str, as_of: str | None = None) -> list[dict[str, Any]]:
    """All sessions for a user up to (and including) `as_of`, oldest first."""
    init_db()
    query = "SELECT * FROM feature_sessions WHERE user_id = ?"
    params: list[Any] = [user_id]
    if as_of:
        query += " AND day <= ?"
        params.append(as_of)
    query += " ORDER BY day, session_id"
    with _connect() as conn:
        rows = conn.execute(query, params).fetchall()
    return [dict(r) for r in rows]


def latest_day(user_id: str) -> str | None:
    init_db()
    with _connect() as conn:
        row = conn.execute("SELECT MAX(day) AS d FROM feature_sessions WHERE user_id = ?", (user_id,)).fetchone()
    return row["d"] if row and row["d"] else None


def last_session(user_id: str) -> dict[str, Any] | None:
    """The most recently stored typing session that has timing data (for the Privacy Inspector)."""
    init_db()
    with _connect() as conn:
        row = conn.execute(
            """SELECT * FROM feature_sessions WHERE user_id = ? AND median_flight_ms IS NOT NULL
               ORDER BY day DESC, created_at DESC LIMIT 1""", (user_id,)).fetchone()
    return dict(row) if row else None


def add_memory(user_id: str, day: str, kind: str, text: str, meta: dict[str, Any] | None = None) -> int:
    init_db()
    with _connect() as conn:
        cursor = conn.execute(
            "INSERT INTO memories (user_id, day, kind, text, meta_json, created_at) VALUES (?, ?, ?, ?, ?, ?)",
            (user_id, day, kind, text, json.dumps(meta or {}), _now()),
        )
        memory_id = int(cursor.lastrowid)
    log.info("Stored memory id=%d kind=%s user=%s", memory_id, kind, user_id)
    return memory_id


def get_memories(user_id: str, kind: str, before_day: str | None = None, limit: int = 3) -> list[dict[str, Any]]:
    init_db()
    query = "SELECT * FROM memories WHERE user_id = ? AND kind = ?"
    params: list[Any] = [user_id, kind]
    if before_day:
        query += " AND day < ?"
        params.append(before_day)
    query += " ORDER BY day DESC, id DESC LIMIT ?"
    params.append(limit)
    with _connect() as conn:
        rows = conn.execute(query, params).fetchall()
    result = []
    for row in rows:
        item = dict(row)
        item["meta"] = json.loads(item.pop("meta_json") or "{}")
        result.append(item)
    return result


def get_memory_for_day(user_id: str, kind: str, day: str) -> dict[str, Any] | None:
    """The newest memory of a kind stored for exactly this day (used for the daily check-in cache)."""
    init_db()
    with _connect() as conn:
        row = conn.execute("SELECT * FROM memories WHERE user_id = ? AND kind = ? AND day = ? ORDER BY id DESC LIMIT 1",
                           (user_id, kind, day)).fetchone()
    if row is None:
        return None
    item = dict(row)
    item["meta"] = json.loads(item.pop("meta_json") or "{}")
    return item


def delete_memory(user_id: str, memory_id: int) -> bool:
    """Delete one remembered item. Scoped to the user so ids cannot be guessed across people."""
    init_db()
    with _connect() as conn:
        deleted = conn.execute("DELETE FROM memories WHERE id = ? AND user_id = ?", (memory_id, user_id)).rowcount
    log.info("Deleted memory id=%s for user=%s (deleted=%s)", memory_id, user_id, bool(deleted))
    return bool(deleted)


def save_analysis(run_id: str, user_id: str, as_of: str, result: dict[str, Any]) -> None:
    init_db()
    with _connect() as conn:
        conn.execute(
            "INSERT OR REPLACE INTO analysis_runs (run_id, user_id, as_of, created_at, result_json) VALUES (?,?,?,?,?)",
            (run_id, user_id, as_of, _now(), json.dumps(result)),
        )
    log.info("Saved analysis run %s for user %s", run_id, user_id)


def get_latest_analysis(user_id: str) -> dict[str, Any] | None:
    init_db()
    with _connect() as conn:
        row = conn.execute(
            "SELECT result_json FROM analysis_runs WHERE user_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1",
            (user_id,),
        ).fetchone()
    return json.loads(row["result_json"]) if row else None


def data_fingerprint(user_id: str, as_of: str | None) -> str:
    """A short string that changes whenever the data an analysis would see changes."""
    init_db()
    query = "SELECT COUNT(*) AS n, MAX(created_at) AS newest FROM feature_sessions WHERE user_id = ?"
    params: list[Any] = [user_id]
    if as_of:
        query += " AND day <= ?"
        params.append(as_of)
    with _connect() as conn:
        row = conn.execute(query, params).fetchone()
    return f"{row['n']}:{row['newest']}"


def find_run_by_fingerprint(user_id: str, as_of: str, fingerprint: str,
                            statuses: tuple[str, ...] = ("passed", "template")) -> dict[str, Any] | None:
    """The newest stored run for the same person, day and data whose verification status is acceptable, or None."""
    init_db()
    with _connect() as conn:
        rows = conn.execute("SELECT result_json FROM analysis_runs WHERE user_id = ? AND as_of = ? "
                            "ORDER BY created_at DESC, rowid DESC LIMIT 20", (user_id, as_of)).fetchall()
    for row in rows:
        result = json.loads(row["result_json"])
        if result.get("fingerprint") == fingerprint and result["final"]["verification_status"] in statuses:
            return result
    return None


def get_run(run_id: str) -> dict[str, Any] | None:
    init_db()
    with _connect() as conn:
        row = conn.execute("SELECT result_json FROM analysis_runs WHERE run_id = ?", (run_id,)).fetchone()
    return json.loads(row["result_json"]) if row else None


def list_runs(user_id: str, limit: int = 20) -> list[dict[str, Any]]:
    """Compact history of past runs for a user (newest first)."""
    init_db()
    with _connect() as conn:
        rows = conn.execute(
            "SELECT run_id, as_of, created_at, result_json FROM analysis_runs WHERE user_id = ? "
            "ORDER BY created_at DESC, rowid DESC LIMIT ?", (user_id, limit)).fetchall()
    summaries = []
    for row in rows:
        result = json.loads(row["result_json"])
        final = result.get("final", {})
        summaries.append({
            "run_id": row["run_id"], "as_of": row["as_of"], "created_at": row["created_at"],
            "overall_signal": final.get("overall_signal"), "recommendation": final.get("recommendation"),
            "verification_status": final.get("verification_status"),
            "cost_usd": result.get("usage", {}).get("total_cost_usd", 0.0),
        })
    return summaries


def get_evidence_cache(query_key: str, max_age_days: int = 7) -> list[dict[str, Any]] | None:
    init_db()
    with _connect() as conn:
        row = conn.execute("SELECT fetched_at, results_json FROM evidence_cache WHERE query_key = ?", (query_key,)).fetchone()
    if row is None:
        return None
    age = datetime.now(timezone.utc) - datetime.fromisoformat(row["fetched_at"])
    return json.loads(row["results_json"]) if age.days < max_age_days else None


def put_evidence_cache(query_key: str, results: list[dict[str, Any]]) -> None:
    init_db()
    with _connect() as conn:
        conn.execute("INSERT OR REPLACE INTO evidence_cache (query_key, fetched_at, results_json) VALUES (?,?,?)",
                     (query_key, _now(), json.dumps(results)))


def add_notification(user_id: str, kind: str, title: str, body: str, signal: str | None = None,
                     run_id: str | None = None) -> int:
    init_db()
    with _connect() as conn:
        cursor = conn.execute(
            "INSERT INTO notifications (user_id, created_at, kind, title, body, signal, run_id) VALUES (?,?,?,?,?,?,?)",
            (user_id, _now(), kind, title, body, signal, run_id))
        return int(cursor.lastrowid)


def list_notifications(user_id: str, unread_only: bool = False, limit: int = 20) -> list[dict[str, Any]]:
    init_db()
    query = "SELECT * FROM notifications WHERE user_id = ?" + (" AND is_read = 0" if unread_only else "")
    with _connect() as conn:
        rows = conn.execute(query + " ORDER BY id DESC LIMIT ?", (user_id, limit)).fetchall()
    return [{**dict(r), "is_read": bool(r["is_read"])} for r in rows]


def mark_notification_read(user_id: str, notification_id: int) -> bool:
    init_db()
    with _connect() as conn:
        return bool(conn.execute("UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?",
                                 (notification_id, user_id)).rowcount)


def get_watch_state(user_id: str) -> dict[str, Any] | None:
    init_db()
    with _connect() as conn:
        row = conn.execute("SELECT * FROM watch_state WHERE user_id = ?", (user_id,)).fetchone()
    return dict(row) if row else None


def set_watch_state(user_id: str, signal: str, as_of: str, analysis_at: str | None = None) -> None:
    init_db()
    previous = get_watch_state(user_id)
    with _connect() as conn:
        conn.execute("INSERT OR REPLACE INTO watch_state (user_id, last_signal, last_as_of, last_checked, last_analysis) "
                     "VALUES (?,?,?,?,?)",
                     (user_id, signal, as_of, _now(), analysis_at or (previous or {}).get("last_analysis")))
