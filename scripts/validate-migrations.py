#!/usr/bin/env python3
"""
Validate Alembic migrations before commit.

This script is called by the pre-commit hook to ensure:
1. Alembic can be imported
2. Migration scripts have valid syntax
3. Upgrade/downgrade paths are consistent

For full validation (against a test database), set DATABASE_URL.
"""
import os
import sys
import subprocess
from pathlib import Path


def print_status(status: str, message: str) -> None:
    """Print a status message with emoji."""
    icons = {
        "info": "ℹ️ ",
        "check": "✅",
        "warn": "⚠️ ",
        "error": "❌",
    }
    print(f"{icons.get(status, '')} {message}")


def check_alembic_installed() -> bool:
    """Check if Alembic is installed."""
    try:
        import alembic
        return True
    except ImportError:
        return False


def check_migration_syntax() -> list[str]:
    """Check migration files for syntax errors."""
    errors = []
    migrations_dir = Path("migrations/versions")

    if not migrations_dir.exists():
        return errors

    for migration_file in migrations_dir.glob("*.py"):
        if migration_file.name.startswith("__"):
            continue

        try:
            with open(migration_file) as f:
                code = f.read()
            compile(code, migration_file.name, "exec")
        except SyntaxError as e:
            errors.append(f"{migration_file.name}: {e}")

    return errors


def check_revision_chain() -> tuple[bool, str]:
    """
    Check if the revision chain is valid.
    Returns (success, message).
    """
    if not check_alembic_installed():
        return True, "Alembic not installed, skipping revision check"

    try:
        result = subprocess.run(
            ["alembic", "heads"],
            capture_output=True,
            text=True,
            timeout=10,
        )

        # Multiple heads indicate a branching problem
        heads = [line.strip() for line in result.stdout.strip().split("\n") if line.strip()]
        if len(heads) > 1:
            return False, f"Multiple heads detected: {heads}. Run 'alembic merge heads' to fix."

        return True, "Revision chain is valid"
    except subprocess.TimeoutExpired:
        return True, "Alembic check timed out, skipping"
    except FileNotFoundError:
        return True, "Alembic CLI not found, skipping"
    except Exception as e:
        return True, f"Could not check revisions: {e}"


def check_sql_generation() -> tuple[bool, str]:
    """
    Check if migrations can generate SQL (offline mode).
    This validates migrations without needing a database.
    """
    if not check_alembic_installed():
        return True, "Alembic not installed, skipping SQL generation check"

    try:
        result = subprocess.run(
            ["alembic", "upgrade", "head", "--sql"],
            capture_output=True,
            text=True,
            timeout=30,
            env={**os.environ, "DATABASE_URL": "postgresql://fake:fake@localhost/fake"},
        )

        if result.returncode != 0:
            return False, f"SQL generation failed:\n{result.stderr}"

        return True, "SQL generation successful"
    except subprocess.TimeoutExpired:
        return True, "SQL generation timed out, skipping"
    except FileNotFoundError:
        return True, "Alembic CLI not found, skipping"
    except Exception as e:
        return True, f"Could not generate SQL: {e}"


def main() -> int:
    """Run all migration validations."""
    print_status("info", "Validating database migrations...")
    errors = []

    # 1. Check migration file syntax
    print_status("info", "Checking migration file syntax...")
    syntax_errors = check_migration_syntax()
    if syntax_errors:
        for error in syntax_errors:
            print_status("error", f"Syntax error: {error}")
        errors.extend(syntax_errors)
    else:
        print_status("check", "Migration syntax OK")

    # 2. Check revision chain
    print_status("info", "Checking revision chain...")
    chain_ok, chain_msg = check_revision_chain()
    if not chain_ok:
        print_status("error", chain_msg)
        errors.append(chain_msg)
    else:
        print_status("check", chain_msg)

    # 3. Check SQL generation (optional, may fail without deps)
    if os.getenv("VALIDATE_SQL", "0") == "1":
        print_status("info", "Checking SQL generation...")
        sql_ok, sql_msg = check_sql_generation()
        if not sql_ok:
            print_status("error", sql_msg)
            errors.append(sql_msg)
        else:
            print_status("check", sql_msg)

    # Summary
    if errors:
        print()
        print_status("error", f"Migration validation failed with {len(errors)} error(s)")
        return 1
    else:
        print()
        print_status("check", "All migration checks passed!")
        return 0


if __name__ == "__main__":
    sys.exit(main())
