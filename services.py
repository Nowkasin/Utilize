import pandas as pd
from datetime import date

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

# จำกัดจำนวนเดือนสูงสุดใน timeline (history + future)
# 84 = 7 ปี, อยากให้สั้นลงก็ลดเลขนี้ได้
MAX_MONTHS_IN_TIMELINE = 84


def get_initial_bme_map():
    """ส่ง map สำหรับ dropdown แรก (ชื่อเครื่อง / AE Title ทั้งหมด)"""
    maps = get_lookup_maps()
    return maps["bme_map"]

def build_device_data_response(ae_title: str):
    """
    สร้าง payload สำหรับ /api/device-data/<ae_title>
    คืนค่า:
      {
        sapMap: { "<orderNum>-YYYY-MM": expense_sum, ... },
        pacsDataDetails: [ ... ],
        allUniqueDates: ["YYYY-MM-01", ... ],
        todayStr: "YYYY-MM-01",
        deviceInfo: {...}
      }
    """

    # ---------- 0) ใช้ cache ถ้ามีอยู่แล้ว ---------- #
    if ae_title in DEVICE_DATA_CACHE:
        return DEVICE_DATA_CACHE[ae_title]

    # ---------- 1) ดึงของจาก cache หลัก ---------- #
    maps = get_lookup_maps()
    bme_map = maps["bme_map"]
    his_map = maps["his_map"]
    his_name_map = maps["his_name_map"]
    cost_map = maps["cost_map"]        # ใช้คำนวณต้นทุน
    df_sap = maps.get("df_sap")
    df_pacs = maps.get("df_pacs")

    # กันเหนียว: ถ้า df_sap / df_pacs ยังไม่มี ให้เป็น DataFrame ว่าง ๆ
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

    # ---------- 3) SAP: ค่าใช้จ่ายตามเดือน ---------- #
    sap_map: dict[str, float] = {}

    if order_num:
        # df_sap ตอนนี้มีคอลัมน์: bme_order, posting_date, price, year_month (จาก data_cache)
        df_sap_device = df_sap[df_sap["bme_order"] == order_num].copy()

        if not df_sap_device.empty:
            # ถ้ายังไม่มี year_month ใน df_sap (กันพลาด) ให้สร้างเพิ่ม
            if "year_month" not in df_sap_device.columns:
                df_sap_device["posting_date"] = pd.to_datetime(
                    df_sap_device["posting_date"], errors="coerce"
                )
                df_sap_device["year_month"] = df_sap_device["posting_date"].dt.strftime(
                    "%Y-%m"
                )

            sap_monthly = df_sap_device.groupby("year_month")["price"].sum()

            for ym, val in sap_monthly.items():
                key = f"{order_num}-{ym}"
                sap_map[key] = float(val)

    # ---------- 4) PACS: รายละเอียดหัตถการ + รายได้ + ต้นทุน + กำไร ---------- #
    df_pacs_device = df_pacs[df_pacs["ae_title"] == ae_title].copy()

    if not df_pacs_device.empty:
        # ทำความสะอาด type
        df_pacs_device["service_code"] = (
            df_pacs_device["service_code"].astype(str).str.strip()
        )
        df_pacs_device["order_qty"] = pd.to_numeric(
            df_pacs_device["order_qty"], errors="coerce"
        ).fillna(0)

        # ---- ราคา/ครั้ง ตาม HIS (DefaultPrice) ----
        df_pacs_device["unitPrice"] = (
            df_pacs_device["service_code"].map(his_map).fillna(0.0)
        )

        # ---- ต้นทุน/ครั้ง ตาม COST (GrandTotalCost) + Fallback ----
        # unitCost_raw = ต้นทุนจาก COST (อาจเป็น 0 หรือ NaN)
        df_pacs_device["unitCost_raw"] = (
            df_pacs_device["service_code"].map(cost_map)
        )

        # ถ้าหาต้นทุนไม่ได้ หรือเป็น 0 → ใช้ COST_FALLBACK_RATIO * unitPrice
        df_pacs_device["unitCost"] = df_pacs_device.apply(
            lambda row: (
                row["unitCost_raw"]
                if pd.notna(row["unitCost_raw"]) and row["unitCost_raw"] > 0
                else float(row["unitPrice"]) * float(COST_FALLBACK_RATIO)
            ),
            axis=1,
        )

        # ---- รายได้รวม (ยอดขายดิบ) = ราคาขาย * จำนวนครั้ง ----
        df_pacs_device["revenueRaw"] = (
            df_pacs_device["order_qty"] * df_pacs_device["unitPrice"]
        )

        # ---- ต้นทุนรวม = ต้นทุน/ครั้ง * จำนวนครั้ง ----
        df_pacs_device["costTotal"] = (
            df_pacs_device["order_qty"] * df_pacs_device["unitCost"]
        )

        # ---- กำไร/ขาดทุน ตามสูตรใหม่: ต้นทุนรวม - รายได้รวม ----
        #   profit > 0  = ต้นทุนมากกว่ารายได้ (มองในมุม cost - price)
        #   profit < 0  = รายได้มากกว่าต้นทุน
        df_pacs_device["profit"] = (
            df_pacs_device["costTotal"] - df_pacs_device["revenueRaw"]
        )

        # ---- P/L ที่ส่งให้กราฟใช้ (ใช้ profit ตามสูตรใหม่) ----
        df_pacs_device["revenuePL"] = df_pacs_device["profit"]

        # ---- % กำไร/ขาดทุน เทียบกับ "รายได้ดิบ" ----
        def _calc_margin_pct(row):
            rev = float(row["revenueRaw"])
            if rev <= 0:
                return 0.0
            return float(row["profit"]) / rev * 100.0

        df_pacs_device["marginPct"] = df_pacs_device.apply(_calc_margin_pct, axis=1)

        # ---- ชื่อหัตถการ ----
        df_pacs_device["serviceName"] = df_pacs_device["service_code"].map(
            lambda c: his_name_map.get(c, "")
        )

        # log รวมไว้ดูคร่าว ๆ ใน console
        try:
            total_rev = float(df_pacs_device["revenueRaw"].sum())
            total_cost = float(df_pacs_device["costTotal"].sum())
            total_profit = float(df_pacs_device["profit"].sum())
            print(
                f"[device_data] ae={ae_title} "
                f"rows={len(df_pacs_device)}, "
                f"revenueRaw={total_rev:,.2f}, "
                f"costTotal={total_cost:,.2f}, "
                f"profit(cost-price*qty)={total_profit:,.2f}"
            )
        except Exception:
            pass

    else:
        # ให้มีคอลัมน์ตามที่ใช้ด้านล่าง แต่เป็นว่าง ๆ
        df_pacs_device["revenueRaw"] = []
        df_pacs_device["revenuePL"] = []
        df_pacs_device["serviceName"] = []
        df_pacs_device["unitPrice"] = []
        df_pacs_device["unitCost"] = []
        df_pacs_device["costTotal"] = []
        df_pacs_device["profit"] = []
        df_pacs_device["marginPct"] = []

    # ---------- 5) สร้าง list pacsDataDetails ส่งให้ frontend ---------- #
    pacs_details: list[dict] = []
    for _, row in df_pacs_device.iterrows():
        pacs_details.append(
            {
                "aeTitle": ae_title,
                "yearMonth": row["year_month"],
                "serviceCode": row["service_code"],
                "serviceName": row.get("serviceName", ""),
                "orderQty": float(row["order_qty"]),
                "unitPrice": float(row.get("unitPrice", 0.0)),   # ราคาขายต่อครั้ง
                "unitCost": float(row.get("unitCost", 0.0)),     # ต้นทุนต่อครั้ง (COST หรือ 70%)
                "revenueRaw": float(row.get("revenueRaw", 0.0)), # รายได้รวม = price * qty
                "costTotal": float(row.get("costTotal", 0.0)),   # ต้นทุนรวม
                "profit": float(row.get("profit", 0.0)),         # ต้นทุนรวม - รายได้รวม
                "revenuePL": float(row.get("revenuePL", 0.0)),   # ใช้ profit เป็น P/L
                "marginPct": float(row.get("marginPct", 0.0)),
            }
        )

    # ---------- 6) สร้าง timeline เดือน (allUniqueDates) + จำกัดจำนวนเดือน ---------- #
    months_from_pacs = (
        sorted(set(df_pacs_device["year_month"])) if not df_pacs_device.empty else []
    )

    if months_from_pacs:
        start_ym = months_from_pacs[0]
        end_ym = months_from_pacs[-1]
    else:
        # ถ้าไม่มี PACS เลย ใช้เดือนของ install_date
        if install_date is None:
            raise ValueError("No PACS data and no installDate for device")
        start_ym = install_date.strftime("%Y-%m")
        end_ym = start_ym

    start_year, start_month = map(int, start_ym.split("-"))
    end_year, end_month = map(int, end_ym.split("-"))

    # จำนวนเดือนจริง (ไม่รวมอนาคต)
    actual_months = (end_year - start_year) * 12 + (end_month - start_month) + 1

    # เพดานจำนวนเดือนในประวัติ (ไม่รวมอนาคต)
    history_months_limit = max(1, MAX_MONTHS_IN_TIMELINE - TIMELINE_FUTURE_MONTHS)

    # ถ้าข้อมูลจริงยาวเกิน limit → ตัดให้เหลือแค่ช่วงล่าสุด
    if actual_months > history_months_limit:
        # แปลง year/month เป็น index เดือน (นับจาก 0)
        total_end_idx = end_year * 12 + (end_month - 1)
        total_start_idx = total_end_idx - (history_months_limit - 1)

        start_year = total_start_idx // 12
        start_month = total_start_idx % 12 + 1

    # คำนวณจำนวนเดือนหลังจาก limit + รวมอนาคต
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

    # ---------- 7) ประกอบผลลัพธ์ & เก็บเข้า cache ---------- #
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

