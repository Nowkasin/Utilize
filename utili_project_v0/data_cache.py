import os
import pandas as pd

from sqlalchemy import create_engine, text
from dotenv import load_dotenv
from urllib.parse import quote_plus

from config import SHEET_NAMES, COLS

load_dotenv()

# ----------------- ENV & ENGINE ----------------- #

MAIN_DB_BACKEND = os.getenv("MAIN_DB_BACKEND", "postgres").lower()
MAIN_HOST = os.getenv("SERVER_NAME3")
MAIN_DB = os.getenv("DATABASE_NAME3")
MAIN_USER = os.getenv("USERNAME3")
MAIN_PASSWORD = os.getenv("PASSWORD3")
MAIN_PORT = os.getenv("PG_PORT", "5432")

HIS_DB_BACKEND = os.getenv("HIS_DB_BACKEND", "mssql").lower()
HIS_SERVER = os.getenv("SERVER_NAME2")
HIS_DB = os.getenv("DATABASE_NAME2")
HIS_USER = os.getenv("USERNAME2")
HIS_PASSWORD = os.getenv("PASSWORD2")
HIS_DB_DRIVER = os.getenv("DB_DRIVER", "ODBC Driver 17 for SQL Server")

GLOBAL_CACHE = {
    "bme_map": None,
    "his_map": None,
    "his_name_map": None,
    "cost_map": None,
    "df_sap": None,
    "df_pacs": None,
}

_MAIN_ENGINE = None
_HIS_ENGINE = None

# ----------------- HELPERS ----------------- #


def quote_main_col(col_name: str) -> str:
    if MAIN_DB_BACKEND == "postgres":
        return f'"{col_name}"'
    return f"[{col_name}]"


def quote_his_col(col_name: str) -> str:
    if HIS_DB_BACKEND == "postgres":
        return f'"{col_name}"'
    return f"[{col_name}]"


def _build_mssql_odbc_str(
    server: str,
    db: str,
    user: str,
    password: str,
    driver: str,
) -> str:
    return (
        "DRIVER={" + driver + "};"
        f"SERVER={server};"
        f"DATABASE={db};"
        f"UID={user};"
        f"PWD={password};"
        "Encrypt=no;"
        "TrustServerCertificate=yes;"
    )


def get_main_engine():
    global _MAIN_ENGINE
    if _MAIN_ENGINE is not None:
        return _MAIN_ENGINE

    if MAIN_DB_BACKEND == "postgres":
        if not all([MAIN_HOST, MAIN_DB, MAIN_USER, MAIN_PASSWORD]):
            raise RuntimeError("MAIN (Postgres) settings missing.")
        url = (
            f"postgresql+psycopg2://{MAIN_USER}:{quote_plus(MAIN_PASSWORD)}"
            f"@{MAIN_HOST}:{MAIN_PORT}/{MAIN_DB}"
        )
        print(f"[MAIN] Connecting Postgres {MAIN_HOST}:{MAIN_PORT}, DB={MAIN_DB}")
        _MAIN_ENGINE = create_engine(url)
    elif MAIN_DB_BACKEND == "mssql":
        if not all([MAIN_HOST, MAIN_DB, MAIN_USER, MAIN_PASSWORD]):
            raise RuntimeError("MAIN (SQL Server) settings missing.")
        driver = HIS_DB_DRIVER or "ODBC Driver 17 for SQL Server"
        odbc_str = _build_mssql_odbc_str(MAIN_HOST, MAIN_DB, MAIN_USER, MAIN_PASSWORD, driver)
        odbc_enc = quote_plus(odbc_str)
        url = f"mssql+pyodbc:///?odbc_connect={odbc_enc}"
        print(f"[MAIN] Connecting SQL Server {MAIN_HOST}, DB={MAIN_DB}, DRIVER={driver}")
        _MAIN_ENGINE = create_engine(url)
    else:
        raise RuntimeError(f"Unknown MAIN_DB_BACKEND: {MAIN_DB_BACKEND}")

    return _MAIN_ENGINE


def get_his_engine():
    global _HIS_ENGINE
    if _HIS_ENGINE is not None:
        return _HIS_ENGINE

    if HIS_DB_BACKEND == "mssql":
        if not all([HIS_SERVER, HIS_DB, HIS_USER, HIS_PASSWORD]):
            raise RuntimeError("HIS (SQL Server) settings missing.")
        driver = HIS_DB_DRIVER or "ODBC Driver 17 for SQL Server"
        odbc_str = _build_mssql_odbc_str(HIS_SERVER, HIS_DB, HIS_USER, HIS_PASSWORD, driver)
        odbc_enc = quote_plus(odbc_str)
        url = f"mssql+pyodbc:///?odbc_connect={odbc_enc}"
        print(f"[HIS] Connecting SQL Server {HIS_SERVER}, DB={HIS_DB}, DRIVER={driver}")
        _HIS_ENGINE = create_engine(url)
    elif HIS_DB_BACKEND == "postgres":
        if not all([HIS_SERVER, HIS_DB, HIS_USER, HIS_PASSWORD]):
            raise RuntimeError("HIS (Postgres) settings missing.")
        his_port = os.getenv("HIS_DB_PORT", "5432")
        url = (
            f"postgresql+psycopg2://{HIS_USER}:{quote_plus(HIS_PASSWORD)}"
            f"@{HIS_SERVER}:{his_port}/{HIS_DB}"
        )
        print(f"[HIS] Connecting Postgres {HIS_SERVER}:{his_port}, DB={HIS_DB}")
        _HIS_ENGINE = create_engine(url)
    else:
        raise RuntimeError(f"Unknown HIS_DB_BACKEND: {HIS_DB_BACKEND}")

    return _HIS_ENGINE


def resolve_main_table(logical_key: str) -> str:
    """
    หาตารางจริงจาก logical key ใน SHEET_NAMES (ใช้กับ MAIN DB = Postgres)
    """
    engine = get_main_engine()
    configured = SHEET_NAMES[logical_key]  # เช่น 'public.UTILIZE_BME'

    if "." in configured:
        schema_hint, name_hint = configured.split(".", 1)
    else:
        schema_hint, name_hint = None, configured

    with engine.connect() as conn:
        row = conn.execute(
            text(
                """
                SELECT table_schema, table_name
                FROM information_schema.tables
                WHERE table_catalog = current_database()
                  AND lower(table_name) = lower(:tname)
                  AND (:tschema IS NULL OR lower(table_schema) = lower(:tschema))
                ORDER BY table_schema
                LIMIT 1
                """
            ),
            {"tname": name_hint, "tschema": schema_hint},
        ).fetchone()

    if not row:
        raise RuntimeError(
            f"ไม่พบตาราง '{configured}' (logical='{logical_key}') ใน MAIN Postgres."
        )

    schema, tname = row
    return f'"{schema}"."{tname}"'


# ----------------- BUILD MAPS ----------------- #


def build_his_map():
    engine = get_his_engine()
    table = SHEET_NAMES["HIS"]
    query = f"""
        SELECT
            {quote_his_col(COLS['HIS_SERVICE_CODE'])}  AS service_code,
            {quote_his_col(COLS['HIS_SERVICE_PRICE'])} AS service_price
        FROM {table}
    """
    df = pd.read_sql(query, engine)
    df["service_code"] = df["service_code"].astype(str).str.strip()
    df["service_price"] = pd.to_numeric(df["service_price"], errors="coerce").fillna(0)
    return pd.Series(df["service_price"].values, index=df["service_code"]).to_dict()


def build_his_name_map():
    engine = get_his_engine()
    table = SHEET_NAMES["HIS"]
    query = f"""
        SELECT
            {quote_his_col(COLS['HIS_SERVICE_CODE'])} AS service_code,
            {quote_his_col(COLS['HIS_SERVICE_NAME'])} AS service_name
        FROM {table}
    """
    df = pd.read_sql(query, engine)
    df["service_code"] = df["service_code"].astype(str).str.strip()
    df["service_name"] = df["service_name"].astype(str).fillna("N/A")
    return pd.Series(df["service_name"].values, index=df["service_code"]).to_dict()


def build_cost_map():
    engine = get_main_engine()
    table = resolve_main_table("COST")
    query = f"""
        SELECT
            {quote_main_col(COLS['COST_SERVICE_CODE'])} AS service_code,
            {quote_main_col(COLS['COST_GRAND_COST'])}  AS grand_cost
        FROM {table}
    """
    df = pd.read_sql(query, engine)
    df["service_code"] = df["service_code"].astype(str).str.strip()
    df["grand_cost"] = pd.to_numeric(df["grand_cost"], errors="coerce").fillna(0)
    return pd.Series(df["grand_cost"].values, index=df["service_code"]).to_dict()


def build_bme_map():
    engine = get_main_engine()
    table = resolve_main_table("BME")
    query = f"""
        SELECT
            {quote_main_col(COLS['BME_AE_TITLE'])} AS ae_title,
            {quote_main_col(COLS['BME_PRICE'])}    AS capex,
            {quote_main_col(COLS['BME_DEPYEAR'])}  AS depyears,
            {quote_main_col(COLS['BME_ORDER'])}    AS order_num,
            {quote_main_col(COLS['BME_NAME'])}     AS bme_name,
            {quote_main_col(COLS['BME_BRAND'])}    AS bme_brand,
            {quote_main_col(COLS['BME_MODEL'])}    AS bme_model,
            {quote_main_col(COLS['BME_DATE'])}     AS installdate
        FROM {table}
    """
    df = pd.read_sql(query, engine)
    df.columns = [c.lower() for c in df.columns]

    df["ae_title_clean"] = df["ae_title"].astype(str).str.strip()
    df["capEx"] = pd.to_numeric(df["capex"], errors="coerce")
    df["depYears"] = pd.to_numeric(df["depyears"], errors="coerce")
    df["installDate"] = pd.to_datetime(df["installdate"], errors="coerce")

    # ตัด AE Title ที่ไม่ใช่ค่าจริง เช่น none / nan / null / na (ตัวหนังสือ)
    invalid_ae = df["ae_title_clean"].str.lower().isin(["none", "nan", "null", "na"])

    mask = (
        df["ae_title_clean"].ne("")
        & ~invalid_ae
        & df["capEx"].notna()
        & (df["capEx"] > 0)
        & df["depYears"].notna()
        & (df["depYears"] > 0)
    )
    df_valid = df[mask].copy()

    df_valid["depMonths"] = (df_valid["depYears"] * 12).astype(int)
    df_valid["monthlyDep"] = df_valid["capEx"] / df_valid["depMonths"]

    bme_map = {}
    for _, row in df_valid.iterrows():
        ae_title = row["ae_title_clean"]
        install_date = row["installDate"]

        bme_map[ae_title] = {
            "capEx": float(row["capEx"]),
            "monthlyDep": float(row["monthlyDep"]),
            "depMonths": int(row["depMonths"]),
            "orderNum": str(row["order_num"]).strip() if row["order_num"] is not None else "",
            "bmeName": str(row["bme_name"]).strip() if row["bme_name"] is not None else "",
            "brand": str(row["bme_brand"]).strip() if row["bme_brand"] is not None else "",
            "model": str(row["bme_model"]).strip() if row["bme_model"] is not None else "",
            "installDate": install_date.isoformat() if pd.notna(install_date) else None,
        }

    return bme_map


# ----------------- CORE: LOAD ALL MAPS/DFS ----------------- #


def get_lookup_maps():
    """
    โหลด map + DataFrame ทั้งหมดเข้า GLOBAL_CACHE ครั้งแรก
    ถ้า HIS ต่อไม่ได้ → his_map / his_name_map จะเป็น {} แต่ระบบยังทำงานต่อได้
    """
    if GLOBAL_CACHE["bme_map"] is None:
        print("Loading lookup maps and dataframes into cache from databases...")

        # 1) MAIN (จำเป็น): BME
        GLOBAL_CACHE["bme_map"] = build_bme_map()

        # 2) HIS (ถ้ามีปัญหาก็แค่เตือนแล้วใช้ {} แทน)
        try:
            GLOBAL_CACHE["his_map"] = build_his_map()
            GLOBAL_CACHE["his_name_map"] = build_his_name_map()
        except Exception as e:
            print("!! WARNING: โหลดข้อมูลจาก HIS DB ไม่สำเร็จ (ราคาหัตถการ + ชื่อหัตถการ จะว่าง/เป็นศูนย์) !!")
            print("   Detail:", e)
            GLOBAL_CACHE["his_map"] = {}
            GLOBAL_CACHE["his_name_map"] = {}

        # 3) COST (ถ้าพัง ให้เป็น {} ไปก่อน)
        try:
            GLOBAL_CACHE["cost_map"] = build_cost_map()
        except Exception as e:
            print("!! WARNING: โหลด COST_MAP จาก UTILIZE_COST_XRAY ไม่สำเร็จ, จะไม่ใช้ต้นทุน !!")
            print("   Detail:", e)
            GLOBAL_CACHE["cost_map"] = {}

        # 4) SAP & PACS จาก MAIN
        engine = get_main_engine()

        # ---- SAP ----
        print("Caching SAP DataFrame...")
        sap_table = resolve_main_table("SAP")
        sap_query = f"""
            SELECT
                {quote_main_col(COLS['SAP_BME_ORDER'])} AS bme_order,
                {quote_main_col(COLS['SAP_DATE'])}      AS posting_date,
                {quote_main_col(COLS['SAP_PRICE'])}     AS price
            FROM {sap_table}
        """
        df_sap = pd.read_sql(sap_query, engine)
        df_sap["bme_order"] = df_sap["bme_order"].astype(str).str.strip()
        GLOBAL_CACHE["df_sap"] = df_sap

        # ---- PACS (aggregate ตาม ae_title + service_code + ปี-เดือน ของ exam_date) ----
        print("Caching PACS DataFrame (aggregated by month)...")
        pacs_table = resolve_main_table("PACS")

        ae_col = quote_main_col(COLS["PACS_AE_TITLE"])
        svc_col = quote_main_col(COLS["PACS_SERVICE_CODE"])
        exam_col = quote_main_col(COLS["PACS_EXAM_DATE"])

        # year_month = CAST(EXTRACT(YEAR FROM exam_date) AS CHAR(4)) || '-' ||
        #              RIGHT('0' || CAST(EXTRACT(MONTH FROM exam_date) AS CHAR(2)), 2)
        year_month_expr = (
            f"CAST(EXTRACT(YEAR FROM {exam_col}) AS CHAR(4)) || '-' || "
            f"RIGHT('0' || CAST(EXTRACT(MONTH FROM {exam_col}) AS CHAR(2)), 2)"
        )

        pacs_query = f"""
            SELECT
                {ae_col}  AS ae_title,
                {svc_col} AS service_code,
                {year_month_expr} AS year_month,
                COUNT(*) AS order_qty
            FROM {pacs_table}
            WHERE {exam_col} IS NOT NULL
            GROUP BY
                {ae_col},
                {svc_col},
                {year_month_expr}
        """
        df_pacs = pd.read_sql(pacs_query, engine)

        # ทำความสะอาดค่าหลัก ๆ
        df_pacs["ae_title"] = df_pacs["ae_title"].astype(str).str.strip()
        df_pacs["service_code"] = df_pacs["service_code"].astype(str).str.strip()
        df_pacs["year_month"] = df_pacs["year_month"].astype(str)
        df_pacs["order_qty"] = pd.to_numeric(df_pacs["order_qty"], errors="coerce").fillna(0)

        # กันข้อมูลซ้ำอีกชั้น (ถ้ามี) ให้เหลือ 1 row / (ae_title, service_code, year_month)
        df_pacs = (
            df_pacs
            .groupby(["ae_title", "service_code", "year_month"], as_index=False)["order_qty"]
            .sum()
        )

        GLOBAL_CACHE["df_pacs"] = df_pacs

        print("Cache loaded from databases.")

    return GLOBAL_CACHE
