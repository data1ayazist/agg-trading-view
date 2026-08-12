"""Пересборка assets/data.js из anomal-sessions.xlsx.

Запуск:  python tools/xlsx_to_data.py
Требует: openpyxl

Витрина статическая (GitHub Pages), поэтому Excel не читается в браузере —
данные один раз перекладываются в JS-модуль и коммитятся в репозиторий.
"""

import json
import sys
from datetime import date, datetime
from pathlib import Path

import openpyxl

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "anomal-sessions.xlsx"
DST = ROOT / "assets" / "data.js"

# Порядок колонок в исходном файле -> ключи в витрине.
FIELDS = [
    "date",              # Дата
    "board",             # Режим торгов
    "security",          # Ценная бумага
    "listing",           # Уровень листинга
    "closeChange",       # Изменение цены закрытия к предыдущей сессии
    "maxMinuteGain",     # Макс. прирост цены минутной свечи
    "sechist",           # Флаг sechist-критерия
    "minuteCandles",     # Флаг критерия минутных свечей
    "markingOpenClose",  # Флаг marking the open/close
    "volume",            # Объём торгов, руб.
]

# Сессия попадает в витрину только по сработавшему критерию:
# строка без единого True — не аномалия, а мусор в выгрузке.
FLAGS = ["sechist", "minuteCandles", "markingOpenClose"]


def norm(key, value):
    if key == "date":
        if isinstance(value, (datetime, date)):
            return value.strftime("%Y-%m-%d")
        return str(value)[:10]
    if key in ("listing", "volume"):
        return int(round(float(value)))
    if key in ("closeChange", "maxMinuteGain"):
        return round(float(value), 6)
    if key in ("sechist", "minuteCandles", "markingOpenClose"):
        if isinstance(value, str):
            return value.strip().lower() in ("true", "да", "1", "yes")
        return bool(value)
    return str(value).strip()


def main():
    if not SRC.exists():
        sys.exit("Не найден файл {}".format(SRC))

    ws = openpyxl.load_workbook(SRC, data_only=True).active
    rows = list(ws.iter_rows(values_only=True))
    headers = [str(h).strip() if h is not None else "" for h in rows[0]]

    if len(headers) != len(FIELDS):
        sys.exit("Ожидалось {} колонок, в файле {}: {}".format(len(FIELDS), len(headers), headers))

    sessions = []
    skipped = []
    for line, raw in enumerate(rows[1:], start=2):
        if all(v is None for v in raw):
            continue
        row = {key: norm(key, raw[i]) for i, key in enumerate(FIELDS)}
        if not any(row[f] for f in FLAGS):
            skipped.append((line, row["date"], row["security"]))
            continue
        sessions.append(row)

    for line, day, sec in skipped:
        print("ПРОПУЩЕНА строка {}: {} {} — ни один критерий не сработал".format(line, day, sec))

    payload = {
        "source": SRC.name,
        "generatedAt": datetime.now().strftime("%Y-%m-%d %H:%M"),
        "headers": dict(zip(FIELDS, headers)),
        "sessions": sessions,
    }

    body = json.dumps(payload, ensure_ascii=False, indent=2)
    DST.parent.mkdir(parents=True, exist_ok=True)
    DST.write_text(
        "/* Автогенерировано tools/xlsx_to_data.py из {} — руками не править. */\n"
        "window.MSD = window.MSD || {{}};\n"
        "window.MSD.data = {};\n".format(SRC.name, body),
        encoding="utf-8",
    )
    print("{} записей -> {}".format(len(sessions), DST.relative_to(ROOT)))


if __name__ == "__main__":
    main()
