import pandas as pd
import numpy as np  # <--- (โค้ดนี้ใช้ numpy)
from flask import Flask, jsonify, render_template
from datetime import datetime, timedelta
from dateutil.relativedelta import relativedelta
import os

app = Flask(__name__)

# --- 1. การตั้งค่า: (เหมือนเดิม) ---

# 1.1) ระบุตำแหน่งไฟล์ Excel
EXCEL_FILE_PATH = os.path.join('data', 'DemoUtilize.xlsx') 

# 1.2) ระบุชื่อชีท
SHEET_NAMES = {
    'PACS': 'Pivot_PACS',
    'HIS': 'HIS',
    'COST': 'COST',
    'BME': 'BME',
    'SAP': 'SAP',
}

# 1.3) ระบุชื่อคอลัมน์ "จริงๆ" ในไฟล์ Excel ของคุณ
COLS = {
    # ชีท BME
    'BME_AE_TITLE': 'ae_title', 
    'BME_NAME': 'asset_name',  # เปลี่ยนจาก 'ชื่อครุภัณฑ์'
    'BME_ORDER': 'order_no',    # เปลี่ยนจาก 'Order'
    'BME_BRAND': 'brand',       # เปลี่ยนจาก 'ยี่ห้อ'
    'BME_MODEL': 'model',       # เปลี่ยนจาก 'รุ่น'
    'BME_PRICE': 'purchase_price', # เปลี่ยนจาก 'ราคาที่ซื้อ'
    'BME_DATE': 'receive_date',    # เปลี่ยนจาก 'วันที่รับ'
    'BME_DEPYEAR': 'depreciation_years', # เปลี่ยนจาก 'จำนวนปีที่คิดค่าเสื่อม'
    
    # ชีท PACS
    'PACS_AE_TITLE': 'ae_title',
    'PACS_SERVICE_CODE': 'service_code',
    'PACS_YEAR_MONTH': 'year_month',
    'PACS_ORDER_QTY': 'order_qty',

    # ชีท HIS
    'HIS_SERVICE_CODE': 'Code', 
    'HIS_SERVICE_NAME': 'EnglishName',
    'HIS_SERVICE_PRICE': 'DefaultPrice',
    
    # ชีท COST
    'COST_SERVICE_CODE': 'Code',
    'COST_GRAND_COST': 'GrandTotalCost',

    # ชีท SAP
    'SAP_BME_ORDER': 'Order',
    'SAP_DATE': 'Posting Date',
    'SAP_PRICE': 'Val.in rep.cur.'
}
# -------------------------------------------------------------


# --- 2. Global Cache สำหรับ Maps (เหมือนเดิม) ---
GLOBAL_CACHE = {
    'bme_map': None,
    'his_map': None,
    'his_name_map': None,
    'cost_map': None,
    'df_sap': None,
    'df_pacs': None 
}

# --- (ฟังก์ชัน helper ทั้งหมดเหมือนเดิม) ---
def robust_parse_date(date_input):
    if pd.isna(date_input) or date_input is None:
        return None
    try:
        return pd.to_datetime(date_input)
    except Exception:
        return None

def build_his_map():
    df = pd.read_excel(EXCEL_FILE_PATH, sheet_name=SHEET_NAMES['HIS'])
    df[COLS['HIS_SERVICE_CODE']] = df[COLS['HIS_SERVICE_CODE']].astype(str).str.strip()
    df[COLS['HIS_SERVICE_PRICE']] = pd.to_numeric(df[COLS['HIS_SERVICE_PRICE']], errors='coerce').fillna(0)
    return pd.Series(df[COLS['HIS_SERVICE_PRICE']].values, index=df[COLS['HIS_SERVICE_CODE']]).to_dict()

def build_his_name_map():
    df = pd.read_excel(EXCEL_FILE_PATH, sheet_name=SHEET_NAMES['HIS'])
    df[COLS['HIS_SERVICE_CODE']] = df[COLS['HIS_SERVICE_CODE']].astype(str).str.strip()
    df[COLS['HIS_SERVICE_NAME']] = df[COLS['HIS_SERVICE_NAME']].astype(str).fillna('N/A')
    return pd.Series(df[COLS['HIS_SERVICE_NAME']].values, index=df[COLS['HIS_SERVICE_CODE']]).to_dict()

def build_cost_map():
    df = pd.read_excel(EXCEL_FILE_PATH, sheet_name=SHEET_NAMES['COST'])
    df[COLS['COST_SERVICE_CODE']] = df[COLS['COST_SERVICE_CODE']].astype(str).str.strip()
    df[COLS['COST_GRAND_COST']] = pd.to_numeric(df[COLS['COST_GRAND_COST']], errors='coerce').fillna(0)
    return pd.Series(df[COLS['COST_GRAND_COST']].values, index=df[COLS['COST_SERVICE_CODE']]).to_dict()

def build_bme_map():
    df = pd.read_excel(EXCEL_FILE_PATH, sheet_name=SHEET_NAMES['BME'])
    bme_map = {}
    
    for _, row in df.iterrows():
        try:
            ae_title = str(row[COLS['BME_AE_TITLE']]).strip()
            cap_ex = pd.to_numeric(row[COLS['BME_PRICE']], errors='coerce')
            dep_years = pd.to_numeric(row[COLS['BME_DEPYEAR']], errors='coerce')

            if not ae_title or pd.isna(cap_ex) or cap_ex <= 0 or pd.isna(dep_years) or dep_years <= 0:
                continue

            order_num = str(row[COLS['BME_ORDER']]).strip()
            bme_name = str(row[COLS['BME_NAME']]).strip()
            bme_brand = str(row[COLS['BME_BRAND']]).strip()
            bme_model = str(row[COLS['BME_MODEL']]).strip()
            
            install_date = robust_parse_date(row[COLS['BME_DATE']])
            
            dep_months = dep_years * 12
            monthly_dep = cap_ex / dep_months

            bme_map[ae_title] = {
                'capEx': cap_ex,
                'monthlyDep': monthly_dep,
                'depMonths': dep_months,
                'orderNum': order_num,
                'bmeName': bme_name,
                'brand': bme_brand,
                'model': bme_model,
                'installDate': install_date.isoformat() if install_date else None
            }
        except Exception as e:
            print(f"Error processing BME row: {row}, Error: {e}")
            
    return bme_map

def get_lookup_maps():
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


def generate_date_timeline(sorted_date_strings):
    if not sorted_date_strings:
        return []
    
    valid_dates = [datetime.strptime(d, '%Y-%m-%d') for d in sorted_date_strings if isinstance(d, str)]
    if not valid_dates:
        return []

    min_date = min(valid_dates).replace(day=1)
    data_max_date = max(valid_dates)
    
    today = datetime.today()
    future_date = (today + relativedelta(months=3)).replace(day=1)
    max_date = max(data_max_date, future_date)

    result = []
    d = min_date
    while d <= max_date:
        result.append(d.strftime('%Y-%m-%d'))
        d = d + relativedelta(months=1)
    return result

# --- 3. Flask Endpoints (API) ---

@app.route('/')
def index():
    return render_template('ChartDashboard.html')

@app.route('/api/initial-data')
def get_initial_data():
    try:
        maps = get_lookup_maps()
        return jsonify({'bmeMap': maps['bme_map']})
    except Exception as e:
        print(f"Error in /api/initial-data: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/device-data/<string:ae_title>')
def get_device_data(ae_title):
    if not ae_title:
        return jsonify({'error': 'No AE Title provided.'}), 400

    try:
        maps = get_lookup_maps() 
        bme_data = maps['bme_map'].get(ae_title)
        
        if not bme_data:
            return jsonify({'error': f'Could not find BME data for AE Title: {ae_title}'}), 404
        
        order_num = bme_data['orderNum']
        install_date = robust_parse_date(bme_data['installDate'])
        
        all_unique_dates = set()
        
        # === SAP (เหมือนเดิม) ===
        df_sap = maps['df_sap'] 
        df_sap_device = df_sap[df_sap[COLS['SAP_BME_ORDER']] == order_num].copy()
        df_sap_device['date'] = pd.to_datetime(df_sap_device[COLS['SAP_DATE']], errors='coerce')
        df_sap_device['price'] = pd.to_numeric(df_sap_device[COLS['SAP_PRICE']], errors='coerce')
        df_sap_device = df_sap_device.dropna(subset=['date', 'price'])
        df_sap_device = df_sap_device[df_sap_device['price'] != 0].copy()
        valid_sap_dates = df_sap_device['date'].dt.strftime('%Y-%m-%d').unique()
        all_unique_dates.update(valid_sap_dates)
        df_sap_device['yearMonth'] = df_sap_device['date'].dt.strftime('%Y-%m')
        sap_grouped = df_sap_device.groupby('yearMonth')['price'].sum()
        sap_map = {f"{order_num}-{key}": value for key, value in sap_grouped.to_dict().items()}
        

        # === PACS ===
        df_pacs = maps['df_pacs'] 
        df_pacs_device = df_pacs[df_pacs[COLS['PACS_AE_TITLE']] == ae_title].copy()
        
        # 1. สร้าง 'service_code' ที่ Srtip แล้ว
        df_pacs_device['service_code'] = df_pacs_device[COLS['PACS_SERVICE_CODE']].astype(str).str.strip()
        
        # 2. สร้าง 'yearMonth' key
        df_pacs_device['yearMonth'] = df_pacs_device[COLS['PACS_YEAR_MONTH']].astype(str).str.slice(0, 7)
        
        # 3. ใช้ .map() (เร็วกว่า loop มาก) เพื่อดึง price, cost, name
        df_pacs_device['price'] = df_pacs_device['service_code'].map(maps['his_map']).fillna(0)
        
        
        # --- ▼▼▼ MODIFICATION START: 70% Cost Fallback Logic ▼▼▼ ---
        
        # 3a. ดึงต้นทุนดิบ (ถ้า "ไม่เจอ" จะเป็น NaN, ถ้า "เจอแต่เป็น 0" จะเป็น 0)
        # (เนื่องจาก build_cost_map() ใช้ .fillna(0) ค่า "ไม่เจอ" จริงๆ จะเป็น 0
        #  แต่เราจะดักทั้ง "ไม่เจอ" (NaN) และ "เป็น 0" (== 0) เพื่อความปลอดภัย)
        df_pacs_device['cost_raw'] = df_pacs_device['service_code'].map(maps['cost_map']) 
        
        # 3b. สร้างเงื่อนไข: "ไม่เจอ" (isna) หรือ "เป็น 0" (== 0)
        is_cost_missing_or_zero = (df_pacs_device['cost_raw'].isna()) | (df_pacs_device['cost_raw'] == 0)
        
        # 3c. สร้าง "ต้นทุนสำรอง" (70% ของราคาขาย)
        cost_fallback = df_pacs_device['price'] * 0.70
        
        # 3d. ใช้ np.where เพื่อเลือกต้นทุน:
        # ถ้า (เงื่อนไขเป็น True) ให้ใช้ cost_fallback,
        # ถ้า (เงื่อนไขเป็น False) ให้ใช้ cost_raw
        df_pacs_device['cost'] = np.where(
            is_cost_missing_or_zero,  # Condition
            cost_fallback,            # Value if True
            df_pacs_device['cost_raw']    # Value if False
        )
        
        # 3e. ดึงชื่อ (โค้ดเดิม)
        df_pacs_device['serviceName'] = df_pacs_device['service_code'].map(maps['his_name_map'])
        df_pacs_device['serviceName'] = df_pacs_device['serviceName'].fillna(df_pacs_device['service_code'])

        # 4. คำนวณ 'orderQty' และ 'revenuePL' (ใช้ 'cost' ที่คำนวณใหม่)
        df_pacs_device['orderQty'] = pd.to_numeric(df_pacs_device[COLS['PACS_ORDER_QTY']], errors='coerce')
        df_pacs_device['revenuePL'] = (df_pacs_device['price'] - df_pacs_device['cost']) * df_pacs_device['orderQty']
        
        # --- ▲▲▲ MODIFICATION END ▲▲▲ ---

        
        # 5. กรองแถวที่ข้อมูลไม่ครบถ้วนทิ้ง (ที่เคยทำใน loop)
        df_pacs_device = df_pacs_device[
            (df_pacs_device['orderQty'].notna()) &
            (df_pacs_device['orderQty'] != 0) &
            (df_pacs_device['yearMonth'].str.len() == 7)
        ].copy()

        # 6. เพิ่มวันที่จาก PACS (yearMonth) ลงใน set
        valid_pacs_dates = pd.to_datetime(df_pacs_device['yearMonth'] + '-01', format='%Y-%m-%d', errors='coerce').dropna()
        all_unique_dates.update(valid_pacs_dates.dt.strftime('%Y-%m-%d').unique())

        # 7. แปลง DataFrame เป็น list of dicts ที่ Frontend ต้องการ
        df_pacs_device['aeTitle'] = df_pacs_device[COLS['PACS_AE_TITLE']] 

        pacs_data_details = df_pacs_device[
            ['aeTitle', 'service_code', 'serviceName', 'yearMonth', 'orderQty', 'revenuePL']
        ].rename(columns={
            'service_code': 'serviceCode' # เปลี่ยน 'service_code' -> 'serviceCode'
        }).to_dict('records')

        # --- (ส่วนที่เหลือเหมือนเดิม) ---

        # === Install Date ===
        if install_date:
            all_unique_dates.add(install_date.strftime('%Y-%m-%d'))

        # === Timeline ===
        sorted_dates = sorted(list(all_unique_dates))
        complete_timeline = generate_date_timeline(sorted_dates)
        
        return jsonify({
            'sapMap': sap_map,
            'pacsDataDetails': pacs_data_details,
            'allUniqueDates': complete_timeline,
            'todayStr': datetime.today().strftime('%Y-%m-%d')
        })

    except Exception as e:
        print(f"Error in /api/device-data/{ae_title}: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


if __name__ == '__main__':
    print("Starting Flask server...")
    print(f"Reading Excel from: {os.path.abspath(EXCEL_FILE_PATH)}")
    if not os.path.exists(EXCEL_FILE_PATH):
        print("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!")
        print(f"!! ERROR: ไม่พบไฟล์ Excel ที่: {EXCEL_FILE_PATH}")
        print("!! กรุณาตรวจสอบการตั้งค่า EXCEL_FILE_PATH ใน app.py")
        print("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!")
    else:
        # โหลด Cache ครั้งแรกตอนเริ่ม
        get_lookup_maps()
        print("Server is running on http://127.0.0.1:5000")
        app.run(debug=True, port=5000)