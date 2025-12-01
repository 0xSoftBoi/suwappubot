from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker, DeclarativeBase, Session
from sqlalchemy.pool import QueuePool
from contextlib import contextmanager
from typing import Generator


class Base(DeclarativeBase):
    """Base class for all database models."""
    pass


# These will be initialized when init_db is called
engine = None
SessionLocal = None


def init_db(database_url: str) -> None:
    """Initialize database connection and create tables."""
    global engine, SessionLocal
    
    connect_args = {}
    is_sqlite = database_url.startswith("sqlite")
    
    if is_sqlite:
        connect_args["check_same_thread"] = False
    
    # Optimized engine settings
    engine = create_engine(
        database_url,
        connect_args=connect_args,
        echo=False,
        pool_pre_ping=True,  # Check connections before use
        pool_size=20 if not is_sqlite else 1,  # Connection pool
        max_overflow=30 if not is_sqlite else 0,  # Extra connections
        pool_recycle=3600,  # Recycle connections hourly
    )
    
    # SQLite optimizations
    if is_sqlite:
        @event.listens_for(engine, "connect")
        def set_sqlite_pragma(dbapi_connection, connection_record):
            cursor = dbapi_connection.cursor()
            cursor.execute("PRAGMA journal_mode=WAL")  # Write-ahead logging
            cursor.execute("PRAGMA synchronous=NORMAL")  # Faster writes
            cursor.execute("PRAGMA cache_size=-64000")  # 64MB cache
            cursor.execute("PRAGMA temp_store=MEMORY")  # Temp tables in memory
            cursor.execute("PRAGMA mmap_size=268435456")  # 256MB memory map
            cursor.close()
    
    SessionLocal = sessionmaker(
        autocommit=False, 
        autoflush=False, 
        bind=engine,
        expire_on_commit=False,  # Don't expire objects after commit (faster)
    )
    
    # Import models to ensure they're registered with Base
    from bot.models.user import User, Wallet
    from bot.models.swap import SwapTransaction
    
    # Create all tables
    Base.metadata.create_all(bind=engine)


@contextmanager
def get_session() -> Generator[Session, None, None]:
    """Get a database session with automatic cleanup."""
    if SessionLocal is None:
        raise RuntimeError("Database not initialized. Call init_db first.")
    
    session = SessionLocal()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()

