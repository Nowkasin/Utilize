import os
import traceback
from flask import Flask, jsonify, render_template # type: ignore

from data_cache import get_lookup_maps
from services import get_initial_bme_map, build_device_data_response

app = Flask(__name__)


# ---------- Routes ---------- #

@app.route('/')
def index():
    # ชื่อ template ให้ตรงกับไฟล์ในโฟลเดอร์ templates
    # เช่น ถ้าใช้ index.html ตามนี้ก็โอเค
    return render_template('index.html')


@app.route('/api/initial-data')
def api_initial_data():
    try:
        bme_map = get_initial_bme_map()
        return jsonify({'bmeMap': bme_map})
    except Exception as e:
        print("Error in /api/initial-data:", e)
        traceback.print_exc()  # << เพิ่มบรรทัดนี้
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
    print("Starting Flask server (DB mode)...")

    try:
        # preload cache จาก database ตอนเริ่มต้น
        get_lookup_maps()
        print("Lookup maps & dataframes loaded from database.")
    except Exception as e:
        print("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!")
        print("!! ERROR: ไม่สามารถโหลดข้อมูลจากฐานข้อมูลได้")
        print(f"!! Detail: {e}")
        print("!! กรุณาตรวจสอบการตั้งค่า .env และการเชื่อมต่อ SQL Server")
        print("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!")
        import traceback
        traceback.print_exc()
        # **สำคัญ**: ไม่ raise แล้ว ปล่อยให้ Flask รันต่อ
        print("จะรัน Flask ต่อไป แต่ API ที่ใช้ดึงข้อมูลจาก DB จะ error จนกว่าจะแก้ connection ได้")

    print("Server is running on http://127.0.0.1:5000")
    app.run(debug=True, port=5000)
