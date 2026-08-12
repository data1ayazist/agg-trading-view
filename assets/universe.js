/* Универсум клиентов: единая синтетическая популяция для всего прототипа.

   Зачем: рейтинг между сессиями, карточка клиента и разбор конкретной сессии
   должны говорить об одних и тех же людях. Поэтому клиенты и их история
   генерируются здесь один раз (детерминированно, сид фиксирован), а разбор
   сессии берёт участников отсюда же — тем же жребием, что и рейтинг.

   Всё содержимое синтетическое: коды клиентов, брокерские ИНН, история.
*/

(function () {
  'use strict';

  var MSD = window.MSD = window.MSD || {};
  var SESSIONS = (MSD.data && MSD.data.sessions) || [];

  /* ================= ГПСЧ ================= */

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

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  function sum(list) {
    return list.reduce(function (a, b) { return a + b; }, 0);
  }

  MSD.rnd = { fnv: fnv, mulberry: mulberry, gauss: gauss, pick: pick, clamp: clamp, sum: sum };

  /* ================= Форматирование ================= */

  var nf = function (min, max) {
    return new Intl.NumberFormat('ru-RU', { minimumFractionDigits: min, maximumFractionDigits: max });
  };
  var pf = function (min, max, sign) {
    return new Intl.NumberFormat('ru-RU', {
      style: 'percent', minimumFractionDigits: min, maximumFractionDigits: max,
      signDisplay: sign || 'auto'
    });
  };

  var num0 = nf(0, 0), num1 = nf(1, 1), num2 = nf(2, 2);
  var pct0 = pf(0, 0), pct1 = pf(1, 1), pct2 = pf(2, 2), pctSigned = pf(1, 1, 'always');

  var longDateFmt = new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric', month: 'long', year: 'numeric'
  });
  var monthFmt = new Intl.DateTimeFormat('ru-RU', { month: 'short', year: '2-digit' });

  function iso(d) { return d.toISOString().slice(0, 10); }
  function parse(isoStr) { return new Date(isoStr + 'T00:00:00Z'); }
  function shiftDays(isoStr, days) {
    var d = parse(isoStr);
    d.setUTCDate(d.getUTCDate() + days);
    return iso(d);
  }
  function shortDate(isoStr) {
    var p = isoStr.split('-');
    return p[2] + '.' + p[1] + '.' + p[0];
  }

  function plural(n, one, few, many) {
    var m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return one;
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
    return many;
  }

  MSD.fmt = {
    num0: num0, num1: num1, num2: num2,
    pct0: pct0, pct1: pct1, pct2: pct2, pctSigned: pctSigned,
    mln: function (v) { return num2.format(v / 1e6) + ' млн ₽'; },
    mlnPlain: function (v) { return num2.format(v / 1e6); },
    ths: function (v) { return num0.format(v / 1000) + ' тыс ₽'; },
    rub: function (v) { return num0.format(v) + ' ₽'; },
    shortDate: shortDate,
    longDate: function (isoStr) { return longDateFmt.format(parse(isoStr)); },
    month: function (isoStr) { return monthFmt.format(parse(isoStr)).replace('.', ''); },
    shiftDays: shiftDays,
    plural: plural,
    attr: function (text) {
      return String(text)
        .replace(/[&<>"]/g, function (c) {
          return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
        })
        .replace(/\n/g, '&#10;');
    }
  };

  /* ================= Справочники ================= */

  var BROKERS = [
    { name: 'БКС', inn: '7700104512' },
    { name: 'ВТБ', inn: '7700238907' },
    { name: 'Финам', inn: '7700345126' },
    { name: 'Сбер', inn: '7700419883' },
    { name: 'Альфа', inn: '7700527340' },
    { name: 'Т-Банк', inn: '7700631275' },
    { name: 'Цифра', inn: '7700748019' },
    { name: 'Открытие', inn: '7700852664' },
    { name: 'Ренессанс', inn: '7700963158' },
    { name: 'Атон', inn: '7701074402' }
  ];

  var CLIENT_TYPES = ['ФЛ', 'ЮЛ', 'нерезидент'];

  /* Бумаги: из выгрузки плюс несколько фоновых — клиент торгует не только там,
     где сработали критерии. */
  var EXTRA_SECURITIES = ['LKOH', 'SBER', 'MTSS', 'PLZL', 'AFLT', 'VTBR', 'RTKM', 'SMLT'];

  var SIZE = 240;          /* клиентов в универсуме */
  var MONTHS = 6;          /* глубина истории */
  var MONTH_DAYS = 30;

  /* ================= Метрики индекса опасности ================= */

  var METRICS = [
    { key: 'takerVolume', short: 'Тейкерский объём', unit: 'mln',
      label: 'Тейкерский объём покупок',
      hint: 'Сумма агрессивных покупок за окно. Масштаб влияния на цену.' },
    { key: 'longTakerShare', short: 'Покупки в рывках', unit: 'pct',
      label: 'Доля тейкерских покупок в длинных свечах роста',
      hint: 'Покупал ли клиент именно в минуты рывка, а не размазанно по сессии.' },
    { key: 'anomalyHits', short: 'Аномальные сессии', unit: 'int',
      label: 'Участий в аномальных сессиях',
      hint: 'В скольких сессиях со сработавшими критериями клиент был в топе покупателей.' },
    { key: 'bigOrders', short: 'Большие заявки', unit: 'int',
      label: 'Больших тейкерских заявок на покупку',
      hint: 'Агрессивные заявки, крупные относительно среднего размера по рынку.' },
    { key: 'priceLevels', short: 'Захват стакана', unit: 'int',
      label: 'Ценовых уровней за сессию, в среднем',
      hint: 'Насколько глубоко клиент снимает встречные заявки одной серией.' },
    { key: 'closeShare', short: 'Маркинг', unit: 'pct',
      label: 'Доля активности в открытии и закрытии',
      hint: 'Концентрация сделок в первые и последние минуты сессии.' },
    { key: 'repeat', short: 'Повторяемость', unit: 'int',
      label: 'Повторяемость: активных дней × бумаг',
      hint: 'Разовый эпизод или устойчивая манера торговать.' },
    { key: 'pnl', short: 'Прибыль', unit: 'mln',
      label: 'Реализованная прибыль (FIFO)',
      hint: 'Экономический результат по закрытой части позиции.' }
  ];

  /* Допуск в рейтинг: без порога клиент с одной удачной сделкой
     получает 100-й перцентиль по доле покупок в рывке. */
  var ELIGIBLE = { takerVolume: 1e6, activeDays: 3 };

  /* ================= Построение популяции ================= */

  var ASOF = SESSIONS.length
    ? SESSIONS.map(function (s) { return s.date; }).sort().pop()
    : '2026-08-07';

  function monthStart(m) { return shiftDays(ASOF, -((m + 1) * MONTH_DAYS) + 1); }
  function monthEnd(m) { return shiftDays(ASOF, -(m * MONTH_DAYS)); }

  function clientType(rand) {
    var r = rand();
    return r < 0.56 ? 'ФЛ' : (r < 0.86 ? 'ЮЛ' : 'нерезидент');
  }

  function buildMonth(rand, c, m) {
    /* Тренд: drift > 0 — клиент разгоняется к последним месяцам. */
    var trend = Math.pow(1 + c.drift, (MONTHS - 1 - m) / (MONTHS - 1));
    var scale = (0.3 + c.activity * 9) * trend * (0.6 + rand() * 0.9);

    var buyVolume = 4e6 * scale;
    var takerRatio = clamp(0.18 + c.aggression * 0.62 + rand() * 0.1, 0.05, 0.95);
    var takerVolume = buyVolume * takerRatio;
    var activeDays = clamp(Math.round(2 + c.activity * 18 + rand() * 4), 1, 21);
    var securities = clamp(Math.round(1 + c.activity * 4 + rand() * 2), 1, c.securities.length);
    var edge = (c.aggression * 0.012 - 0.002) + gauss(rand) * 0.004;

    return {
      month: m,
      from: monthStart(m),
      to: monthEnd(m),
      buyVolume: buyVolume,
      takerVolume: takerVolume,
      longTakerShare: clamp(0.04 + c.aggression * 0.6 + gauss(rand) * 0.05, 0.01, 0.95),
      bigOrders: Math.round(c.activity * 10 + c.aggression * c.aggression * 90 + rand() * 6),
      priceLevels: clamp(Math.round(2 + c.aggression * 38 + gauss(rand) * 4), 1, 60),
      closeShare: clamp(0.05 + c.aggression * 0.35 + gauss(rand) * 0.06, 0.01, 0.8),
      activeDays: activeDays,
      securities: securities,
      pnl: buyVolume * edge,
      /* Аномальные сессии свежего месяца берутся из реальной выгрузки (см. ниже),
         для прошлых месяцев — синтетические. */
      anomalyHits: m === 0 ? 0
        : Math.floor(Math.pow(rand(), 1 / (0.25 + c.aggression)) * 3.4 * c.persistence)
    };
  }

  function buildClients() {
    var rand = mulberry(fnv('msd-universe-v1'));
    var pool = SESSIONS.map(function (s) { return s.security; })
      .filter(function (v, i, a) { return a.indexOf(v) === i; })
      .concat(EXTRA_SECURITIES);

    var used = {}, out = [];

    while (out.length < SIZE) {
      var broker = pick(rand, BROKERS);
      var code = String(Math.floor(rand() * 1e9)).padStart(9, '0');
      if (used[code]) continue;
      used[code] = true;

      var c = {
        code: code,
        id: broker.name + '_' + code,
        broker: broker.name,
        inn: broker.inn,
        type: clientType(rand),
        activity: Math.pow(rand(), 2.2),
        aggression: Math.pow(rand(), 2.6),
        persistence: 0.15 + rand() * 0.85,
        drift: -0.25 + rand() * 0.85,
        securities: []
      };

      var n = 1 + Math.floor(rand() * 5);
      while (c.securities.length < n) {
        var sec = pick(rand, pool);
        if (c.securities.indexOf(sec) === -1) c.securities.push(sec);
      }

      c.weight = 0.25 + c.activity * 2.4;
      c.months = [];
      for (var m = 0; m < MONTHS; m++) c.months.push(buildMonth(rand, c, m));

      out.push(c);
    }

    return out;
  }

  var CLIENTS = buildClients();
  var BY_CODE = {};
  CLIENTS.forEach(function (c) { BY_CODE[c.code] = c; });

  /* ================= Жребий участников сессии ================= */

  /* Один и тот же жребий используют разбор сессии и рейтинг — иначе клиент,
     подсвеченный в тепловой карте, не сойдётся со своей карточкой. */
  var drawCache = {};

  /* Порядок жребия не зависит от того, сколько участников попросили:
     иначе рейтинг и страница разбора рисовали бы разных людей. */
  function drawOrder(session) {
    var key = session.date + '|' + session.board + '|' + session.security;
    if (drawCache[key]) return drawCache[key];

    var rand = mulberry(fnv('draw|' + key));
    var scored = CLIENTS.map(function (c) {
      var affinity = c.securities.indexOf(session.security) > -1 ? 2.4 : 0.55;
      return { c: c, s: (0.2 + c.activity) * affinity * (0.3 + rand()) };
    }).sort(function (a, b) { return b.s - a.s; });

    var order = scored.map(function (x) { return x.c; });

    /* Агрессор сессии — самый агрессивный из восьмёрки тепловых карт. */
    var suspect = order[0];
    order.slice(0, 8).forEach(function (c) {
      if (c.aggression > suspect.aggression) suspect = c;
    });

    drawCache[key] = { order: order, suspect: suspect };
    return drawCache[key];
  }

  function draw(session, count) {
    var base = drawOrder(session);

    /* Копии: разбор сессии дописывает в клиента свои поля,
       и они не должны протекать между страницами. */
    var participants = base.order.slice(0, count).map(function (c) {
      var copy = {};
      for (var k in c) if (c.hasOwnProperty(k)) copy[k] = c[k];
      return copy;
    });

    return {
      participants: participants,
      core: participants.slice(0, 8),
      suspectId: base.suspect.id,
      suspectCode: base.suspect.code
    };
  }

  /* Участия в аномальных сессиях свежего месяца — из выгрузки, а не из ГПСЧ. */
  var INCIDENTS = {};
  SESSIONS.forEach(function (s) {
    draw(s, 64).core.forEach(function (c, i) {
      (INCIDENTS[c.code] = INCIDENTS[c.code] || []).push({
        date: s.date,
        board: s.board,
        security: s.security,
        listing: s.listing,
        closeChange: s.closeChange,
        maxMinuteGain: s.maxMinuteGain,
        volume: s.volume,
        rank: i + 1,
        suspect: draw(s, 64).suspectCode === c.code,
        real: true
      });
    });
  });

  CLIENTS.forEach(function (c) {
    c.months[0].anomalyHits = (INCIDENTS[c.code] || []).length;
  });

  /* Синтетические эпизоды прошлых месяцев — для карточки клиента. */
  function historyIncidents(client) {
    var rand = mulberry(fnv('inc|' + client.code));
    var out = (INCIDENTS[client.code] || []).slice();

    client.months.forEach(function (mo) {
      for (var k = 0; k < mo.anomalyHits && mo.month > 0; k++) {
        var day = Math.floor(rand() * MONTH_DAYS);
        out.push({
          date: shiftDays(mo.to, -day),
          board: 'TQBR',
          security: pick(rand, client.securities),
          listing: 1 + Math.floor(rand() * 3),
          closeChange: 0.03 + rand() * 0.13,
          maxMinuteGain: 0.03 + rand() * 0.09,
          volume: 2e6 + rand() * 9e7,
          rank: 1 + Math.floor(rand() * 8),
          suspect: rand() < 0.35,
          real: false
        });
      }
    });

    return out.sort(function (a, b) { return a.date < b.date ? 1 : -1; });
  }

  /* ================= Агрегация по окну ================= */

  /* window = 1 (месяц) или 6 (полгода) */
  function aggregate(client, months) {
    return aggregateRange(client, 0, months);
  }

  function aggregateRange(client, from, count) {
    var use = client.months.slice(from, from + count);
    var takerVolume = sum(use.map(function (m) { return m.takerVolume; }));
    var buyVolume = sum(use.map(function (m) { return m.buyVolume; }));
    var activeDays = sum(use.map(function (m) { return m.activeDays; }));
    var securities = Math.max.apply(null, use.map(function (m) { return m.securities; }));

    /* Доли усредняем по тейкерскому объёму: месяц с оборотом в рубль
       не должен весить как месяц с оборотом в сто миллионов. */
    var wavg = function (field) {
      var w = sum(use.map(function (m) { return m.takerVolume; }));
      if (!w) return 0;
      return sum(use.map(function (m) { return m[field] * m.takerVolume; })) / w;
    };

    return {
      months: use.length,
      from: use[use.length - 1].from,
      to: use[0].to,
      buyVolume: buyVolume,
      takerVolume: takerVolume,
      longTakerShare: wavg('longTakerShare'),
      closeShare: wavg('closeShare'),
      anomalyHits: sum(use.map(function (m) { return m.anomalyHits; })),
      bigOrders: sum(use.map(function (m) { return m.bigOrders; })),
      priceLevels: sum(use.map(function (m) { return m.priceLevels * m.activeDays; })) / (activeDays || 1),
      pnl: sum(use.map(function (m) { return m.pnl; })),
      activeDays: activeDays,
      securities: securities,
      repeat: activeDays * securities
    };
  }

  /* ================= Индекс опасности ================= */

  /* Перцентильный ранг: устойчив к выбросам, читается как «клиент выше N %
     остальных по этой метрике». */
  function percentiles(values) {
    var sorted = values.slice().sort(function (a, b) { return a - b; });
    var n = sorted.length;
    return function (v) {
      if (n < 2) return 0;
      var lo = 0, hi = n;
      while (lo < hi) {                       /* первый индекс >= v */
        var mid = (lo + hi) >> 1;
        if (sorted[mid] < v) lo = mid + 1; else hi = mid;
      }
      var first = lo;
      lo = 0; hi = n;
      while (lo < hi) {                       /* первый индекс > v */
        var mid2 = (lo + hi) >> 1;
        if (sorted[mid2] <= v) lo = mid2 + 1; else hi = mid2;
      }
      return ((first + lo - 1) / 2) / (n - 1); /* средний ранг при совпадениях */
    };
  }

  function defaultWeights() {
    var w = {};
    METRICS.forEach(function (m) { w[m.key] = 1; });
    return w;
  }

  /* Возвращает отранжированный список: индекс, перцентили, вклад метрик. */
  function rank(months, weights) {
    return rankRows(CLIENTS.map(function (c) {
      return { client: c, agg: aggregate(c, months) };
    }), weights, months);
  }

  function rankRows(rows, weights, months) {
    var w = weights || defaultWeights();
    var minVolume = ELIGIBLE.takerVolume * (months && months > 1 ? months / 2 : 1);

    var eligible = rows.filter(function (r) {
      return r.agg.takerVolume >= minVolume && r.agg.activeDays >= ELIGIBLE.activeDays;
    });

    var ranks = {};
    METRICS.forEach(function (m) {
      ranks[m.key] = percentiles(eligible.map(function (r) { return r.agg[m.key]; }));
    });

    var total = sum(METRICS.map(function (m) { return w[m.key]; }));

    eligible.forEach(function (r) {
      var acc = 0;
      r.pr = {};
      r.contrib = {};
      METRICS.forEach(function (m) {
        var pr = ranks[m.key](r.agg[m.key]);
        r.pr[m.key] = pr;
        r.contrib[m.key] = total ? (w[m.key] * pr) / total : 0;
        acc += w[m.key] * pr;
      });
      r.ari = total ? (acc / total) * 100 : 0;
      r.drivers = METRICS.slice().sort(function (a, b) {
        return r.contrib[b.key] - r.contrib[a.key];
      }).slice(0, 2);
    });

    eligible.sort(function (a, b) { return b.ari - a.ari; });
    eligible.forEach(function (r, i) { r.rank = i + 1; });

    return { rows: eligible, skipped: rows.length - eligible.length, weights: w };
  }

  /* ================= Флаг «отправлен на расследование» =================

     В продукте статус лежит в БД надзорной системы: он общий для всех
     сотрудников и переживает смену рабочего места. Здесь весь доступ к нему
     собран в объекте flags — при подключении бэкенда меняются только эти
     четыре метода (read/has/count/toggle → GET и POST к API), остальной код
     трогать не нужно. localStorage — временная заглушка статического прототипа,
     на GitHub Pages серверу взяться неоткуда. */

  var STORE = 'msd.investigations.v1';

  function readFlags() {
    try { return JSON.parse(localStorage.getItem(STORE)) || {}; }
    catch (e) { return {}; }
  }

  function writeFlags(map) {
    try { localStorage.setItem(STORE, JSON.stringify(map)); } catch (e) { /* приватный режим */ }
  }

  var flags = {
    all: readFlags,
    has: function (code) { return !!readFlags()[code]; },
    get: function (code) { return readFlags()[code] || null; },
    count: function () { return Object.keys(readFlags()).length; },
    toggle: function (code) {
      var map = readFlags();
      if (map[code]) delete map[code];
      else map[code] = { at: new Date().toISOString().slice(0, 16).replace('T', ' ') };
      writeFlags(map);
      return !!map[code];
    }
  };

  /* Индекс по месяцам — для динамики в карточке клиента. Ранжируем каждый
     месяц отдельно, чтобы точка отвечала на вопрос «как он выглядел тогда». */
  function monthlySeries(code, weights) {
    var out = [];
    for (var m = 0; m < MONTHS; m++) {
      var rows = CLIENTS.map(function (c) {
        return { client: c, agg: aggregateRange(c, m, 1) };
      });
      var ranked = rankRows(rows, weights, 1);
      var mine = null;
      ranked.rows.forEach(function (r) { if (r.client.code === code) mine = r; });

      var self = BY_CODE[code].months[m];
      out.push({
        month: m,
        from: self.from,
        to: self.to,
        ari: mine ? mine.ari : null,
        rank: mine ? mine.rank : null,
        pool: ranked.rows.length,
        buyVolume: self.buyVolume,
        takerVolume: self.takerVolume,
        anomalyHits: self.anomalyHits,
        pnl: self.pnl
      });
    }
    return out.reverse();   /* от старого месяца к свежему */
  }

  /* Распределение тейкерского объёма клиента по бумагам. */
  function securityMix(client, months) {
    var rand = mulberry(fnv('mix|' + client.code + '|' + months));
    var w = client.securities.map(function () { return 0.2 + rand() * rand() * 3; });
    var total = sum(w);
    var agg = aggregate(client, months);

    return client.securities.map(function (sec, i) {
      return { security: sec, share: w[i] / total, volume: agg.takerVolume * w[i] / total };
    }).sort(function (a, b) { return b.share - a.share; });
  }

  MSD.universe = {
    asOf: ASOF,
    months: MONTHS,
    monthDays: MONTH_DAYS,
    size: SIZE,
    clients: CLIENTS,
    byCode: function (code) { return BY_CODE[code] || null; },
    brokers: BROKERS,
    types: CLIENT_TYPES,
    metrics: METRICS,
    eligible: ELIGIBLE,
    draw: draw,
    incidents: historyIncidents,
    aggregate: aggregate,
    aggregateRange: aggregateRange,
    monthlySeries: monthlySeries,
    securityMix: securityMix,
    rank: rank,
    defaultWeights: defaultWeights,
    flags: flags
  };
})();
