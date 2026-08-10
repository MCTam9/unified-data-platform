#!/usr/bin/env python3
"""Apply the DDL files in db/ddl/ in order, idempotently.

Layer 3 tool: deterministic, flag-and-exit-code contract.
  exit 0 — all files applied
  exit 1 — a file failed; nothing after it was applied

Usage:
  python tools/db/migrate.py [--dsn DSN] [--ddl-dir db/ddl]
"""
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

import psycopg

DEFAULT_DSN = os.environ.get(
    "DATABASE_URL",
    "postgresql://platform_admin:platform_admin_dev@localhost:5433/platform",
)
REPO_ROOT = Path(__file__).resolve().parents[2]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dsn", default=DEFAULT_DSN, help="Postgres DSN (or set DATABASE_URL)")
    parser.add_argument("--ddl-dir", default=str(REPO_ROOT / "db" / "ddl"),
                        help="Directory of numbered .sql files")
    args = parser.parse_args()

    ddl_dir = Path(args.ddl_dir)
    files = sorted(ddl_dir.glob("*.sql"))
    if not files:
        print(f"error: no .sql files found in {ddl_dir}", file=sys.stderr)
        return 1

    try:
        with psycopg.connect(args.dsn) as conn:
            for path in files:
                sql = path.read_text()
                try:
                    conn.execute(sql)
                    conn.commit()
                    print(f"applied  {path.name}")
                except Exception as exc:
                    conn.rollback()
                    print(f"FAILED   {path.name}: {exc}", file=sys.stderr)
                    return 1
    except psycopg.OperationalError as exc:
        print(f"error: cannot connect to {args.dsn}: {exc}", file=sys.stderr)
        return 1

    print("migrate: ok")
    return 0


if __name__ == "__main__":
    sys.exit(main())
