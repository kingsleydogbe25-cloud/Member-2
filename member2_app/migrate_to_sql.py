"""
migrate_to_sql.py
-----------------
One-shot migration: reads the old JSON files from data/ and imports
them into the new SQLite database (data/member2.db).

Run once from the project root:
    python migrate_to_sql.py
"""

import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from backend.database import Database


def load_json(path, default):
    if os.path.exists(path):
        try:
            with open(path, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            print(f"  Warning: could not read {path}: {e}")
    return default


def main():
    data_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")

    members_path    = os.path.join(data_dir, "members.json")
    schema_path     = os.path.join(data_dir, "schema.json")
    categories_path = os.path.join(data_dir, "categories.json")
    settings_path   = os.path.join(data_dir, "settings.json")

    print("=== Member2 → SQLite Migration ===")

    # Initialise DB (creates tables / seeds defaults)
    db = Database(data_dir=data_dir)

    # --- schema ---
    schema = load_json(schema_path, None)
    if schema:
        db.save_schema(schema)
        print(f"  Schema: {len(schema)} fields imported")

    # --- categories ---
    categories = load_json(categories_path, None)
    if categories:
        db.save_categories(categories)
        print(f"  Categories: {categories}")

    # --- settings ---
    settings = load_json(settings_path, None)
    if settings and isinstance(settings, dict):
        db.save_settings(settings)
        print(f"  Settings: {list(settings.keys())}")

    # --- members ---
    members = load_json(members_path, [])
    if members:
        db.save_members_bulk(members)
        print(f"  Members: {len(members)} records imported")
    else:
        print("  Members: none found (empty JSON or file missing)")

    print(f"\nDone. Database saved to: {db.db_path}")
    print("You can now delete the old .json files if everything looks correct.")


if __name__ == "__main__":
    main()
