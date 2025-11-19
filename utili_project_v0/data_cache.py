import pandas as pd
import os
from config import EXCEL_FILE_PATH, SHEET_NAMES, COLS
from utils import robust_parse_date

# Global cache
GLOBAL_CACHE = {
    'bme_map': None,
    'his_map': None,
    'his_name_map': None,
    'cost_map': None,
    'df_sap': None,
    'df_pacs': None
}


def build_his_map():
    df = pd.read_excel(EXCEL_FILE_PATH, sheet_name=SHEET_NAMES['HIS'])
    df[COLS['HIS_SERVICE_CODE']] = df[COLS['HIS_SERVICE_CODE']].astype(str).str.strip()
    df[COLS['HIS_SERVICE_PRICE']] = pd.to_numeric(
        df[COLS['HIS_SERVICE_PRICE']], errors='coerce'
    ).fillna(0)
    return pd.Series(
        df[COLS['HIS_SERVICE_PRICE']].values,
        index=df[COLS['HIS_SERVICE_CODE']]
    ).to_dict()


def build_his_name_map():
    df = pd.read_excel(EXCEL_FILE_PATH, sheet_name=SHEET_NAMES['HIS'])
    df[COLS['HIS_SERVICE_CODE']] = df[COLS['HIS_SERVICE_CODE']].astype(str).str.strip()
    df[COLS['HIS_SERVICE_NAME']] = df[COLS['HIS_SERVICE_NAME']].astype(str).fillna('N/A')
    return pd.Series(
        df[COLS['HIS_SERVICE_NAME']].values,
        index=df[COLS['HIS_SERVICE_CODE']]
    ).to_dict()


def build_cost_map():
    df = pd.read_excel(EXCEL_FILE_PATH, sheet_name=SHEET_NAMES['COST'])
    df[COLS['COST_SERVICE_CODE']] = df[COLS['COST_SERVICE_CODE']].astype(str).str.strip()
    df[COLS['COST_GRAND_COST']] = pd.to_numeric(
        df[COLS['COST_GRAND_COST']], errors='coerce'
    ).fillna(0)
    return pd.Series(
        df[COLS['COST_GRAND_COST']].values,
        index=df[COLS['COST_SERVICE_CODE']]
    ).to_dict()


def build_bme_map():
    df = pd.read_excel(EXCEL_FILE_PATH, sheet_name=SHEET_NAMES['BME'])

    # เตรียมคอลัมน์พื้นฐาน
    df['ae_title_clean'] = df[COLS['BME_AE_TITLE']].astype(str).str.strip()
    df['capEx'] = pd.to_numeric(df[COLS['BME_PRICE']], errors='coerce')
    df['depYears'] = pd.to_numeric(df[COLS['BME_DEPYEAR']], errors='coerce')
    df['installDate'] = pd.to_datetime(df[COLS['BME_DATE']], errors='coerce')

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
            'orderNum': str(row[COLS['BME_ORDER']]).strip(),
            'bmeName': str(row[COLS['BME_NAME']]).strip(),
            'brand': str(row[COLS['BME_BRAND']]).strip(),
            'model': str(row[COLS['BME_MODEL']]).strip(),
            'installDate': install_date.isoformat() if pd.notna(install_date) else None
        }

    return bme_map



def get_lookup_maps():
    """
    โหลด map + DataFrame ทั้งหมดเข้า GLOBAL_CACHE แค่ครั้งแรก
    ครั้งต่อ ๆ ไปจะใช้จาก cache
    """
    if GLOBAL_CACHE['bme_map'] is None:
        print("Loading lookup maps and dataframes into cache...")

        GLOBAL_CACHE['bme_map'] = build_bme_map()
        GLOBAL_CACHE['his_map'] = build_his_map()
        GLOBAL_CACHE['his_name_map'] = build_his_name_map()
        GLOBAL_CACHE['cost_map'] = build_cost_map()

        print("Caching SAP DataFrame...")
        df_sap = pd.read_excel(EXCEL_FILE_PATH, sheet_name=SHEET_NAMES['SAP'])
        df_sap[COLS['SAP_BME_ORDER']] = df_sap[COLS['SAP_BME_ORDER']].astype(str).str.strip()
        GLOBAL_CACHE['df_sap'] = df_sap

        print("Caching PACS DataFrame...")
        df_pacs = pd.read_excel(EXCEL_FILE_PATH, sheet_name=SHEET_NAMES['PACS'])
        df_pacs[COLS['PACS_AE_TITLE']] = df_pacs[COLS['PACS_AE_TITLE']].astype(str).str.strip()
        GLOBAL_CACHE['df_pacs'] = df_pacs

        print("Cache loaded.")

    return GLOBAL_CACHE
