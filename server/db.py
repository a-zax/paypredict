"""Database models. Every row belongs to an Org (multi-tenant); queries always filter by org_id."""
import os
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Optional

from sqlalchemy import Column, LargeBinary
from sqlmodel import Field, Session, SQLModel, create_engine

ROOT = Path(__file__).resolve().parent.parent
STORAGE = Path(os.environ.get("PAYPREDICT_STORAGE", ROOT / "storage"))
STORAGE.mkdir(parents=True, exist_ok=True)
DATABASE_URL = os.environ.get("DATABASE_URL", f"sqlite:///{STORAGE / 'paypredict.db'}")
if "://" not in DATABASE_URL:
    raise RuntimeError(
        "DATABASE_URL must be the full connection string, e.g. "
        "postgresql://user:password@host/dbname?sslmode=require (copy it from Neon -> Connect), "
        f"not just a host or endpoint id (got '{DATABASE_URL[:40]}').")
if DATABASE_URL.startswith("postgres://"):  # Render/Heroku style URL
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)

def utcnow() -> datetime:
    return datetime.now(timezone.utc)


if DATABASE_URL.startswith("postgresql://"):          # use the psycopg 3 driver
    DATABASE_URL = DATABASE_URL.replace("postgresql://", "postgresql+psycopg://", 1)

engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {},
    pool_pre_ping=True,          # hosted Postgres (Neon) closes idle connections; reconnect transparently
    pool_recycle=300,
)


class Org(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str
    sender_name: str = ""                 # signature on messages
    udyam_registered: bool = True         # enables MSMED Act 45-day levers
    cost_of_capital: float = 0.14         # OD / CC rate p.a.
    treds_rate: float = 0.095             # TReDS discount rate p.a.
    early_pay_discount: float = 0.01
    relationship_first: bool = False
    language: str = "en"                  # default message language: en | hi | mr
    onboarded: bool = False
    created_at: datetime = Field(default_factory=utcnow)
    # --- getting paid & legal notices ---
    upi_id: str = ""                      # e.g. sahyadri@okhdfcbank -> UPI pay links + QR
    udyam_number: str = ""                # UDYAM-MH-26-0012345
    gstin: str = ""
    address: str = ""
    contact_phone: str = ""
    bank_rate: float = 0.0575             # RBI Bank Rate; MSMED s.16 interest = 3x, compounded monthly
    is_demo: bool = False                 # shared public demo business (pay pages never show a real UPI ID)
    demo_reset_at: Optional[datetime] = None


class User(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    org_id: int = Field(foreign_key="org.id", index=True)
    email: str = Field(index=True, unique=True)
    name: str = ""
    password_hash: str
    created_at: datetime = Field(default_factory=utcnow)


class Buyer(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    org_id: int = Field(foreign_key="org.id", index=True)
    name: str = Field(index=True)
    phone: str = ""                       # WhatsApp number incl. country code
    email: str = ""
    contact_person: str = ""
    segment: str = "Unknown"              # optional: Large Corporate / MSME / ...
    is_government: bool = False           # Govt depts: MSMED applies, 43B(h) does not
    treds_onboarded: bool = False


class Invoice(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    org_id: int = Field(foreign_key="org.id", index=True)
    buyer_id: int = Field(foreign_key="buyer.id", index=True)
    number: str
    invoice_date: date
    due_date: date
    amount: float
    paid_date: Optional[date] = None
    disputed: bool = False
    docs_pending: bool = False
    promise_date: Optional[date] = None
    snoozed_until: Optional[date] = None
    # --- model outputs, refreshed by scoring ---
    p_late: Optional[float] = None        # P(paid > 15 days after due | unpaid today)
    exp_days_late: Optional[float] = None
    lo_days_late: Optional[float] = None
    hi_days_late: Optional[float] = None
    action: Optional[str] = None
    rationale: Optional[str] = None
    benefit: Optional[float] = None
    reasons: Optional[str] = None         # JSON list of plain-language reasons
    pmf: Optional[str] = None             # JSON: P(paid in each days-late bin | unpaid today)
    priority: Optional[float] = None
    scored_on: Optional[date] = None
    # --- buyer says "I've paid" from the UPI pay page ---
    claim_at: Optional[datetime] = None
    claim_ref: str = ""                   # UTR / reference the buyer entered


class ActionLog(SQLModel, table=True):
    """Every action taken. Outcomes (paid within 14 days?) drive adaptive escalation + insights."""
    id: Optional[int] = Field(default=None, primary_key=True)
    org_id: int = Field(foreign_key="org.id", index=True)
    invoice_id: int = Field(foreign_key="invoice.id", index=True)
    buyer_id: int = Field(index=True)
    kind: str                             # REMINDER / LEGAL_NUDGE / ... / NOTE / PROMISE / PAID
    channel: str = ""                     # whatsapp / email / call / treds / system
    note: str = ""
    created_at: datetime = Field(default_factory=utcnow)
    created_by: Optional[int] = None
    predicted_days_late: Optional[float] = None   # AI forecast at the moment of acting -> impact tracking
    amount: Optional[float] = None


class ModelRun(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    org_id: int = Field(foreign_key="org.id", index=True)
    kind: str                             # "own" (trained on this org's ledger) | "starter"
    trained_at: datetime = Field(default_factory=utcnow)
    metrics: str = "{}"                   # JSON back-test results


class ModelBlob(SQLModel, table=True):
    """Trained model stored in the database, so it survives restarts on hosts with ephemeral disks."""
    org_id: int = Field(primary_key=True)          # 0 = shared starter model
    data: bytes = Field(sa_column=Column(LargeBinary, nullable=False))
    updated_at: datetime = Field(default_factory=utcnow)


def as_dict(obj: SQLModel) -> dict:
    """model_dump() of a fresh row. After commit SQLAlchemy expires attributes and model_dump()
    reads the raw __dict__, so touch the primary key first to reload them."""
    _ = obj.id
    return obj.model_dump(mode="json")


def _add_missing_columns():
    """Lightweight migration: add columns introduced after a table was created (new features),
    so existing databases upgrade in place without losing data."""
    from sqlalchemy import inspect, text
    insp = inspect(engine)
    with engine.begin() as conn:
        for table in SQLModel.metadata.sorted_tables:
            if not insp.has_table(table.name):
                continue
            existing = {c["name"] for c in insp.get_columns(table.name)}
            for col in table.columns:
                if col.name in existing:
                    continue
                ddl_type = col.type.compile(dialect=engine.dialect)
                default = ""
                if col.default is not None and getattr(col.default, "is_scalar", False):
                    v = col.default.arg
                    lit = ("TRUE" if v else "FALSE") if isinstance(v, bool) else \
                        "'" + v.replace("'", "''") + "'" if isinstance(v, str) else v
                    default = f" DEFAULT {lit}"   # TRUE/FALSE work in both SQLite and Postgres
                conn.execute(text(f'ALTER TABLE "{table.name}" ADD COLUMN "{col.name}" {ddl_type}{default}'))


def init_db():
    SQLModel.metadata.create_all(engine)
    _add_missing_columns()


def get_session():
    with Session(engine) as s:
        yield s
