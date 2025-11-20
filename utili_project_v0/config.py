import os

# ชื่อ table ใน dataabase
SHEET_NAMES = {
    'PACS': 'UTILIZE_PACS2',
    'HIS': 'HIS_MASTER_TREATMENT_CODE',
    'COST': 'UTILIZE_COST_XRAY',
    'BME': 'UTILIZE_BME',
    'SAP': 'UTILIZE_SAP',
}

# ชื่อคอลัมน์ในแต่ละ Table
COLS = {
    # BME
    
    'BME_AE_TITLE': 'ae_title',
    'BME_NAME': 'asset_name',
    'BME_ORDER': 'order_no',
    'BME_BRAND': 'brand',
    'BME_MODEL': 'model',
    'BME_PRICE': 'purchase_price',
    'BME_DATE': 'receive_date',
    'BME_DEPYEAR': 'depreciation_years',

    # PACS
    'PACS_AE_TITLE': 'ae_title',
    'PACS_SERVICE_CODE': 'service_code',
    'PACS_YEAR_MONTH': 'year_month',
    'PACS_ORDER_QTY': 'order_qty',

    # HIS
    'HIS_SERVICE_CODE': 'Code',
    'HIS_SERVICE_NAME': 'EnglishName',
    'HIS_SERVICE_PRICE': 'DefaultPrice',

    # COST
    'COST_SERVICE_CODE': 'Code',
    'COST_GRAND_COST': 'GrandTotalCost',

    # SAP
    'SAP_BME_ORDER': 'Order',
    'SAP_DATE': 'Posting Date',
    'SAP_PRICE': 'Val.in rep.cur.'
}
# อัตราส่วน cost fallback: ถ้าหา cost จริงไม่ได้หรือเป็น 0 → ใช้ราคาขาย * ค่า ratio นี้
COST_FALLBACK_RATIO = 0.70

# จำนวนเดือน "อนาคต" ที่อยากให้ timeline ไปถึง (เพื่อให้กราฟมีช่วงอนาคต)
TIMELINE_FUTURE_MONTHS = 3

# รูปแบบวันที่ที่ส่งให้ frontend
DATE_FORMAT_API = '%Y-%m-%d'