import pandas as pd
from datetime import date
import time
from config import (
    COLS,
    COST_FALLBACK_RATIO,
    TIMELINE_FUTURE_MONTHS,
    DATE_FORMAT_API,
)
from data_cache import get_lookup_maps
from utils import robust_parse_date

# cache ราย device (ลดการยิง DB / ประมวลผลซ้ำ)
DEVICE_DATA_CACHE: dict[str, dict] = {}

# ✅ จำกัดจำนวนเดือนสูงสุดใน timeline (history + future)
# 84 = 7 ปี, ถ้าอยากให้สั้นลงก็ลดเลขนี้ เช่น 60 = 5 ปี
MAX_MONTHS_IN_TIMELINE = 84


def get_initial_bme_map():
  """ส่ง map สำหรับ dropdown แรก (ชื่อเครื่อง / AE Title ทั้งหมด)"""
  maps = get_lookup_maps()
  return maps["bme_map"]


def build_device_data_response(ae_title: str):
    """
    สร้าง payload สำหรับ /api/device-data/<ae_title>
    """
    start_ts = time.perf_counter()  # 👈 เริ่มจับเวลา
    try:
        # ---------- 0) ใช้ cache ถ้ามีอยู่แล้ว ---------- #
        if ae_title in DEVICE_DATA_CACHE:
            return DEVICE_DATA_CACHE[ae_title]

        # ---------- 1) ดึงของจาก cache หลัก ---------- #
        maps = get_lookup_maps()
        bme_map = maps["bme_map"]
        his_map = maps["his_map"]
        his_name_map = maps["his_name_map"]
        cost_map = maps["cost_map"]
        df_sap = maps.get("df_sap")
        df_pacs = maps.get("df_pacs")

        # กันเหนียว df ว่าง
        if df_sap is None:
            df_sap = pd.DataFrame(columns=["bme_order", "posting_date", "price"])
        if df_pacs is None:
            df_pacs = pd.DataFrame(
                columns=["ae_title", "service_code", "year_month", "order_qty"]
            )

        # ---------- 2) ดึงข้อมูลเครื่องจาก BME ---------- #
        if ae_title not in bme_map:
            raise KeyError(f"AE Title not found: {ae_title}")

        device = bme_map[ae_title]
        order_num = str(device.get("orderNum", "")).strip()
        capEx = float(device.get("capEx", 0) or 0)
        monthlyDep = float(device.get("monthlyDep", 0) or 0)
        depMonths = int(device.get("depMonths", 0) or 0)
        install_date_str = device.get("installDate")
        install_date = robust_parse_date(install_date_str) if install_date_str else None

        # ---------- 3) SAP ตามเดือน ---------- #
        sap_map: dict[str, float] = {}
        if order_num:
            df_sap_device = df_sap[df_sap["bme_order"] == order_num].copy()
            if not df_sap_device.empty:
                if "year_month" not in df_sap_device.columns:
                    df_sap_device["posting_date"] = pd.to_datetime(
                        df_sap_device["posting_date"], errors="coerce"
                    )
                    df_sap_device["year_month"] = df_sap_device["posting_date"].dt.strftime("%Y-%m")

                sap_monthly = df_sap_device.groupby("year_month")["price"].sum()
                for ym, val in sap_monthly.items():
                    key = f"{order_num}-{ym}"
                    sap_map[key] = float(val)

        # ---------- 4) PACS: รายละเอียดหัตถการ ---------- #
        df_pacs_device = df_pacs[df_pacs["ae_title"] == ae_title].copy()
        if not df_pacs_device.empty:
            df_pacs_device["service_code"] = (
                df_pacs_device["service_code"].astype(str).str.strip()
            )
            df_pacs_device["year_month"] = df_pacs_device["year_month"].astype(str)
            df_pacs_device["order_qty"] = pd.to_numeric(
                df_pacs_device["order_qty"], errors="coerce"
            ).fillna(0)

            # รวมกันซ้ำอีกรอบ (กันข้อมูลซ้ำ)
            df_pacs_device = (
                df_pacs_device
                .groupby(["year_month", "service_code"], as_index=False)["order_qty"]
                .sum()
            )

            df_pacs_device["unitPrice"] = df_pacs_device["service_code"].map(his_map).fillna(0)
            df_pacs_device["revenuePL"] = (
                df_pacs_device["order_qty"] * df_pacs_device["unitPrice"]
            )
            df_pacs_device["serviceName"] = df_pacs_device["service_code"].map(
                lambda c: his_name_map.get(c, "")
            )
        else:
            df_pacs_device["revenuePL"] = []
            df_pacs_device["serviceName"] = []

        # ---------- 5) สร้าง pacsDataDetails ---------- #
        pacs_details: list[dict] = []
        for _, row in df_pacs_device.iterrows():
            pacs_details.append(
                {
                    "aeTitle": ae_title,
                    "yearMonth": row["year_month"],
                    "serviceCode": row["service_code"],
                    "serviceName": row.get("serviceName", ""),
                    "orderQty": float(row["order_qty"]),
                    "revenuePL": float(row["revenuePL"]),
                }
            )

        # ---------- 6) timeline เดือน + อนาคต ---------- #
        months_from_pacs = (
            sorted(set(df_pacs_device["year_month"])) if not df_pacs_device.empty else []
        )

        if months_from_pacs:
            start_ym = months_from_pacs[0]
            end_ym = months_from_pacs[-1]
        else:
            if install_date is None:
                raise ValueError("No PACS data and no installDate for device")
            start_ym = install_date.strftime("%Y-%m")
            end_ym = start_ym

        start_year, start_month = map(int, start_ym.split("-"))
        end_year, end_month = map(int, end_ym.split("-"))

        actual_months = (end_year - start_year) * 12 + (end_month - start_month) + 1
        history_months_limit = max(1, MAX_MONTHS_IN_TIMELINE - TIMELINE_FUTURE_MONTHS)

        if actual_months > history_months_limit:
            total_end_idx = end_year * 12 + (end_month - 1)
            total_start_idx = total_end_idx - (history_months_limit - 1)
            start_year = total_start_idx // 12
            start_month = total_start_idx % 12 + 1

        total_months = (
            (end_year - start_year) * 12
            + (end_month - start_month)
            + 1
            + TIMELINE_FUTURE_MONTHS
        )

        all_unique_dates: list[str] = []
        y, m = start_year, start_month
        for _ in range(total_months):
            all_unique_dates.append(date(y, m, 1).strftime(DATE_FORMAT_API))
            m += 1
            if m > 12:
                m = 1
                y += 1

        today = date.today()
        today_str = date(today.year, today.month, 1).strftime(DATE_FORMAT_API)

        # ---------- 7) ประกอบผลลัพธ์ ---------- #
        result = {
            "sapMap": sap_map,
            "pacsDataDetails": pacs_details,
            "allUniqueDates": all_unique_dates,
            "todayStr": today_str,
            "deviceInfo": {
                "orderNum": order_num,
                "capEx": capEx,
                "monthlyDep": monthlyDep,
                "depMonths": depMonths,
                "installDate": install_date.strftime(DATE_FORMAT_API)
                if install_date
                else None,
            },
        }

        DEVICE_DATA_CACHE[ae_title] = result
        return result
    finally:
        elapsed = time.perf_counter() - start_ts
        print(f"[device_data] ae={ae_title} took {elapsed:.3f}s")
