import os

from flask import Flask, jsonify, render_template

from config import EXCEL_FILE_PATH
from data_cache import get_lookup_maps
from services import get_initial_bme_map, build_device_data_response

app = Flask(__name__)


# ---------- Routes ---------- #

@app.route('/')
def index():
    # ชื่อ template ให้ตรงกับไฟล์ในโฟลเดอร์ templates
    # เช่น ถ้าใช้ ChartDashboard.html เหมือนเดิมให้ใส่ชื่อนั้น
    return render_template('index.html')


@app.route('/api/initial-data')
def api_initial_data():
    try:
        bme_map = get_initial_bme_map()
        return jsonify({'bmeMap': bme_map})
    except Exception as e:
        print(f"Error in /api/initial-data: {e}")
        return jsonify({'error': str(e)}), 500


@app.route('/api/device-data/<string:ae_title>')
def api_device_data(ae_title):
    if not ae_title:
        return jsonify({'error': 'No AE Title provided.'}), 400

    try:
        data = build_device_data_response(ae_title)
        return jsonify(data)
    except KeyError as e:
        # ไม่เจอ AE Title
        print(f"Error in /api/device-data/{ae_title}: {e}")
        return jsonify({'error': str(e)}), 404
    except ValueError as e:
        # input ไม่ถูกต้อง
        print(f"Error in /api/device-data/{ae_title}: {e}")
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        # error อื่น ๆ
        print(f"Error in /api/device-data/{ae_title}: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


# ---------- Run ---------- #

if __name__ == '__main__':
    print("Starting Flask server...")
    print(f"Reading Excel from: {os.path.abspath(EXCEL_FILE_PATH)}")

    if not os.path.exists(EXCEL_FILE_PATH):
        print("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!")
        print(f"!! ERROR: ไม่พบไฟล์ Excel ที่: {EXCEL_FILE_PATH}")
        print("!! กรุณาตรวจสอบการตั้งค่า EXCEL_FILE_PATH ใน config.py")
        print("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!")
    else:
        # preload cache ตอนเริ่ม เพื่อให้ request แรกไม่หน่วง
        get_lookup_maps()
        print("Server is running on http://127.0.0.1:5000")
        app.run(debug=True, port=5000)
