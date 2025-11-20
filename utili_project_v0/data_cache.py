import os
import pandas as pd

from sqlalchemy import create_engine
from dotenv import load_dotenv
from urllib.parse import quote_plus  # ใช้สำหรับ encode ODBC connection string

from config import SHEET_NAMES, COLS

# โหลดตัวแปรจาก .env
load_dotenv()

# MAIN DB (เช่น CHHOSPITAL) – สำหรับ PACS, COST, BME, SAP
MAIN_SERVER = os.getenv("SERVER_NAME3")
MAIN_DB = os.getenv("DATABASE_NAME3")
MAIN_USER = os.getenv("USERNAME3")
MAIN_PASSWORD = os.getenv("PASSWORD3")

# HIS DB (DATALAKEHOUSE) – สำหรับ HIS_MASTER_TREATMENT_CODE
# ถ้าไม่ตั้ง SERVER_NAME2 / DATABASE_NAME2 จะ fallback ไปใช้ค่า MAIN
HIS_SERVER = os.getenv("SERVER_NAME2", MAIN_SERVER)
HIS_DB = os.getenv("DATABASE_NAME2", MAIN_DB)
HIS_USER = os.getenv("USERNAME2", MAIN_USER)
HIS_PASSWORD = os.getenv("PASSWORD2", MAIN_PASSWORD)

# ชื่อ driver ปรับได้ตามที่ติดตั้งบนเครื่อง
# ถ้าไม่กำหนดใน .env จะใช้ "ODBC Driver 17 for SQL Server"
DB_DRIVER = os.getenv("DB_DRIVER", "ODBC Driver 17 for SQL Server")

# Global cache
GLOBAL_CACHE = {
    'bme_map': None,
    'his_map': None,
    'his_name_map': None,
    'cost_map': None,
    'df_sap': None,
    'df_pacs': None
}

_MAIN_ENGINE = None
_HIS_ENGINE = None


def _quote_col(col_name: str) -> str:
    """
    ห่อชื่อคอลัมน์ด้วย [] สำหรับ SQL Server
    รองรับกรณีชื่อคอลัมน์มี space / จุด / เป็นคำสงวน เช่น Order, Posting Date, Val.in rep.cur.
    """
    return f"[{col_name}]"


def _make_engine(server: str, db: str, user: str, password: str, label: str):
    """
    สร้าง SQLAlchemy engine สำหรับ server/db ที่กำหนด
    label เอาไว้ log ให้รู้ว่าเป็น MAIN หรือ HIS
    """
    if not all([server, db, user, password]):
        raise RuntimeError(
            f"[{label}] Database connection settings missing. "
            f"กรุณาเช็ค SERVER_NAME*/DATABASE_NAME*/USERNAME*/PASSWORD* ใน .env"
        )

    # สร้าง ODBC connection string แบบ DSN-less
    odbc_str = (
        f"DRIVER={{{DB_DRIVER}}};"
        f"SERVER={server};"
        f"DATABASE={db};"
        f"UID={user};"
        f"PWD={password};"
        "Encrypt=no;"
        "TrustServerCertificate=yes;"
    )

    # encode ให้ใช้กับ SQLAlchemy ได้
    odbc_enc = quote_plus(odbc_str)
    conn_str = f"mssql+pyodbc:///?odbc_connect={odbc_enc}"

    print(f"[{label}] Connecting to SQL Server at {server}, DB={db}, DRIVER={DB_DRIVER}")
    return create_engine(conn_str)


def get_main_engine():
    """engine สำหรับ PACS / COST / BME / SAP"""
    global _MAIN_ENGINE
    if _MAIN_ENGINE is None:
        _MAIN_ENGINE = _make_engine(MAIN_SERVER, MAIN_DB, MAIN_USER, MAIN_PASSWORD, "MAIN")
    return _MAIN_ENGINE


def get_his_engine():
    """engine สำหรับ HIS_MASTER_TREATMENT_CODE (HIS DB)"""
    global _HIS_ENGINE
    if _HIS_ENGINE is None:
        _HIS_ENGINE = _make_engine(HIS_SERVER, HIS_DB, HIS_USER, HIS_PASSWORD, "HIS")
    return _HIS_ENGINE


def build_his_map():
    """อ่านข้อมูลราคาหัตถการจากตาราง HIS → {service_code: price}"""
    engine = get_his_engine()
    table = SHEET_NAMES['HIS']  # 'HIS_MASTER_TREATMENT_CODE'

    query = f"""
        SELECT
            {_quote_col(COLS['HIS_SERVICE_CODE'])} AS service_code,
            {_quote_col(COLS['HIS_SERVICE_PRICE'])} AS service_price
        FROM {table}
    """
    df = pd.read_sql(query, engine)

    df['service_code'] = df['service_code'].astype(str).str.strip()
    df['service_price'] = pd.to_numeric(df['service_price'], errors='coerce').fillna(0)

    return pd.Series(
        df['service_price'].values,
        index=df['service_code']
    ).to_dict()


def build_his_name_map():
    """อ่านชื่อหัตถการจาก HIS → {service_code: service_name}"""
    engine = get_his_engine()
    table = SHEET_NAMES['HIS']

    query = f"""
        SELECT
            {_quote_col(COLS['HIS_SERVICE_CODE'])} AS service_code,
            {_quote_col(COLS['HIS_SERVICE_NAME'])} AS service_name
        FROM {table}
    """
    df = pd.read_sql(query, engine)

    df['service_code'] = df['service_code'].astype(str).str.strip()
    df['service_name'] = df['service_name'].astype(str).fillna('N/A')

    return pd.Series(
        df['service_name'].values,
        index=df['service_code']
    ).to_dict()


def build_cost_map():
    """อ่านต้นทุนหัตถการจาก COST → {service_code: cost}"""
    engine = get_main_engine()
    table = SHEET_NAMES['COST']

    query = f"""
        SELECT
            {_quote_col(COLS['COST_SERVICE_CODE'])} AS service_code,
            {_quote_col(COLS['COST_GRAND_COST'])} AS grand_cost
        FROM {table}
    """
    df = pd.read_sql(query, engine)

    df['service_code'] = df['service_code'].astype(str).str.strip()
    df['grand_cost'] = pd.to_numeric(df['grand_cost'], errors='coerce').fillna(0)

    return pd.Series(
        df['grand_cost'].values,
        index=df['service_code']
    ).to_dict()


def build_bme_map():
    """
    อ่านข้อมูลเครื่องมือแพทย์จาก BME → {ae_title: {...รายละเอียด...}}
    โครงสร้าง return ให้เหมือนเดิม เพื่อให้ frontend ทำงานต่อได้
    """
    engine = get_main_engine()
    table = SHEET_NAMES['BME']

    # เลือกเฉพาะคอลัมน์ที่ใช้จริง
    query = f"""
        SELECT
            {_quote_col(COLS['BME_AE_TITLE'])} AS ae_title,
            {_quote_col(COLS['BME_PRICE'])} AS capEx,
            {_quote_col(COLS['BME_DEPYEAR'])} AS depYears,
            {_quote_col(COLS['BME_ORDER'])} AS order_num,
            {_quote_col(COLS['BME_NAME'])} AS bme_name,
            {_quote_col(COLS['BME_BRAND'])} AS bme_brand,
            {_quote_col(COLS['BME_MODEL'])} AS bme_model,
            {_quote_col(COLS['BME_DATE'])} AS installDate
        FROM {table}
    """
    df = pd.read_sql(query, engine)

    # เตรียมคอลัมน์พื้นฐาน
    df['ae_title_clean'] = df['ae_title'].astype(str).str.strip()
    df['capEx'] = pd.to_numeric(df['capEx'], errors='coerce')
    df['depYears'] = pd.to_numeric(df['depYears'], errors='coerce')
    df['installDate'] = pd.to_datetime(df['installDate'], errors='coerce')

    # เงื่อนไขกรอง row ที่ข้อมูลไม่ครบ/ไม่สมเหตุสมผล
    mask = (
        df['ae_title_clean'].ne('') &
        df['capEx'].notna() & (df['capEx'] > 0) &
        df['depYears'].notna() & (df['depYears'] > 0)
    )
    df_valid = df[mask].copy()

    # คำนวณค่าเสื่อม
    df_valid['depMonths'] = (df_valid['depYears'] * 12).astype(int)
    df_valid['monthlyDep'] = df_valid['capEx'] / df_valid['depMonths']

    bme_map = {}
    for _, row in df_valid.iterrows():
        ae_title = row['ae_title_clean']
        install_date = row['installDate']

        bme_map[ae_title] = {
            'capEx': float(row['capEx']),
            'monthlyDep': float(row['monthlyDep']),
            'depMonths': int(row['depMonths']),
            'orderNum': str(row['order_num']).strip() if row['order_num'] is not None else '',
            'bmeName': str(row['bme_name']).strip() if row['bme_name'] is not None else '',
            'brand': str(row['bme_brand']).strip() if row['bme_brand'] is not None else '',
            'model': str(row['bme_model']).strip() if row['bme_model'] is not None else '',
            'installDate': install_date.isoformat() if pd.notna(install_date) else None
        }

    return bme_map


def get_lookup_maps():
    """
    โหลด map + DataFrame ทั้งหมดเข้า GLOBAL_CACHE แค่ครั้งแรก
    ครั้งต่อ ๆ ไปจะใช้จาก cache (ไม่ยิง DB ซ้ำ)
    """
    if GLOBAL_CACHE['bme_map'] is None:
        print("Loading lookup maps and dataframes into cache from SQL Server...")

        # BME / HIS / COST → map
        GLOBAL_CACHE['bme_map'] = build_bme_map()
        GLOBAL_CACHE['his_map'] = build_his_map()
        GLOBAL_CACHE['his_name_map'] = build_his_name_map()
        GLOBAL_CACHE['cost_map'] = build_cost_map()

        # SAP / PACS → DataFrame จาก MAIN DB
        engine = get_main_engine()

        print("Caching SAP DataFrame...")
        sap_table = SHEET_NAMES['SAP']
        sap_query = f"""
            SELECT
                {_quote_col(COLS['SAP_BME_ORDER'])} AS bme_order,
                {_quote_col(COLS['SAP_DATE'])} AS posting_date,
                {_quote_col(COLS['SAP_PRICE'])} AS price
            FROM {sap_table}
        """
        df_sap = pd.read_sql(sap_query, engine)
        df_sap['bme_order'] = df_sap['bme_order'].astype(str).str.strip()
        GLOBAL_CACHE['df_sap'] = df_sap

        print("Caching PACS DataFrame...")
        pacs_table = SHEET_NAMES['PACS']
        pacs_query = f"""
            SELECT
                {_quote_col(COLS['PACS_AE_TITLE'])} AS ae_title,
                {_quote_col(COLS['PACS_SERVICE_CODE'])} AS service_code,
                {_quote_col(COLS['PACS_YEAR_MONTH'])} AS year_month,
                {_quote_col(COLS['PACS_ORDER_QTY'])} AS order_qty
            FROM {pacs_table}
        """
        df_pacs = pd.read_sql(pacs_query, engine)
        df_pacs['ae_title'] = df_pacs['ae_title'].astype(str).str.strip()
        GLOBAL_CACHE['df_pacs'] = df_pacs

        print("Cache loaded from database.")

    return GLOBAL_CACHE
