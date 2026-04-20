import sqlite3
import json
import os
import shutil
from datetime import datetime


class Database:
    def __init__(self, data_dir=None):
        if data_dir is None:
            base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
            self.data_dir = os.path.join(base_dir, 'data')
        else:
            self.data_dir = data_dir

        os.makedirs(self.data_dir, exist_ok=True)
        self.db_path = os.path.join(self.data_dir, 'member2.db')
        self._init_db()

    # ─────────────────────────── connection helper ───────────────────────────

    def _conn(self):
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA foreign_keys=ON")
        return conn

    # ───────────────────────────── schema setup ──────────────────────────────

    def _init_db(self):
        with self._conn() as conn:
            conn.executescript("""
                CREATE TABLE IF NOT EXISTS members (
                    id       TEXT PRIMARY KEY,
                    short_id TEXT,
                    category TEXT DEFAULT 'General',
                    data     TEXT NOT NULL DEFAULT '{}'
                );

                CREATE TABLE IF NOT EXISTS schema_fields (
                    id         TEXT PRIMARY KEY,
                    label      TEXT NOT NULL,
                    type       TEXT NOT NULL DEFAULT 'text',
                    sort_order INTEGER DEFAULT 0
                );

                CREATE TABLE IF NOT EXISTS categories (
                    name TEXT PRIMARY KEY
                );

                CREATE TABLE IF NOT EXISTS settings (
                    key   TEXT PRIMARY KEY,
                    value TEXT NOT NULL
                );
            """)

            cur = conn.execute("SELECT COUNT(*) FROM schema_fields")
            if cur.fetchone()[0] == 0:
                conn.executemany(
                    "INSERT OR IGNORE INTO schema_fields (id, label, type, sort_order) VALUES (?,?,?,?)",
                    [("name", "Name", "text", 0), ("dob", "Date of Birth", "date", 1)]
                )

            cur = conn.execute("SELECT COUNT(*) FROM categories")
            if cur.fetchone()[0] == 0:
                conn.execute("INSERT OR IGNORE INTO categories (name) VALUES ('General')")

            cur = conn.execute("SELECT COUNT(*) FROM settings")
            if cur.fetchone()[0] == 0:
                defaults = [
                    ("theme", "dark"),
                    ("default_category", "General"),
                    ("date_format", "YYYY-MM-DD"),
                ]
                conn.executemany("INSERT OR IGNORE INTO settings (key, value) VALUES (?,?)", defaults)

    # ─────────────────────────────── members ─────────────────────────────────

    def get_members(self):
        with self._conn() as conn:
            rows = conn.execute(
                "SELECT id, short_id, category, data FROM members"
            ).fetchall()
        result = []
        for row in rows:
            member = json.loads(row["data"])
            member["id"] = row["id"]
            member["short_id"] = row["short_id"]
            member["category"] = row["category"]
            result.append(member)
        return result

    def save_member(self, member):
        member = dict(member)
        member_id = member.get("id")
        short_id = member.get("short_id")
        category = member.get("category", "General")

        blob_keys = {k: v for k, v in member.items()
                     if k not in ("id", "short_id", "category")}
        data_json = json.dumps(blob_keys)

        with self._conn() as conn:
            conn.execute("""
                INSERT INTO members (id, short_id, category, data)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    short_id = excluded.short_id,
                    category = excluded.category,
                    data     = excluded.data
            """, (member_id, short_id, category, data_json))
        return True

    def save_members_bulk(self, new_members):
        try:
            for m in new_members:
                self.save_member(m)
            return True
        except Exception as e:
            print(f"Bulk save error: {e}")
            return False

    def delete_member(self, member_id):
        with self._conn() as conn:
            conn.execute("DELETE FROM members WHERE id = ?", (member_id,))
        return True

    # ─────────────────────────────── schema ──────────────────────────────────

    def get_schema(self):
        with self._conn() as conn:
            rows = conn.execute(
                "SELECT id, label, type FROM schema_fields ORDER BY sort_order"
            ).fetchall()
        return [{"id": r["id"], "label": r["label"], "type": r["type"]} for r in rows]

    def save_schema(self, schema):
        with self._conn() as conn:
            conn.execute("DELETE FROM schema_fields")
            conn.executemany(
                "INSERT INTO schema_fields (id, label, type, sort_order) VALUES (?,?,?,?)",
                [(f["id"], f["label"], f.get("type", "text"), i)
                 for i, f in enumerate(schema)]
            )
        return True

    # ────────────────────────────── categories ───────────────────────────────

    def get_categories(self):
        with self._conn() as conn:
            rows = conn.execute("SELECT name FROM categories ORDER BY name").fetchall()
        return [r["name"] for r in rows]

    def save_categories(self, categories):
        with self._conn() as conn:
            conn.execute("DELETE FROM categories")
            conn.executemany(
                "INSERT INTO categories (name) VALUES (?)",
                [(c,) for c in categories]
            )
        return True

    def delete_category(self, category_name):
        with self._conn() as conn:
            cur = conn.execute(
                "SELECT COUNT(*) FROM categories WHERE name = ?", (category_name,)
            )
            if cur.fetchone()[0] == 0:
                return False
            conn.execute("DELETE FROM categories WHERE name = ?", (category_name,))
            conn.execute(
                "UPDATE members SET category = 'Uncategorized' WHERE category = ?",
                (category_name,)
            )
        return True

    # ──────────────────────────────── settings ───────────────────────────────

    def get_settings(self):
        with self._conn() as conn:
            rows = conn.execute("SELECT key, value FROM settings").fetchall()
        return {r["key"]: r["value"] for r in rows}

    def save_settings(self, settings):
        with self._conn() as conn:
            conn.executemany(
                "INSERT INTO settings (key, value) VALUES (?,?) "
                "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                [(k, v) for k, v in settings.items()]
            )
        return True

    # ──────────────────────────────── backups ────────────────────────────────

    def backup_data(self, backup_type='manual'):
        backup_id = "auto_backup" if backup_type == "auto" else "manual_backup"
        backup_dir = os.path.join(self.data_dir, 'backups', backup_id)
        os.makedirs(backup_dir, exist_ok=True)

        dest = os.path.join(backup_dir, 'member2.db')
        src_conn = sqlite3.connect(self.db_path)
        dst_conn = sqlite3.connect(dest)
        try:
            src_conn.backup(dst_conn)
        finally:
            dst_conn.close()
            src_conn.close()

        return backup_id

    def get_backups(self):
        backups_dir = os.path.join(self.data_dir, 'backups')
        if not os.path.exists(backups_dir):
            return []
        return sorted(
            [d for d in os.listdir(backups_dir)
             if os.path.isdir(os.path.join(backups_dir, d))],
            reverse=True
        )

    def restore_backup(self, backup_id):
        backup_db = os.path.join(self.data_dir, 'backups', backup_id, 'member2.db')
        if not os.path.exists(backup_db):
            return False
        try:
            src_conn = sqlite3.connect(backup_db)
            dst_conn = sqlite3.connect(self.db_path)
            src_conn.backup(dst_conn)
            dst_conn.close()
            src_conn.close()
            return True
        except Exception as e:
            print(f"Restore failed: {e}")
            return False

    def delete_backup(self, backup_id):
        backup_dir = os.path.join(self.data_dir, 'backups', backup_id)
        if not os.path.exists(backup_dir):
            return False
        try:
            shutil.rmtree(backup_dir)
            return True
        except Exception as e:
            print(f"Delete backup failed: {e}")
            return False
