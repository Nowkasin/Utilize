from datetime import datetime

import numpy as np
import pandas as pd

from config import COLS
from data_cache import get_lookup_maps
from utils import robust_parse_date, generate_date_timeline
from config import COLS, COST_FALLBACK_RATIO, DATE_FORMAT_API

def get_initial_bme_map():
    """สำหรับ /api/initial-data"""
    maps = get_lookup_maps()
    return maps['bme_map']


def build_device_data_response(ae_title: str) -> dict:
    """
    สำหรับ /api/device-data/<ae_title>
    คืน dict ที่พร้อมส่ง jsonify ตรง ๆ
    ถ้าไม่เจอ ae_title ให้ raise ValueError / KeyError ให้ route จัดการ status code
    """
    if not ae_title:
        raise ValueError("No AE Title provided.")

    maps = get_lookup_maps()
    bme_data = maps['bme_map'].get(ae_title)

    if not bme_data:
        raise KeyError(f"Could not find BME data for AE Title: {ae_title}")

    order_num = bme_data['orderNum']
    install_date = robust_parse_date(bme_data['installDate'])

    all_unique_dates = set()

    # ---------- SAP ----------
    df_sap = maps['df_sap']
    df_sap_device = df_sap[df_sap[COLS['SAP_BME_ORDER']] == order_num].copy()

    df_sap_device['date'] = pd.to_datetime(
        df_sap_device[COLS['SAP_DATE']], errors='coerce'
    )
    df_sap_device['price'] = pd.to_numeric(
        df_sap_device[COLS['SAP_PRICE']], errors='coerce'
    )

    df_sap_device = df_sap_device.dropna(subset=['date', 'price'])
    df_sap_device = df_sap_device[df_sap_device['price'] != 0].copy()

    valid_sap_dates = df_sap_device['date'].dt.strftime('%Y-%m-%d').unique()
    all_unique_dates.update(valid_sap_dates)

    df_sap_device['yearMonth'] = df_sap_device['date'].dt.strftime('%Y-%m')
    sap_grouped = df_sap_device.groupby('yearMonth')['price'].sum()

    sap_map = {
        f"{order_num}-{key}": float(value)
        for key, value in sap_grouped.to_dict().items()
    }

    # ---------- PACS ----------
    df_pacs = maps['df_pacs']
    df_pacs_device = df_pacs[df_pacs[COLS['PACS_AE_TITLE']] == ae_title].copy()

    # 1) service_code แบบ strip แล้ว
    df_pacs_device['service_code'] = (
        df_pacs_device[COLS['PACS_SERVICE_CODE']].astype(str).str.strip()
    )

    # 2) yearMonth
    df_pacs_device['yearMonth'] = (
        df_pacs_device[COLS['PACS_YEAR_MONTH']].astype(str).str.slice(0, 7)
    )

    # 3) map ราคา (HIS)
    df_pacs_device['price'] = df_pacs_device['service_code'].map(maps['his_map']).fillna(0)

    # 3a) raw cost
    df_pacs_device['cost_raw'] = df_pacs_device['service_code'].map(maps['cost_map'])

    # 3b) เงื่อนไข cost หาย/เป็น 0
    is_cost_missing_or_zero = df_pacs_device['cost_raw'].isna() | (
        df_pacs_device['cost_raw'] == 0
    )

    # 3c) fallback cost = 70% ของ price
    cost_fallback = df_pacs_device['price'] * COST_FALLBACK_RATIO


    # 3d) ใช้ np.where เพื่อเลือก cost
    df_pacs_device['cost'] = np.where(
        is_cost_missing_or_zero,
        cost_fallback,
        df_pacs_device['cost_raw']
    )

    # 3e) ชื่อหัตถการ
    df_pacs_device['serviceName'] = df_pacs_device['service_code'].map(
        maps['his_name_map']
    )
    df_pacs_device['serviceName'] = df_pacs_device['serviceName'].fillna(
        df_pacs_device['service_code']
    )

    # 4) คำนวณจำนวน + กำไร
    df_pacs_device['orderQty'] = pd.to_numeric(
        df_pacs_device[COLS['PACS_ORDER_QTY']], errors='coerce'
    )
    df_pacs_device['revenuePL'] = (
        (df_pacs_device['price'] - df_pacs_device['cost']) * df_pacs_device['orderQty']
    )

    # 5) กรองข้อมูลไม่สมบูรณ์
    df_pacs_device = df_pacs_device[
        (df_pacs_device['orderQty'].notna())
        & (df_pacs_device['orderQty'] != 0)
        & (df_pacs_device['yearMonth'].str.len() == 7)
    ].copy()

    # 6) เพิ่มวันที่จาก PACS (ใช้ day=1)
    valid_pacs_dates = pd.to_datetime(
        df_pacs_device['yearMonth'] + '-01', format='%Y-%m-%d', errors='coerce'
    ).dropna()
    all_unique_dates.update(valid_pacs_dates.dt.strftime('%Y-%m-%d').unique())

    # 7) แปลงเป็น list of dict สำหรับ frontend
    df_pacs_device['aeTitle'] = df_pacs_device[COLS['PACS_AE_TITLE']]

    pacs_data_details = df_pacs_device[
        ['aeTitle', 'service_code', 'serviceName', 'yearMonth', 'orderQty', 'revenuePL']
    ].rename(columns={'service_code': 'serviceCode'}).copy()

    # บังคับ type ให้ JSON-friendly หน่อย
    pacs_data_details['orderQty'] = pacs_data_details['orderQty'].astype(float)
    pacs_data_details['revenuePL'] = pacs_data_details['revenuePL'].astype(float)

    pacs_data_details_list = pacs_data_details.to_dict('records')

    # ---------- Install Date ----------
    if install_date:
        all_unique_dates.add(install_date.strftime('%Y-%m-%d'))

    # ---------- Timeline ----------
    sorted_dates = sorted(list(all_unique_dates))
    complete_timeline = generate_date_timeline(sorted_dates)

    return {
        'sapMap': sap_map,
        'pacsDataDetails': pacs_data_details_list,
        'allUniqueDates': complete_timeline,
        'todayStr': datetime.today().strftime(DATE_FORMAT_API)
    }
