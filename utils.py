from datetime import datetime
from dateutil.relativedelta import relativedelta
import pandas as pd


from config import TIMELINE_FUTURE_MONTHS, DATE_FORMAT_API

def robust_parse_date(date_input):
    """แปลงค่าให้เป็น datetime แบบทน error; ถ้าแปลงไม่ได้คืน None"""
    if pd.isna(date_input) or date_input is None:
        return None
    try:
        return pd.to_datetime(date_input)
    except Exception:
        return None

def generate_date_timeline(sorted_date_strings):
    if not sorted_date_strings:
        return []

    valid_dates = []
    for d in sorted_date_strings:
        if isinstance(d, str):
            try:
                valid_dates.append(datetime.strptime(d, DATE_FORMAT_API))
            except ValueError:
                continue

    if not valid_dates:
        return []

    min_date = min(valid_dates).replace(day=1)
    data_max_date = max(valid_dates)

    today = datetime.today()
    future_date = (today + relativedelta(months=TIMELINE_FUTURE_MONTHS)).replace(day=1)
    max_date = max(data_max_date, future_date)

    result = []
    current = min_date
    while current <= max_date:
        result.append(current.strftime(DATE_FORMAT_API))
        current = current + relativedelta(months=1)

    return result