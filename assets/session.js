/* Разбор аномальной сессии: минутные свечи, тепловые карты по часам, новостной фон.

   Витрина статическая, микроструктуры в выгрузке нет — поэтому свечи, доли участников
   и новости синтезируются здесь. Генерация детерминирована: сид считается от пары
   «дата + бумага», поэтому одна и та же сессия всегда выглядит одинаково, а ссылку
   можно переслать. Числа согласованы с выгрузкой: последняя свеча даёт ровно то
   изменение цены закрытия, а аномальная минута — ровно тот максимальный прирост. */

(function () {
  'use strict';

  var MSD = window.MSD = window.MSD || {};

  /* --- Детерминированный генератор ------------------------------- */

  function fnv(str) {
    var h = 2166136261 >>> 0;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return h >>> 0;
  }

  function mulberry(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function gauss(rand) {
    return (rand() + rand() + rand() + rand() - 2) / 1.15;
  }

  function pick(rand, list) {
    return list[Math.floor(rand() * list.length) % list.length];
  }

  /* --- Форматирование -------------------------------------------- */

  var pctSigned = new Intl.NumberFormat('ru-RU', {
    style: 'percent', minimumFractionDigits: 2, maximumFractionDigits: 2, signDisplay: 'always'
  });
  var pct2 = new Intl.NumberFormat('ru-RU', {
    style: 'percent', minimumFractionDigits: 2, maximumFractionDigits: 2
  });
  var pct1 = new Intl.NumberFormat('ru-RU', {
    style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 1
  });
  var num2 = new Intl.NumberFormat('ru-RU', {
    minimumFractionDigits: 2, maximumFractionDigits: 2
  });
  var num0 = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 });

  function mln(v) { return num2.format(v / 1e6) + ' млн ₽'; }
  function ths(v) { return num0.format(v / 1000) + ' тыс ₽'; }
  function rub(v) { return num0.format(v) + ' ₽'; }
  var longDate = new Intl.DateTimeFormat('ru-RU', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
  });

  function shortDate(iso) {
    var p = iso.split('-');
    return p[2] + '.' + p[1] + '.' + p[0];
  }

  function dayMonth(iso) {
    var p = iso.split('-');
    return p[2] + '.' + p[1];
  }

  function shiftDate(iso, days) {
    var d = new Date(iso + 'T00:00:00');
    d.setDate(d.getDate() + days);
    return d.toISOString().slice(0, 10);
  }

  function hhmm(minutes) {
    var h = Math.floor(minutes / 60), m = minutes % 60;
    return (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m;
  }

  function attr(text) {
    return String(text)
      .replace(/[&<>"]/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
      })
      .replace(/\n/g, '&#10;');
  }

  /* --- Справочники ------------------------------------------------ */

  var BOARDS = {
    TQBR: 'Т+: Акции и ДР',
    TQCB: 'Т+: Облигации',
    TQTF: 'Т+: ETF и БПИФ'
  };

  var LISTING = {
    1: 'Первый уровень котировального списка',
    2: 'Второй уровень котировального списка',
    3: 'Некотировальная часть списка'
  };

  var CRITERIA = [
    { key: 'sechist', title: 'Флаг sechist-критерия', cls: 'flag--sechist',
      note: 'Отклонение итогов сессии от исторического поведения бумаги.' },
    { key: 'minuteCandles', title: 'Флаг критерия минутных свечей', cls: 'flag--minute',
      note: 'Резкий прирост цены в пределах одной минутной свечи.' },
    { key: 'markingOpenClose', title: 'Флаг marking the open/close', cls: 'flag--marking',
      note: 'Воздействие на цену в моменты открытия и закрытия сессии.' }
  ];

  /* Клиенты, брокеры и типы приходят из универсума (assets/universe.js):
     один и тот же человек должен узнаваться и в разборе, и в рейтинге. */
  var CLIENT_TYPES = MSD.universe.types;

  /* Основная сессия: 10:00–18:39, 520 минутных свечей. */
  var SESSION_START = 10 * 60;
  var SESSION_LEN = 520;

  /* Тепловые карты: часы от 8 утра до 11 вечера. */
  var HOURS = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22];

  /* Интенсивность часа: утренняя сессия и вечерка тоньше основной. */
  var INTENSITY = {
    8: 0.10, 9: 0.14, 10: 1.00, 11: 0.85, 12: 0.60, 13: 0.55, 14: 0.60, 15: 0.70,
    16: 0.80, 17: 0.90, 18: 1.00, 19: 0.35, 20: 0.28, 21: 0.24, 22: 0.18
  };

  /* --- Свечи ------------------------------------------------------ */

  function basePrice(rand, board) {
    if (board === 'TQCB') return 95 + rand() * 12;      /* % от номинала */
    if (board === 'TQTF') return 6 + rand() * 180;
    return 24 + rand() * 560;
  }

  function anomalyIndex(row, rand) {
    if (row.markingOpenClose) {
      return rand() < 0.7
        ? SESSION_LEN - 1 - Math.floor(rand() * 8)   /* marking the close */
        : Math.floor(rand() * 8);                    /* marking the open */
    }
    return 40 + Math.floor(rand() * (SESSION_LEN - 90));
  }

  function buildCandles(row, rand) {
    var prevClose = Math.round(basePrice(rand, row.board) * 100) / 100;
    var idx = anomalyIndex(row, rand);
    var aReturn = Math.log(1 + row.maxMinuteGain);
    var total = Math.log(1 + row.closeChange);

    /* Обычные минуты — случайное блуждание, потом сдвигаем его так,
       чтобы закрытие сессии сошлось с выгрузкой до копейки. */
    var raw = [], sum = 0, i;
    for (i = 0; i < SESSION_LEN; i++) {
      if (i === idx) { raw.push(null); continue; }
      var v = gauss(rand) * 0.0011;
      raw.push(v);
      sum += v;
    }
    var shift = (total - aReturn - sum) / (SESSION_LEN - 1);

    var candles = [], price = prevClose;
    for (i = 0; i < SESSION_LEN; i++) {
      var open = price;
      var r = i === idx ? aReturn : raw[i] + shift;
      var close = open * Math.exp(r);
      var span = Math.abs(close - open);
      var wick = i === idx ? span * 0.06 : open * Math.abs(gauss(rand)) * 0.0007;

      candles.push({
        i: i,
        minute: SESSION_START + i,
        open: open,
        close: close,
        high: Math.max(open, close) + wick,
        low: Math.min(open, close) - (i === idx ? wick * 0.4 : wick),
        anomaly: i === idx
      });
      price = close;
    }

    return { prevClose: prevClose, candles: candles, anomaly: candles[idx] };
  }

  /* --- Объём торгов ------------------------------------------------ */

  function sum(list) {
    return list.reduce(function (a, b) { return a + b; }, 0);
  }

  /* Дневной объём из выгрузки разносим по часам 08–22: вес часа — его
     интенсивность, час аномалии тяжелее (разгон идёт на объёме). */
  function volumeByHour(row, rand, anomalyHour) {
    var weights = HOURS.map(function (h) {
      var w = INTENSITY[h] * (0.6 + rand() * 0.8);
      return h === anomalyHour ? w * (1.8 + rand()) : w;
    });
    var total = sum(weights);
    var byHour = weights.map(function (w) { return Math.round(row.volume * w / total); });

    /* Сумма по часам должна сойтись с выгрузкой до рубля. */
    var diff = row.volume - sum(byHour);
    var big = byHour.indexOf(Math.max.apply(null, byHour));
    byHour[big] += diff;
    return byHour;
  }

  /* Часы основной сессии дробим на минуты — под гистограмму объёма. */
  function volumeByMinute(candles, byHour, rand) {
    var buckets = {}, out = [];
    candles.forEach(function (c) {
      var h = Math.floor(c.minute / 60);
      (buckets[h] = buckets[h] || []).push(c.i);
      out.push(0);
    });

    Object.keys(buckets).forEach(function (h) {
      var list = buckets[h];
      var pos = HOURS.indexOf(+h);
      var total = pos > -1 ? byHour[pos] : 0;
      var w = list.map(function (i) {
        var base = 0.35 + rand() * rand() * 2.2;
        return candles[i].anomaly ? base * 14 : base;  /* на аномальной минуте — пик */
      });
      var s = sum(w);
      list.forEach(function (i, k) { out[i] = Math.round(total * w[k] / s); });
    });

    return out;
  }

  /* --- Участники и тепловые карты --------------------------------- */


  /* Одна карта: доли клиентов в объёме часа. Сумма столбца — ровно 100 %:
     показанные участники плюс строка «Прочие участники». */
  function buildHeat(rand, clients, kind, anomalyHour, suspect) {
    var cells = clients.map(function () { return []; });
    var others = [];

    HOURS.forEach(function (hour) {
      var power = INTENSITY[hour];
      var i;

      /* Тонкие часы (утро, поздний вечер) иногда проходят вообще без сделок. */
      if (power < 0.2 && rand() < 0.45) {
        for (i = 0; i < clients.length; i++) cells[i].push(0);
        others.push(0);
        return;
      }

      var live = [];
      for (i = 0; i < clients.length; i++) {
        var active = rand() < 0.22 + 0.62 * power;
        live.push(active ? clients[i].weight * (0.25 + rand() * rand() * 1.8) : 0);
      }

      /* Чем тоньше час, тем выше концентрация в показанном топе. */
      var shown = (kind === 'sells' ? 0.34 : 0.38) + (1 - power) * 0.32 + rand() * 0.16;
      shown = Math.min(shown, 0.92);

      var boost = 0;
      if (hour === anomalyHour && kind !== 'sells') {
        /* В час аномалии агрессор виден невооружённым глазом. */
        boost = (kind === 'taker' ? 0.38 : 0.26) + rand() * 0.14;
        shown = Math.min(0.94, Math.max(shown, boost + 0.22));
        live[suspect] = 0;
      }

      var sum = live.reduce(function (a, b) { return a + b; }, 0);
      var rest = shown - boost;

      for (i = 0; i < clients.length; i++) {
        if (i === suspect && boost) cells[i].push(boost);
        else cells[i].push(sum > 0 ? (live[i] / sum) * rest : 0);
      }
      others.push(sum > 0 ? 1 - shown : 1 - boost);
    });

    var max = 0;
    cells.forEach(function (row) {
      row.forEach(function (v) { if (v > max) max = v; });
    });

    return { cells: cells, others: others, max: max };
  }

  /* --- Метрики агрессивных трейдеров ------------------------------- */

  /* «Длинная свеча роста» — зелёная минута, тело которой попало в верхний
     дециль по всей сессии. Именно в такие минуты интересно смотреть, кто покупал. */
  function longGrowthCandles(candles, volumes) {
    var bodies = [];
    candles.forEach(function (c) {
      if (c.close > c.open) bodies.push((c.close - c.open) / c.open);
    });
    if (!bodies.length) return { count: 0, volume: 0, threshold: 0 };

    bodies.sort(function (a, b) { return a - b; });
    var threshold = bodies[Math.floor(bodies.length * 0.9)];

    var count = 0, volume = 0;
    candles.forEach(function (c) {
      if (c.close > c.open && (c.close - c.open) / c.open >= threshold) {
        count++;
        volume += volumes[c.i];
      }
    });
    return { count: count, volume: volume, threshold: threshold };
  }

  function weighted(values, base) {
    return values.reduce(function (a, v, i) { return a + v * base[i]; }, 0);
  }

  /* Распределяем остаточный объём («Прочие участники» тепловых карт)
     между клиентами вне топ-8. */
  function spread(rand, clients, total) {
    var w = clients.map(function (c) { return c.weight * (0.15 + rand() * rand() * 2.4); });
    var s = sum(w) || 1;
    return w.map(function (v) { return total * v / s; });
  }

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  function buildTraders(ctx) {
    var row = ctx.row, rand = ctx.rand, byHour = ctx.byHour, heats = ctx.heats;

    /* Тейкерская часть оборота часа — база для долей карты «Тейкерские покупки». */
    var takerHour = byHour.map(function (v) { return v * (0.34 + rand() * 0.22); });
    var takerTotal = sum(takerHour);

    var core = {};
    ctx.core.forEach(function (c, i) {
      core[c.id] = true;
      c.buyVolume = weighted(heats.buys.cells[i], byHour);
      c.takerVolume = weighted(heats.taker.cells[i], takerHour);
      c.sellVolume = weighted(heats.sells.cells[i], byHour);
    });

    var rest = ctx.all.filter(function (c) { return !core[c.id]; });
    var restBuy = spread(rand, rest, weighted(heats.buys.others, byHour));
    var restTaker = spread(rand, rest, weighted(heats.taker.others, takerHour));
    var restSell = spread(rand, rest, weighted(heats.sells.others, byHour));

    rest.forEach(function (c, i) {
      c.buyVolume = restBuy[i];
      c.takerVolume = restTaker[i];
      c.sellVolume = restSell[i];
    });

    var longBase = ctx.longCandles.volume / (ctx.mainVolume || 1);

    ctx.all.forEach(function (c) {
      var hot = c.id === ctx.suspectId;

      c.buyShare = row.volume ? c.buyVolume / row.volume : 0;
      c.takerShare = takerTotal ? c.takerVolume / takerTotal : 0;

      c.longBuyShare = clamp(longBase * (0.35 + rand() * 1.5) * (hot ? 3.4 + rand() : 1), 0, 0.94);
      c.longTakerShare = clamp(c.longBuyShare * (0.7 + rand() * 0.7) * (hot ? 1.25 : 1), 0, 0.97);

      c.bigOrders = hot ? 17 + Math.floor(rand() * 23)
                        : Math.floor(rand() * rand() * 13);
      c.priceLevels = hot ? 24 + Math.floor(rand() * 31)
                          : 1 + Math.floor(rand() * rand() * 18);

      /* Реализованная прибыль по FIFO: закрывается только сопоставленная часть
         покупок и продаж, результат — оборот закрытой части на пройденный путь цены. */
      var matched = Math.min(c.buyVolume, c.sellVolume);
      var edge = hot ? row.maxMinuteGain * (0.35 + rand() * 0.45)
                     : gauss(rand) * 0.006;
      c.matched = matched;
      c.edge = edge;
      c.pnl = matched * edge;
    });

    return ctx.all;
  }

  /* --- Таблица метрик: колонки ------------------------------------- */

  function volTip(client, session) {
    return 'Покупки: ' + rub(client.buyVolume) + '\nТейкерские покупки: ' + rub(client.takerVolume) +
           '\nОбъём сессии: ' + rub(session.volume);
  }

  var METRICS = [
    { key: 'buyShare', label: 'Доля покупок клиента от всех сделок по бумаге',
      head: 'Объём покупок клиента, делённый на объём торгов бумагой за сессию.',
      text: function (c) { return pct1.format(c.buyShare); },
      tip: function (c, s) { return 'Доля покупок: ' + pct2.format(c.buyShare) + '\n' + volTip(c, s); } },

    { key: 'takerShare', label: 'Доля тейкерских покупок от всех тейкерских покупок',
      head: 'Доля клиента в агрессивных покупках — сделках по встречным заявкам.',
      text: function (c) { return pct1.format(c.takerShare); },
      tip: function (c, s) { return 'Доля тейкерских покупок: ' + pct2.format(c.takerShare) + '\n' + volTip(c, s); } },

    { key: 'buyVolume', label: 'Суммарный объём покупок, млн ₽',
      head: 'Сумма покупок клиента за сессию.',
      text: function (c) { return num2.format(c.buyVolume / 1e6); },
      tip: function (c, s) { return 'Объём покупок: ' + rub(c.buyVolume) + '\nДоля от сессии: ' + pct2.format(c.buyShare); } },

    { key: 'takerVolume', label: 'Суммарный тейкерский объём покупок, млн ₽',
      head: 'Сумма агрессивных покупок клиента за сессию.',
      text: function (c) { return num2.format(c.takerVolume / 1e6); },
      tip: function (c, s) {
        var part = c.buyVolume ? c.takerVolume / c.buyVolume : 0;
        return 'Тейкерский объём: ' + rub(c.takerVolume) + '\nЭто ' + pct1.format(part) + ' покупок клиента';
      } },

    { key: 'longBuyShare', label: 'Доля покупок в длинных минутных свечах роста',
      head: 'Какая часть покупок клиента пришлась на минуты с самым длинным зелёным телом.',
      text: function (c) { return pct1.format(c.longBuyShare); },
      tip: function (c, s) {
        return 'Доля покупок в длинных свечах роста: ' + pct2.format(c.longBuyShare) +
               '\nОбъём: ' + rub(c.buyVolume * c.longBuyShare);
      } },

    { key: 'longTakerShare', label: 'Доля тейкерских покупок в длинных минутных свечах роста',
      head: 'То же для агрессивных покупок: покупал ли клиент именно в момент рывка.',
      text: function (c) { return pct1.format(c.longTakerShare); },
      tip: function (c, s) {
        return 'Доля тейкерских покупок в длинных свечах роста: ' + pct2.format(c.longTakerShare) +
               '\nОбъём: ' + rub(c.takerVolume * c.longTakerShare);
      } },

    { key: 'bigOrders', label: 'Больших тейкерских заявок на покупку',
      head: 'Число агрессивных заявок клиента, крупных относительно среднего размера заявки по рынку.',
      text: function (c) { return num0.format(c.bigOrders); },
      tip: function (c, s) { return 'Больших тейкерских заявок: ' + num0.format(c.bigOrders) + '\nСравнение со средним размером заявки по рынку.'; } },

    { key: 'priceLevels', label: 'Ценовых уровней, покрытых тейкерскими сделками',
      head: 'Сколько ценовых уровней стакана клиент выбрал агрессивными сделками.',
      text: function (c) { return num0.format(c.priceLevels); },
      tip: function (c, s) { return 'Ценовых уровней: ' + num0.format(c.priceLevels) + '\nЧем больше уровней, тем глубже сняты встречные заявки.'; } },

    { key: 'pnl', label: 'Реализованная прибыль за сессию (FIFO), тыс ₽',
      head: 'Результат по закрытой части позиции, сопоставление FIFO.',
      text: function (c) { return num2.format(c.pnl / 1000); },
      tip: function (c, s) {
        return 'Реализованная прибыль (FIFO): ' + rub(c.pnl) +
               '\nЗакрытая часть: ' + rub(c.matched) + '\nСредний результат: ' + pctSigned.format(c.edge);
      } }
  ];

  var BASE_COLS = [
    { key: 'code', label: 'Код клиента', cls: 'cell-client', text: function (c) { return c.code; },
      head: 'Код клиента у брокера, без префикса — брокер вынесен в соседний столбец.',
      tip: function (c, s) {
        return 'Код клиента: ' + c.code + '\nБрокер: ' + c.broker + ' · ИНН ' + c.inn +
               '\nТип клиента: ' + c.type + '\nВ тепловых картах: ' + c.id;
      } },
    { key: 'broker', label: 'Брокер', cls: 'cell-dim', text: function (c) { return c.broker; },
      head: 'Брокер, через которого работает клиент.',
      tip: function (c) { return c.broker + '\nИНН ' + c.inn; } },
    { key: 'inn', label: 'ИНН брокера', cls: 'cell-dim', text: function (c) { return c.inn; },
      head: 'ИНН брокера — синтетический, как и весь разбор.',
      tip: function (c) { return 'ИНН ' + c.inn + ' — ' + c.broker; } },
    { key: 'type', label: 'Тип клиента', cls: 'cell-dim', text: function (c) { return c.type; },
      head: 'ЮЛ, ФЛ или нерезидент.',
      tip: function (c) { return 'Тип клиента: ' + c.type; } }
  ];

  /* --- Таблица метрик: состояние и отрисовка ------------------------ */

  var T = {
    rows: [], session: null, suspectId: '',
    perPage: 20, page: 1,
    sort: { key: 'score', dir: 'desc' },
    types: [], inn: '',
    weights: {}
  };

  function resetWeights() {
    METRICS.forEach(function (m) { T.weights[m.key] = 1; });
  }

  function filtered() {
    return T.rows.filter(function (c) {
      if (T.types.length && T.types.indexOf(c.type) === -1) return false;
      if (T.inn && c.inn !== T.inn) return false;
      return true;
    });
  }

  /* Индекс агрессивности: метрики нормируются по видимой выборке
     и складываются с заданными весами. */
  function score(rows) {
    var bounds = {};
    METRICS.forEach(function (m) {
      var min = Infinity, max = -Infinity;
      rows.forEach(function (c) {
        if (c[m.key] < min) min = c[m.key];
        if (c[m.key] > max) max = c[m.key];
      });
      bounds[m.key] = { min: min, max: max };
    });

    rows.forEach(function (c) {
      var acc = 0, total = 0;
      METRICS.forEach(function (m) {
        var w = T.weights[m.key];
        var b = bounds[m.key];
        var norm = b.max > b.min ? (c[m.key] - b.min) / (b.max - b.min) : 0;
        acc += w * norm;
        total += w;
      });
      c.score = total ? acc / total : 0;
    });
  }

  function sortTraders(rows) {
    var key = T.sort.key;
    var sign = T.sort.dir === 'asc' ? 1 : -1;

    return rows.slice().sort(function (a, b) {
      var x = a[key], y = b[key], d;
      if (typeof x === 'string') d = x.localeCompare(y, 'ru');
      else d = x - y;
      if (d) return d * sign;
      return b.score - a.score;
    });
  }

  function renderTradersHead() {
    var cols = BASE_COLS.concat(METRICS);
    document.getElementById('t-head').innerHTML = '<tr>' + cols.map(function (col, i) {
      var num = i >= BASE_COLS.length;
      var active = T.sort.key === col.key;
      var weight = num ? '\nВес в сортировке: ' + num2.format(T.weights[col.key]) : '';
      return '<th scope="col" class="' + (num ? 'th--num' : '') + '">' +
        '<button type="button" class="sort' + (active ? ' is-active' : '') + '" data-tkey="' +
        attr(col.key) + '" data-tip="' + attr((i + 1) + '. ' + col.label + '\n' + col.head + weight) + '">' +
        attr(col.label) + '<span class="sort__mark" aria-hidden="true">' +
        (active ? (T.sort.dir === 'asc' ? '▲' : '▼') : '') + '</span></button></th>';
    }).join('') + '</tr>';
  }

  function pagerHtml(page, pages) {
    if (pages < 2) return '';

    var list = [], i;
    if (pages <= 7) {
      for (i = 1; i <= pages; i++) list.push(i);
    } else {
      list.push(1);
      if (page > 3) list.push('…');
      for (i = Math.max(2, page - 1); i <= Math.min(pages - 1, page + 1); i++) list.push(i);
      if (page < pages - 2) list.push('…');
      list.push(pages);
    }

    var btn = function (p, text, extra) {
      return '<button type="button" class="pager__btn" data-page="' + p + '"' + (extra || '') + '>' + text + '</button>';
    };

    return btn(page - 1, '←', (page === 1 ? ' disabled' : '') + ' aria-label="Предыдущая страница"') +
      list.map(function (p) {
        if (p === '…') return '<span class="pager__gap">…</span>';
        return btn(p, p, p === page ? ' aria-current="true"' : '');
      }).join('') +
      btn(page + 1, '→', (page === pages ? ' disabled' : '') + ' aria-label="Следующая страница"');
  }

  /* Сетку ползунков перерисовываем только при смене сессии и по сбросу:
     иначе пересчёт по дебаунсу вырывал бы ползунок из-под курсора. */
  function renderWeightsGrid() {
    document.getElementById('t-weights-grid').innerHTML = METRICS.map(function (m, i) {
      var w = T.weights[m.key];
      return '<div class="weight' + (w === 0 ? ' is-off' : '') + '">' +
        '<span class="weight__label" data-tip="' + attr(m.label + '\n' + m.head) + '">' +
        (i + 5) + '. ' + attr(m.label.split(',')[0]) + '</span>' +
        '<input type="range" class="weight__slider" min="0" max="1" step="0.05" value="' + w +
        '" data-weight="' + attr(m.key) + '" aria-label="' + attr('Вес: ' + m.label) + '">' +
        '<span class="weight__value">' + num2.format(w) + '</span></div>';
    }).join('');
  }

  function renderWeightsNote() {
    document.getElementById('t-weights-note').innerHTML = T.sort.key === 'score'
      ? 'Порядок клиентов — по индексу агрессивности: метрики 5–13 нормируются по видимой выборке и складываются с этими весами.'
      : 'Сейчас список отсортирован по столбцу таблицы. ' +
        '<button type="button" class="btn-quiet" data-tsort="score">Вернуть сортировку по индексу</button>';
  }

  function renderTraders() {
    var rows = filtered();
    score(rows);

    var pages = Math.max(1, Math.ceil(rows.length / T.perPage));
    T.page = Math.min(Math.max(1, T.page), pages);

    var sorted = sortTraders(rows);
    var from = (T.page - 1) * T.perPage;
    var page = sorted.slice(from, from + T.perPage);
    var cols = BASE_COLS.concat(METRICS);
    var s = T.session;

    document.getElementById('t-body').innerHTML = page.map(function (c) {
      return '<tr' + (c.id === T.suspectId ? ' class="is-suspect"' : '') +
        ' data-href="#/client/' + attr(c.code) + '" role="link" tabindex="0" aria-label="' +
        attr('Карточка клиента ' + c.code) + '">' + cols.map(function (col, i) {
        var num = i >= BASE_COLS.length;
        var cls = num ? 'cell-num' : col.cls;
        if (col.key === 'pnl') cls += c.pnl > 0 ? ' delta--up' : (c.pnl < 0 ? ' delta--down' : '');
        return '<td class="' + cls + '" data-tip="' + attr(col.tip(c, s)) + '">' +
               attr(col.text(c)) + '</td>';
      }).join('') + '</tr>';
    }).join('');

    document.getElementById('t-count').innerHTML = rows.length
      ? 'Показаны <b>' + (from + 1) + '–' + (from + page.length) + '</b> из <b>' + rows.length +
        '</b> клиентов' + (rows.length === T.rows.length ? '' : ' (всего в сессии ' + T.rows.length + ')')
      : 'Под фильтры не попал ни один клиент';

    document.getElementById('t-count').setAttribute('data-tip',
      'Клиентов в сессии: ' + T.rows.length + '\nПосле фильтров: ' + rows.length +
      '\nНа странице: ' + T.perPage);

    document.getElementById('t-pager').innerHTML = pagerHtml(T.page, pages);

    renderTradersHead();
    renderWeightsNote();
  }

  function renderTradersControls(row, longCandles) {
    var types = CLIENT_TYPES.filter(function (t) {
      return T.rows.some(function (c) { return c.type === t; });
    });

    document.getElementById('t-types').innerHTML = types.map(function (t) {
      var n = T.rows.filter(function (c) { return c.type === t; }).length;
      return '<button type="button" class="chip" data-ttype="' + attr(t) + '" aria-pressed="' +
        (T.types.indexOf(t) > -1) + '" data-tip="' + attr(t + '\nКлиентов в сессии: ' + n) + '">' +
        attr(t) + '</button>';
    }).join('');

    var brokers = [];
    T.rows.forEach(function (c) {
      if (!brokers.some(function (b) { return b.inn === c.inn; })) {
        brokers.push({ name: c.broker, inn: c.inn });
      }
    });
    brokers.sort(function (a, b) { return a.name.localeCompare(b.name, 'ru'); });

    document.getElementById('t-inn').innerHTML =
      '<option value="">Все брокеры</option>' + brokers.map(function (b) {
        return '<option value="' + attr(b.inn) + '">' + attr(b.name + ' · ' + b.inn) + '</option>';
      }).join('');

    document.getElementById('t-note').textContent =
      'Клиентов в сессии: ' + T.rows.length + ' · длинных свечей роста: ' + longCandles.count +
      ' · синтетические демо-данные';
  }

  /* --- Таблица метрик: события ------------------------------------- */

  document.addEventListener('click', function (e) {
    var sortBtn = e.target.closest('[data-tkey]');
    if (sortBtn) {
      var key = sortBtn.dataset.tkey;
      if (T.sort.key === key) T.sort.dir = T.sort.dir === 'desc' ? 'asc' : 'desc';
      else T.sort = { key: key, dir: 'desc' };   /* по умолчанию — по убыванию */
      T.page = 1;
      renderTraders();
      return;
    }

    var back = e.target.closest('[data-tsort="score"]');
    if (back) {
      T.sort = { key: 'score', dir: 'desc' };
      T.page = 1;
      renderTraders();
      return;
    }

    var chip = e.target.closest('[data-ttype]');
    if (chip) {
      var type = chip.dataset.ttype;
      var at = T.types.indexOf(type);
      if (at > -1) T.types.splice(at, 1); else T.types.push(type);
      chip.setAttribute('aria-pressed', at > -1 ? 'false' : 'true');
      T.page = 1;
      renderTraders();
      return;
    }

    var pageBtn = e.target.closest('.pager__btn[data-page]');
    if (pageBtn && !pageBtn.disabled) {
      T.page = +pageBtn.dataset.page;
      renderTraders();
      return;
    }

    /* Клиент из разбора открывается в своей карточке — это тот же человек,
       что и в рейтинге между сессиями. */
    var clientRow = e.target.closest('#t-body tr[data-href]');
    if (clientRow) {
      location.hash = clientRow.dataset.href;
      return;
    }

    var toggle = e.target.closest('#t-weights-toggle');
    if (toggle) {
      var panel = document.getElementById('t-weights');
      var open = panel.hidden;
      panel.hidden = !open;
      toggle.setAttribute('aria-expanded', String(open));
      toggle.textContent = open ? 'Свернуть настройку сортировки' : 'Перенастроить сортировку';
      return;
    }

    if (e.target.closest('#t-weights-reset')) {
      resetWeights();
      T.sort = { key: 'score', dir: 'desc' };
      T.page = 1;
      renderWeightsGrid();
      renderTraders();
    }
  });

  document.getElementById('t-inn').addEventListener('change', function (e) {
    T.inn = e.target.value;
    T.page = 1;
    renderTraders();
  });

  var weightTimer = null;
  document.getElementById('t-weights').addEventListener('input', function (e) {
    var slider = e.target.closest('[data-weight]');
    if (!slider) return;

    var value = +slider.value;
    slider.parentNode.querySelector('.weight__value').textContent = num2.format(value);
    slider.parentNode.classList.toggle('is-off', value === 0);

    /* Вес применяем сразу — иначе быстрый сдвиг двух ползунков подряд
       потерял бы первый; по дебаунсу идёт только пересчёт таблицы. */
    T.weights[slider.dataset.weight] = value;

    clearTimeout(weightTimer);
    weightTimer = setTimeout(function () {
      if (T.sort.key !== 'score') T.sort = { key: 'score', dir: 'desc' };
      renderTraders();
    }, 220);
  });

  /* --- Новостной фон ---------------------------------------------- */

  function money(rand, from, to) {
    return num2.format(from + rand() * (to - from));
  }

  /* Отчётный период, о котором эмитент говорил бы в эту дату. */
  function period(iso) {
    var y = +iso.slice(0, 4), m = +iso.slice(5, 7);
    if (m <= 3) return 'IV квартал ' + (y - 1);
    if (m <= 6) return 'I квартал ' + y;
    if (m <= 9) return 'I полугодие ' + y;
    return '9 месяцев ' + y;
  }

  /* Корпоративные события эмитента: отчётность и финрезультаты, смена
     менеджмента, сделки с активами, решения по капиталу, операционка. */
  function issuerNews(row, rand) {
    var per = period(row.date);
    var ahead = function (min, max) {
      return shortDate(shiftDate(row.date, min + Math.floor(rand() * (max - min))));
    };
    var yoy = function (a, b) { return pctSigned.format(a + rand() * (b - a)); };

    return [
      { cat: 'Отчётность', src: 'Раскрытие',
        text: 'Отчётность по МСФО за ' + per + ': выручка ' + yoy(-0.08, 0.32) +
              ' г/г, чистая прибыль ' + yoy(-0.28, 0.46) + ' г/г.' },
      { cat: 'Отчётность', src: 'Пресс-релиз эмитента',
        text: 'Финансовые результаты за ' + per + ': EBITDA ' + money(rand, 3, 88) +
              ' млрд ₽, рентабельность ' + pct1.format(0.09 + rand() * 0.3) + '.' },
      { cat: 'Отчётность', src: 'Сообщение эмитента',
        text: 'Публикация отчётности за ' + per + ' перенесена на ' + ahead(3, 21) +
              ' по решению менеджмента.' },
      { cat: 'Отчётность', src: 'Пресс-релиз эмитента',
        text: 'Компания подтвердила годовой прогноз: рост выручки на ' +
              pct1.format(0.04 + rand() * 0.18) + ', капзатраты без изменений.' },

      { cat: 'Менеджмент', src: 'Раскрытие',
        text: 'Совет директоров назначил нового генерального директора; прежний покинул пост по соглашению сторон.' },
      { cat: 'Менеджмент', src: 'Раскрытие',
        text: 'Финансовый директор покидает компанию с ' + ahead(5, 30) +
              '; обязанности временно исполняет его заместитель.' },
      { cat: 'Менеджмент', src: 'Сообщение эмитента',
        text: 'В совет директоров выдвинуты ' + (2 + Math.floor(rand() * 4)) +
              ' новых кандидата, внеочередное собрание акционеров — ' + ahead(14, 45) + '.' },

      { cat: 'Сделки M&A', src: 'Пресс-релиз эмитента',
        text: 'Закрыта сделка по покупке ' + pct1.format(0.25 + rand() * 0.74) +
              ' в профильном активе; консолидация в отчётности с ' + per + '.' },
      { cat: 'Сделки M&A', src: 'Отраслевое СМИ',
        text: 'Компания ведёт переговоры о приобретении конкурента; сумма сделки не раскрывается.' },
      { cat: 'Сделки M&A', src: 'Раскрытие',
        text: 'Одобрена продажа непрофильного актива, ожидаемый эффект — ' +
              money(rand, 0.4, 24) + ' млрд ₽.' },
      { cat: 'Сделки M&A', src: 'Раскрытие',
        text: 'Получено согласие регулятора на консолидацию доли до ' +
              pct1.format(0.5 + rand() * 0.45) + '.' },

      { cat: 'Капитал', src: 'Раскрытие',
        text: 'Совет директоров рекомендовал дивиденды — ' + money(rand, 1.5, 34) +
              ' ₽ на бумагу, дата отсечки ' + ahead(20, 60) + '.' },
      { cat: 'Капитал', src: 'Пресс-релиз эмитента',
        text: 'Объявлена программа обратного выкупа объёмом до ' + money(rand, 1, 30) + ' млрд ₽.' },
      { cat: 'Капитал', src: 'Раскрытие',
        text: 'Акционеры утвердили допэмиссию в размере ' + pct1.format(0.03 + rand() * 0.12) +
              ' уставного капитала.' },

      { cat: 'Операционные', src: 'Пресс-релиз эмитента',
        text: 'Операционные результаты за ' + per + ': объём продаж ' + yoy(-0.12, 0.28) + ' г/г.' },
      { cat: 'Операционные', src: 'Сообщение эмитента',
        text: 'Запущена новая производственная линия, инвестиции — ' +
              money(rand, 0.3, 18) + ' млрд ₽.' }
    ];
  }

  /* Для ETF и БПИФ роль эмитента играет управляющая компания. */
  function fundNews(row, rand) {
    return [
      { cat: 'Отчётность', src: 'Управляющая компания',
        text: 'Опубликована отчётность фонда за ' + period(row.date) +
              ': стоимость чистых активов — ' + money(rand, 1.2, 64) + ' млрд ₽.' },
      { cat: 'Менеджмент', src: 'Управляющая компания',
        text: 'Сменился портфельный управляющий фонда; инвестиционная декларация не менялась.' },
      { cat: 'Капитал', src: 'Управляющая компания',
        text: 'Снижена комиссия за управление — до ' + pct1.format(0.004 + rand() * 0.012) + ' годовых.' },
      { cat: 'Сделки M&A', src: 'Пресс-релиз',
        text: 'Управляющая компания сообщила о присоединении другого фонда линейки.' },
      { cat: 'Операционные', src: 'Управляющая компания',
        text: 'Чистый приток средств в фонд за неделю — ' + money(rand, 12, 480) + ' млн ₽.' }
    ];
  }

  function buildNews(row, rand) {
    var pool = row.board === 'TQTF' ? fundNews(row, rand) : issuerNews(row, rand);

    /* По одному событию из разных категорий — фон должен быть разнородным. */
    var byCat = {};
    pool.forEach(function (it) {
      (byCat[it.cat] = byCat[it.cat] || []).push(it);
    });

    var cats = Object.keys(byCat).sort(function () { return rand() - 0.5; });
    var items = cats.slice(0, 4).map(function (cat) {
      var list = byCat[cat];
      var it = list[Math.floor(rand() * list.length)];
      return {
        date: shiftDate(row.date, -Math.floor(rand() * 10)),
        cat: it.cat,
        src: it.src,
        text: it.text
      };
    });

    items.sort(function (a, b) { return a.date < b.date ? 1 : -1; });
    return items;
  }

  /* --- Отрисовка: параметры сессии -------------------------------- */

  function renderMeta(row, model) {
    var dl = document.getElementById('s-meta');
    var flagsHost = document.getElementById('s-flags');

    var items = [
      { label: 'Дата', value: shortDate(row.date), tip: longDate.format(new Date(row.date + 'T00:00:00')) },
      { label: 'Режим торгов', value: row.board, tip: row.board + ' — ' + (BOARDS[row.board] || 'режим торгов') },
      { label: 'Ценная бумага', value: row.security, tip: row.security + ' · ' + row.board },
      { label: 'Уровень листинга', value: String(row.listing), tip: LISTING[row.listing] },
      { label: 'Изменение цены закрытия', value: pctSigned.format(row.closeChange),
        cls: row.closeChange > 0 ? 'delta--up' : (row.closeChange < 0 ? 'delta--down' : 'delta--flat'),
        tip: 'К закрытию предыдущей сессии.\nДоля: ' + row.closeChange.toFixed(4) +
             '\nЗакрытие предыдущей сессии: ' + num2.format(model.prevClose) +
             '\nЗакрытие этой сессии: ' + num2.format(model.candles[model.candles.length - 1].close) },
      { label: 'Макс. прирост минутной свечи', value: pct2.format(row.maxMinuteGain),
        tip: 'Минута ' + hhmm(model.anomaly.minute) + '\nОткрытие ' + num2.format(model.anomaly.open) +
             ' → закрытие ' + num2.format(model.anomaly.close) + '\nДоля: ' + row.maxMinuteGain.toFixed(4) },
      { label: 'Объём торгов, млн ₽', value: num2.format(row.volume / 1e6),
        tip: 'Объём торгов за сессию: ' + rub(row.volume) +
             '\nОсновная сессия 10:00–18:39: ' + mln(model.mainVolume) +
             '\nУтро и вечерняя сессия: ' + mln(row.volume - model.mainVolume) }
    ];

    dl.innerHTML = items.map(function (it) {
      return '<div class="meta__item" data-tip="' + attr(it.tip) + '">' +
             '<dt>' + attr(it.label) + '</dt>' +
             '<dd class="' + (it.cls || '') + '">' + attr(it.value) + '</dd></div>';
    }).join('');

    flagsHost.innerHTML = CRITERIA.map(function (c) {
      var on = !!row[c.key];
      var tip = c.title + ': ' + (on ? 'сработал' : 'не сработал') + '\n' + c.note;
      return '<span class="flag ' + (on ? c.cls : 'flag--off') + '" data-tip="' + attr(tip) + '">' +
             attr(c.title.replace('Флаг ', '')) + ' · ' + (on ? 'да' : 'нет') + '</span>';
    }).join('');
  }

  /* --- Отрисовка: свечи ------------------------------------------- */

  var CHART = { padTop: 12, priceH: 176, gap: 10, volH: 46, footH: 30, pitch: 3, axisW: 58 };
  CHART.volTop = CHART.padTop + CHART.priceH + CHART.gap;
  CHART.volBottom = CHART.volTop + CHART.volH;
  CHART.h = CHART.volBottom + CHART.footH;

  function renderChart(row, model) {
    var candles = model.candles;
    var volumes = model.minuteVolume;
    var plotH = CHART.priceH;
    var width = candles.length * CHART.pitch + 8;
    var maxVol = Math.max.apply(null, volumes) || 1;

    var hi = -Infinity, lo = Infinity;
    candles.forEach(function (c) {
      if (c.high > hi) hi = c.high;
      if (c.low < lo) lo = c.low;
    });
    if (model.prevClose > hi) hi = model.prevClose;
    if (model.prevClose < lo) lo = model.prevClose;
    var pad = (hi - lo) * 0.08 || 1;
    hi += pad; lo -= pad;

    function y(p) { return CHART.padTop + (hi - p) / (hi - lo) * plotH; }

    var ticks = [], k;
    for (k = 0; k <= 4; k++) ticks.push(lo + (hi - lo) * k / 4);

    /* Сетка и ось времени */
    var svg = ticks.map(function (p) {
      return '<line class="chart__grid" x1="0" x2="' + width + '" y1="' + y(p).toFixed(1) +
             '" y2="' + y(p).toFixed(1) + '"/>';
    });

    svg.push('<line class="chart__prev" x1="0" x2="' + width + '" y1="' + y(model.prevClose).toFixed(1) +
             '" y2="' + y(model.prevClose).toFixed(1) + '"/>');

    svg.push('<line class="chart__base" x1="0" x2="' + width + '" y1="' + CHART.volBottom +
             '" y2="' + CHART.volBottom + '"/>');

    candles.forEach(function (c) {
      if (c.i % 30) return;
      var x = c.i * CHART.pitch + 4;
      svg.push('<line class="chart__tick" x1="' + x + '" x2="' + x + '" y1="' + CHART.volBottom +
               '" y2="' + (CHART.volBottom + 4) + '"/>');
      svg.push('<text class="chart__time" x="' + x + '" y="' + (CHART.volBottom + 16) + '">' +
               hhmm(c.minute) + '</text>');
    });

    /* Свечи */
    candles.forEach(function (c) {
      var x = c.i * CHART.pitch + 4;
      var up = c.close >= c.open;
      var cls = up ? 'is-up' : 'is-down';
      var top = y(Math.max(c.open, c.close));
      var bottom = y(Math.min(c.open, c.close));
      var h = Math.max(1, bottom - top);
      var change = (c.close - c.open) / c.open;

      var vol = volumes[c.i];
      var volH = Math.max(vol > 0 ? 1 : 0, vol / maxVol * CHART.volH);

      var tip = hhmm(c.minute) + (c.anomaly ? ' · аномальная минута' : '') +
                '\nO ' + num2.format(c.open) + '  H ' + num2.format(c.high) +
                '\nL ' + num2.format(c.low) + '  C ' + num2.format(c.close) +
                '\nИзменение за минуту: ' + pctSigned.format(change) +
                '\nОбъём: ' + ths(vol);

      svg.push('<line class="candle__wick ' + cls + '" x1="' + x + '" x2="' + x +
               '" y1="' + y(c.high).toFixed(1) + '" y2="' + y(c.low).toFixed(1) + '"/>');
      svg.push('<rect class="candle__body ' + cls + '" x="' + (x - 1) + '" y="' + top.toFixed(1) +
               '" width="2" height="' + h.toFixed(1) + '"/>');
      svg.push('<rect class="candle__vol ' + cls + '" x="' + (x - 1) + '" y="' +
               (CHART.volBottom - volH).toFixed(1) + '" width="2" height="' + volH.toFixed(1) + '"/>');

      if (c.anomaly) {
        svg.push('<rect class="candle__mark" x="' + (x - 2.5) + '" y="' + CHART.padTop +
                 '" width="5" height="' + (CHART.volBottom - CHART.padTop) + '"/>');
      }

      svg.push('<rect class="candle__hit" x="' + (x - CHART.pitch / 2) + '" y="' + CHART.padTop +
               '" width="' + CHART.pitch + '" height="' + (CHART.volBottom - CHART.padTop) +
               '" data-tip="' + attr(tip) + '"/>');
    });

    var plot = document.getElementById('s-chart');
    plot.setAttribute('width', width);
    plot.setAttribute('height', CHART.h);
    plot.setAttribute('viewBox', '0 0 ' + width + ' ' + CHART.h);
    plot.innerHTML = svg.join('');

    /* Ценовая шкала — отдельной неподвижной колонкой слева. */
    var axis = document.getElementById('s-axis');
    axis.setAttribute('width', CHART.axisW);
    axis.setAttribute('height', CHART.h);
    axis.setAttribute('viewBox', '0 0 ' + CHART.axisW + ' ' + CHART.h);
    axis.innerHTML = ticks.map(function (p) {
      return '<text class="chart__price" x="' + (CHART.axisW - 8) + '" y="' + (y(p) + 3.5).toFixed(1) +
             '">' + num2.format(p) + '</text>';
    }).join('') +
      '<text class="chart__price" x="' + (CHART.axisW - 8) + '" y="' + (CHART.volTop + 8) + '">' +
      num0.format(maxVol / 1000) + ' тыс</text>' +
      '<text class="chart__price" x="' + (CHART.axisW - 8) + '" y="' + (CHART.volBottom - 1) +
      '">объём</text>';

    var unit = row.board === 'TQCB' ? '% от номинала' : '₽';
    document.getElementById('s-chart-note').textContent =
      'Основная сессия, 10:00–18:39 · ' + candles.length + ' свечей · цена в ' + unit +
      ' · объём в ₽';

    document.getElementById('s-chart-foot').innerHTML =
      '<span class="key key--up"></span>рост · <span class="key key--down"></span>падение · ' +
      '<span class="key key--mark"></span>аномальная минута ' + hhmm(model.anomaly.minute) +
      ' (' + attr(pct2.format(row.maxMinuteGain)) + ') · пунктир — закрытие предыдущей сессии ' +
      num2.format(model.prevClose) + ' · объём основной сессии ' + mln(model.mainVolume) +
      ' из ' + mln(row.volume) + ' за день · пик минуты ' + ths(maxVol);

    /* Показываем сразу окрестности аномальной минуты. */
    var scroll = document.getElementById('s-chart-scroll');
    scroll.scrollLeft = Math.max(0, model.anomaly.i * CHART.pitch - scroll.clientWidth / 2);
  }

  /* --- Отрисовка: тепловые карты ---------------------------------- */

  var MAPS = [
    { kind: 'buys', title: 'Покупки', color: 'var(--c-change)', inRub: true,
      note: 'Доля клиента в объёме покупок за час' },
    { kind: 'taker', title: 'Тейкерские покупки', color: 'var(--c-run)', inRub: false,
      note: 'Доля клиента в объёме покупок по встречным заявкам' },
    { kind: 'sells', title: 'Продажи', color: 'var(--c-late)', inRub: true,
      note: 'Доля клиента в объёме продаж за час' }
  ];

  function cellStyle(value, max) {
    if (!value) return '';
    var alpha = 8 + 67 * Math.pow(value / max, 0.75);
    return 'background: color-mix(in srgb, var(--heat-c) ' + alpha.toFixed(1) + '%, transparent);';
  }

  function heatTable(map, clients, heat, hourTotals, byHour) {
    /* Оборот часа считается один раз, поэтому доля в покупках (или в продажах)
       переводится в рубли напрямую. Для тейкерских покупок база другая —
       там оставляем только проценты. */
    function inRub(share, j) {
      return map.inRub && share ? ' ≈ ' + mln(share * byHour[j]) : '';
    }

    var head = '<tr><th class="heat__corner" scope="col"></th>' + HOURS.map(function (h, j) {
      var tip = hhmm(h * 60) + '–' + hhmm((h + 1) * 60) +
                '\nОбъём часа: ' + (byHour[j] ? mln(byHour[j]) : 'нет сделок') +
                '\nПоказано участников: ' + pct1.format(hourTotals[j]) +
                '\nПрочие: ' + pct1.format(heat.others[j]);
      return '<th scope="col" class="heat__hour' + (hourTotals[j] + heat.others[j] < 0.001 ? ' is-void' : '') +
             '" data-tip="' + attr(tip) + '">' + (h < 10 ? '0' + h : h) + '</th>';
    }).join('') + '</tr>';

    var body = clients.map(function (client, i) {
      var row = HOURS.map(function (h, j) {
        var v = heat.cells[i][j];
        var tip = client.id + '\n' + map.title + ', ' + hhmm(h * 60) + '–' + hhmm((h + 1) * 60) +
                  '\nДоля: ' + (v ? pct1.format(v) + inRub(v, j) : 'нет сделок');
        return '<td><span class="heat__cell" style="' + cellStyle(v, heat.max) + '" data-tip="' +
               attr(tip) + '">' + (v >= 0.05 ? Math.round(v * 100) : '') + '</span></td>';
      }).join('');

      var turnover = heat.cells[i].reduce(function (a, v, j) { return a + v * byHour[j]; }, 0);
      var avg = heat.cells[i].reduce(function (a, b) { return a + b; }, 0) / HOURS.length;
      var tipRow = client.id + '\nБрокер: ' + client.broker +
                   '\nСредняя доля за час: ' + pct1.format(avg) +
                   (map.inRub ? '\nОборот за сессию ≈ ' + mln(turnover) : '');
      return '<tr><th scope="row" class="heat__client" data-tip="' + attr(tipRow) + '">' +
             attr(client.id) + '</th>' + row + '</tr>';
    }).join('');

    var foot = '<tr class="heat__rest"><th scope="row" class="heat__client">Прочие участники</th>' +
      HOURS.map(function (h, j) {
        var v = heat.others[j];
        var tip = 'Прочие участники\n' + map.title + ', ' + hhmm(h * 60) + '–' + hhmm((h + 1) * 60) +
                  '\nДоля: ' + (v ? pct1.format(v) + inRub(v, j) : 'нет сделок');
        return '<td><span class="heat__cell heat__cell--rest" data-tip="' + attr(tip) + '">' +
               (v >= 0.05 ? Math.round(v * 100) : '') + '</span></td>';
      }).join('') + '</tr>';

    return '<table class="heat__table"><thead>' + head + '</thead><tbody>' + body +
           '</tbody><tfoot>' + foot + '</tfoot></table>';
  }

  function renderHeatmaps(row, clients, heats, byHour) {
    var host = document.getElementById('s-heatmaps');

    host.innerHTML = MAPS.map(function (map) {
      var heat = heats[map.kind];
      var hourTotals = HOURS.map(function (h, j) {
        return clients.reduce(function (a, c, i) { return a + heat.cells[i][j]; }, 0);
      });

      var steps = [0.2, 0.4, 0.6, 0.8, 1].map(function (k) {
        var v = heat.max * k;
        return '<span class="heat__swatch" style="' + cellStyle(v, heat.max) + '" data-tip="' +
               attr('Насыщенность ' + Math.round(k * 100) + ' % шкалы\nДоля ≈ ' + pct1.format(v)) +
               '"></span>';
      }).join('');

      return '<section class="panel card heat" style="--heat-c: ' + map.color + '" aria-label="' +
        attr('Тепловая карта: ' + map.title) + '">' +
        '<div class="card__head"><h2>' + attr(map.title) + '</h2>' +
        '<p class="card__note">' + attr(map.note) + ' · сумма по столбцу — 100 %</p></div>' +
        '<div class="heat__scroll">' + heatTable(map, clients, heat, hourTotals, byHour) + '</div>' +
        '<p class="card__foot heat__legend">Доля в объёме часа: <span class="heat__scale">' + steps +
        '</span> до ' + pct1.format(heat.max) + ' · объём сессии ' + mln(row.volume) +
        ' · показаны ' + clients.length +
        ' участников с наибольшей активностью, остальные свёрнуты в строку «Прочие»</p>' +
        '</section>';
    }).join('');
  }

  /* --- Отрисовка: новости ----------------------------------------- */

  function renderNews(row, items) {
    document.getElementById('s-news').innerHTML = items.map(function (it) {
      var days = Math.round((new Date(row.date) - new Date(it.date)) / 86400000);
      var tip = shortDate(it.date) + ' · ' + it.src + '\n' + it.cat + '\n' +
                (days === 0 ? 'В день торговой сессии' : 'За ' + days + ' ' +
                 (days % 10 === 1 && days % 100 !== 11 ? 'день' :
                  (days % 10 >= 2 && days % 10 <= 4 && (days % 100 < 12 || days % 100 > 14) ? 'дня' : 'дней')) +
                 ' до сессии');

      return '<li class="news__item" data-tip="' + attr(tip) + '">' +
        '<span class="news__date">' + dayMonth(it.date) + '</span>' +
        '<p class="news__text">' + attr(it.text) + '</p>' +
        '<span class="news__cat">' + attr(it.cat) + '</span></li>';
    }).join('');
  }

  /* --- Сборка ------------------------------------------------------ */

  function render(row) {
    var rand = mulberry(fnv(row.date + '|' + row.board + '|' + row.security));
    var model = buildCandles(row, rand);

    /* Участники сессии — жребий универсума; восьмёрка первых попадает
       в тепловые карты, остальные сидят в строке «Прочие участники». */
    var drawn = MSD.universe.draw(row, 56 + Math.floor(rand() * 40));
    var population = drawn.participants;
    var clients = drawn.core;
    var anomalyHour = Math.floor(model.anomaly.minute / 60);
    var suspectId = drawn.suspectId;
    var suspect = 0;
    clients.forEach(function (c, i) { if (c.id === suspectId) suspect = i; });

    var byHour = volumeByHour(row, rand, anomalyHour);
    model.minuteVolume = volumeByMinute(model.candles, byHour, rand);
    model.mainVolume = sum(model.minuteVolume);

    var heats = {
      buys: buildHeat(rand, clients, 'buys', anomalyHour, suspect),
      taker: buildHeat(rand, clients, 'taker', anomalyHour, suspect),
      sells: buildHeat(rand, clients, 'sells', anomalyHour, suspect)
    };

    /* Один порядок строк во всех трёх картах — иначе карты не сопоставить. */
    var order = clients.map(function (c, i) {
      var acc = 0;
      ['buys', 'sells'].forEach(function (k) {
        heats[k].cells[i].forEach(function (v) { acc += v; });
      });
      return { i: i, sum: acc };
    }).sort(function (a, b) { return b.sum - a.sum; });

    var sorted = order.map(function (o) { return clients[o.i]; });
    Object.keys(heats).forEach(function (k) {
      heats[k].cells = order.map(function (o) { return heats[k].cells[o.i]; });
    });

    var flags = CRITERIA.filter(function (c) { return row[c.key]; });

    document.getElementById('s-eyebrow').textContent =
      'Разбор аномальной сессии · ' + row.board + ' · ' + shortDate(row.date);
    document.getElementById('s-title').textContent = row.security;
    document.getElementById('s-lede').innerHTML =
      longDate.format(new Date(row.date + 'T00:00:00')) + ' · сработавших критериев — <b>' +
      flags.length + '</b> из 3 · изменение цены закрытия <b>' + pctSigned.format(row.closeChange) +
      '</b> · максимум минутной свечи <b>' + pct2.format(row.maxMinuteGain) +
      '</b> · объём <b>' + num2.format(row.volume / 1e6) + '</b> млн ₽';

    var longCandles = longGrowthCandles(model.candles, model.minuteVolume);

    T.rows = buildTraders({
      row: row, rand: rand, byHour: byHour, heats: heats,
      core: sorted, all: population, suspectId: suspectId,
      longCandles: longCandles, mainVolume: model.mainVolume
    });
    T.session = row;
    T.suspectId = suspectId;
    T.page = 1;
    T.sort = { key: 'score', dir: 'desc' };
    T.types = [];
    T.inn = '';
    resetWeights();

    renderMeta(row, model);
    renderChart(row, model);
    renderHeatmaps(row, sorted, heats, byHour);
    renderTradersControls(row, longCandles);
    renderWeightsGrid();
    renderTraders();
    renderNews(row, buildNews(row, rand));

    document.getElementById('s-stub-note').textContent = '';
  }

  MSD.session = { render: render };
})();
