/* Витрина «Аномальные сессии».
   Без сборки и без сети: данные приходят из assets/data.js (window.MSD.data).
   Состояние фильтров живёт в hash — ссылку можно переслать коллеге. */

(function () {
  'use strict';

  var DATA = (window.MSD && window.MSD.data) || { sessions: [] };
  var ROWS = DATA.sessions || [];
  var DEBOUNCE = 220;

  /* --- Справочники ---------------------------------------------- */

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

  var CRITERIA = {
    sechist: {
      title: 'Флаг sechist-критерия',
      note: 'Отклонение итогов сессии от исторического поведения бумаги.',
      cls: 'flag--sechist'
    },
    minuteCandles: {
      title: 'Флаг критерия минутных свечей',
      note: 'Резкий прирост цены в пределах одной минутной свечи.',
      cls: 'flag--minute'
    },
    markingOpenClose: {
      title: 'Флаг marking the open/close',
      note: 'Воздействие на цену в моменты открытия и закрытия сессии.',
      cls: 'flag--marking'
    }
  };

  var FLAG_KEYS = ['sechist', 'minuteCandles', 'markingOpenClose'];

  /* --- Форматирование ------------------------------------------- */

  var pctSigned = new Intl.NumberFormat('ru-RU', {
    style: 'percent', minimumFractionDigits: 2, maximumFractionDigits: 2, signDisplay: 'always'
  });
  var pctPlain = new Intl.NumberFormat('ru-RU', {
    style: 'percent', minimumFractionDigits: 2, maximumFractionDigits: 2
  });
  var shareFmt = new Intl.NumberFormat('ru-RU', {
    minimumFractionDigits: 4, maximumFractionDigits: 4
  });
  var mlnFmt = new Intl.NumberFormat('ru-RU', {
    minimumFractionDigits: 2, maximumFractionDigits: 2
  });
  var rubFmt = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 });

  /* В витрине объём показываем в миллионах рублей, точное значение — в тултипе. */
  function mln(value) { return mlnFmt.format(value / 1e6); }
  function rub(value) { return rubFmt.format(value) + ' ₽'; }
  var longDate = new Intl.DateTimeFormat('ru-RU', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
  });

  function shortDate(iso) {
    var p = iso.split('-');
    return p[2] + '.' + p[1] + '.' + p[0];
  }

  function fullDate(iso) {
    return longDate.format(new Date(iso + 'T00:00:00'));
  }

  function plural(n, one, few, many) {
    var m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return one;
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
    return many;
  }

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function flagCount(row) {
    var n = 0;
    for (var i = 0; i < FLAG_KEYS.length; i++) if (row[FLAG_KEYS[i]]) n++;
    return n;
  }

  /* --- Границы данных ------------------------------------------- */

  var dates = ROWS.map(function (r) { return r.date; }).sort();
  var MIN_DATE = dates[0] || '';
  var MAX_DATE = dates[dates.length - 1] || '';

  function uniq(key) {
    var seen = {}, out = [];
    ROWS.forEach(function (r) {
      if (!seen[r[key]]) { seen[r[key]] = true; out.push(r[key]); }
    });
    return out;
  }

  var ALL_BOARDS = uniq('board').sort();
  var ALL_LEVELS = uniq('listing').sort(function (a, b) { return a - b; });
  var ALL_SECS = uniq('security').sort();

  function countBy(key, value) {
    return ROWS.filter(function (r) { return r[key] === value; }).length;
  }

  /* --- Состояние ------------------------------------------------ */

  var DEFAULT_SORT = { key: 'date', dir: 'desc' };

  var state = {
    from: '',
    to: '',
    boards: [],
    levels: [],
    sec: '',
    sort: { key: DEFAULT_SORT.key, dir: DEFAULT_SORT.dir }
  };

  function isFiltered() {
    return !!(state.from || state.to || state.sec ||
              state.boards.length || state.levels.length);
  }

  function isDefaultSort() {
    return state.sort.key === DEFAULT_SORT.key && state.sort.dir === DEFAULT_SORT.dir;
  }

  /* --- Фильтрация и сортировка ---------------------------------- */

  function passes(r) {
    if (state.from && r.date < state.from) return false;
    if (state.to && r.date > state.to) return false;
    if (state.boards.length && state.boards.indexOf(r.board) === -1) return false;
    if (state.levels.length && state.levels.indexOf(r.listing) === -1) return false;
    if (state.sec && r.security.toLowerCase().indexOf(state.sec.toLowerCase()) === -1) return false;
    return true;
  }

  function cmp(a, b, key) {
    var x = a[key], y = b[key];
    if (typeof x === 'boolean') { x = x ? 1 : 0; y = y ? 1 : 0; }
    if (typeof x === 'number') return x - y;
    return String(x).localeCompare(String(y), 'ru');
  }

  function sortRows(rows) {
    var key = state.sort.key;
    var sign = state.sort.dir === 'asc' ? 1 : -1;

    return rows.slice().sort(function (a, b) {
      var d = cmp(a, b, key) * sign;
      if (d) return d;
      // Одинаковые значения — сначала более «тяжёлые» сессии.
      d = (flagCount(b) - flagCount(a));
      if (d) return d;
      d = Math.abs(b.closeChange) - Math.abs(a.closeChange);
      if (d) return d;
      return a.security.localeCompare(b.security, 'ru');
    });
  }

  /* --- Разметка строк ------------------------------------------- */

  function deltaCell(row) {
    var v = row.closeChange;
    var cls = v > 0 ? 'delta--up' : (v < 0 ? 'delta--down' : 'delta--flat');
    var tip = 'Изменение цены закрытия к предыдущей сессии: ' + pctSigned.format(v) +
              '\nДоля: ' + shareFmt.format(v);
    return '<td class="cell-num ' + cls + '" data-tip="' + esc(tip) + '">' +
           esc(pctSigned.format(v)) + '</td>';
  }

  function gainCell(row) {
    var v = row.maxMinuteGain;
    var tip = 'Макс. прирост цены минутной свечи: ' + pctPlain.format(v) +
              '\nДоля: ' + shareFmt.format(v);
    return '<td class="cell-num" data-tip="' + esc(tip) + '">' +
           esc(pctPlain.format(v)) + '</td>';
  }

  function volumeCell(row) {
    var tip = 'Объём торгов за сессию: ' + rub(row.volume) +
              '\nВ витрине показано в млн ₽: ' + mln(row.volume);
    return '<td class="cell-num cell-vol" data-tip="' + esc(tip) + '">' + esc(mln(row.volume)) + '</td>';
  }

  function flagCell(row, key) {
    var meta = CRITERIA[key];
    var on = !!row[key];
    var tip = meta.title + ': ' + (on ? 'сработал' : 'не сработал') + '\n' + meta.note;
    var cls = on ? 'flag ' + meta.cls : 'flag flag--off';
    return '<td class="cell-flag"><span class="' + cls + '" data-tip="' + esc(tip) + '">' +
           (on ? 'Да' : '—') + '</span></td>';
  }

  function rowHtml(row, prev, grouped) {
    var n = flagCount(row);
    var dateTip = fullDate(row.date) + '\nСработавших критериев: ' + n + ' из 3';
    var boardTip = row.board + ' — ' + (BOARDS[row.board] || 'режим торгов');
    var secTip = row.security + ' · ' + row.board + ' · уровень листинга ' + row.listing;
    var lvlTip = 'Уровень ' + row.listing + ' — ' + (LISTING[row.listing] || '—').toLowerCase();
    var daybreak = grouped && prev && prev.date !== row.date ? ' class="is-daybreak"' : '';
    var href = '#/session/' + row.date + '/' + row.board + '/' + row.security;
    var aria = 'Разбор сессии ' + row.security + ' за ' + shortDate(row.date) + ', режим ' + row.board;

    return '<tr' + daybreak + ' data-href="' + esc(href) + '" role="link" tabindex="0" aria-label="' +
      esc(aria) + '">' +
      '<td class="cell-date" data-tip="' + esc(dateTip) + '">' + shortDate(row.date) + '</td>' +
      '<td class="cell-board" data-tip="' + esc(boardTip) + '">' + esc(row.board) + '</td>' +
      '<td class="cell-sec" data-tip="' + esc(secTip) + '">' + esc(row.security) + '</td>' +
      '<td class="cell-lvl" data-tip="' + esc(lvlTip) + '">' + row.listing + '</td>' +
      deltaCell(row) +
      gainCell(row) +
      volumeCell(row) +
      flagCell(row, 'sechist') +
      flagCell(row, 'minuteCandles') +
      flagCell(row, 'markingOpenClose') +
      '</tr>';
  }

  /* --- DOM ------------------------------------------------------ */

  var el = {
    lede: document.getElementById('lede'),
    from: document.getElementById('f-from'),
    to: document.getElementById('f-to'),
    sec: document.getElementById('f-sec'),
    secList: document.getElementById('sec-list'),
    boards: document.getElementById('f-boards'),
    levels: document.getElementById('f-levels'),
    reset: document.getElementById('f-reset'),
    result: document.getElementById('result-line'),
    grid: document.getElementById('grid'),
    body: document.getElementById('grid-body'),
    empty: document.getElementById('empty'),
    colophon: document.getElementById('colophon-text')
  };

  function buildChips(host, values, labelFn, tipFn) {
    host.innerHTML = values.map(function (v) {
      return '<button type="button" class="chip" data-value="' + esc(v) + '" ' +
             'aria-pressed="false" data-tip="' + esc(tipFn(v)) + '">' +
             esc(labelFn(v)) + '</button>';
    }).join('');
  }

  function buildStatics() {
    buildChips(el.boards, ALL_BOARDS,
      function (b) { return b; },
      function (b) {
        var n = countBy('board', b);
        return b + ' — ' + (BOARDS[b] || 'режим торгов') + '\n' + n + ' ' +
               plural(n, 'запись', 'записи', 'записей') + ' в выгрузке';
      });

    buildChips(el.levels, ALL_LEVELS,
      function (l) { return String(l); },
      function (l) {
        var n = countBy('listing', l);
        return LISTING[l] + '\n' + n + ' ' + plural(n, 'запись', 'записи', 'записей') + ' в выгрузке';
      });

    el.secList.innerHTML = ALL_SECS.map(function (s) {
      return '<option value="' + esc(s) + '"></option>';
    }).join('');

    var range = 'Данные доступны с ' + shortDate(MIN_DATE) + ' по ' + shortDate(MAX_DATE) + '.';
    el.from.min = el.to.min = MIN_DATE;
    el.from.max = el.to.max = MAX_DATE;
    el.from.setAttribute('data-tip', 'Начало интервала.\n' + range);
    el.to.setAttribute('data-tip', 'Конец интервала (включительно).\n' + range);
    el.sec.setAttribute('data-tip', 'Поиск по коду бумаги или ISIN — подстрокой.\n' +
      'В выгрузке ' + ALL_SECS.length + ' ' + plural(ALL_SECS.length, 'бумага', 'бумаги', 'бумаг') + '.');

    el.lede.innerHTML = 'Торговые сессии, отобранные автоматическими критериями агрессивного ' +
      'воздействия на цену. Период выгрузки — <b>' + shortDate(MIN_DATE) + ' — ' +
      shortDate(MAX_DATE) + '</b>, всего <b>' + ROWS.length + '</b> ' +
      plural(ROWS.length, 'запись', 'записи', 'записей') + '.';

    el.colophon.textContent = 'Прототип MVP · источник: ' + (DATA.source || '—') +
      ' · выгрузка ' + (DATA.generatedAt || '—');
  }

  function syncControls() {
    el.from.value = state.from;
    el.to.value = state.to;
    if (document.activeElement !== el.sec) el.sec.value = state.sec;

    el.from.classList.toggle('is-set', !!state.from);
    el.to.classList.toggle('is-set', !!state.to);
    el.sec.classList.toggle('is-set', !!state.sec);

    Array.prototype.forEach.call(el.boards.children, function (chip) {
      chip.setAttribute('aria-pressed', state.boards.indexOf(chip.dataset.value) > -1 ? 'true' : 'false');
    });
    Array.prototype.forEach.call(el.levels.children, function (chip) {
      chip.setAttribute('aria-pressed', state.levels.indexOf(+chip.dataset.value) > -1 ? 'true' : 'false');
    });

    Array.prototype.forEach.call(document.querySelectorAll('.sort'), function (btn) {
      var active = btn.dataset.sort === state.sort.key;
      btn.classList.toggle('is-active', active);
      btn.querySelector('.sort__mark').textContent = active ? (state.sort.dir === 'asc' ? '▲' : '▼') : '';
    });

    el.reset.hidden = !isFiltered() && isDefaultSort();
  }

  function renderResultLine(rows) {
    var secs = {}, days = {}, volume = 0;
    var flags = { sechist: 0, minuteCandles: 0, markingOpenClose: 0 };
    rows.forEach(function (r) {
      secs[r.security] = 1;
      days[r.date] = 1;
      volume += r.volume;
      FLAG_KEYS.forEach(function (k) { if (r[k]) flags[k]++; });
    });

    var nSec = Object.keys(secs).length, nDay = Object.keys(days).length;
    var total = ROWS.reduce(function (a, r) { return a + r.volume; }, 0);

    el.result.innerHTML = 'Показано <b>' + rows.length + '</b> из <b>' + ROWS.length + '</b> ' +
      plural(ROWS.length, 'записи', 'записей', 'записей') + ' · <b>' + nSec + '</b> ' +
      plural(nSec, 'бумага', 'бумаги', 'бумаг') + ' · <b>' + nDay + '</b> ' +
      plural(nDay, 'сессия', 'сессии', 'сессий') + ' · объём <b>' + mln(volume) + '</b> млн ₽';

    el.result.setAttribute('data-tip',
      'Сработавшие критерии в выборке:\n' +
      'sechist — ' + flags.sechist + '\n' +
      'минутные свечи — ' + flags.minuteCandles + '\n' +
      'marking the open/close — ' + flags.markingOpenClose + '\n\n' +
      'Объём выборки: ' + rub(volume) + '\n' +
      'Объём всей выгрузки: ' + rub(total));
  }

  function render() {
    var rows = sortRows(ROWS.filter(passes));
    var grouped = state.sort.key === 'date';

    el.body.innerHTML = rows.map(function (r, i) {
      return rowHtml(r, rows[i - 1], grouped);
    }).join('');

    el.grid.hidden = rows.length === 0;
    el.empty.hidden = rows.length !== 0;

    renderResultLine(rows);
    syncControls();
  }

  /* --- Hash как хранилище состояния ------------------------------ */

  var hashLock = false;

  function serialize() {
    var p = [];
    if (state.from) p.push('from=' + state.from);
    if (state.to) p.push('to=' + state.to);
    if (state.boards.length) p.push('board=' + state.boards.join(','));
    if (state.levels.length) p.push('lvl=' + state.levels.join(','));
    if (state.sec) p.push('sec=' + encodeURIComponent(state.sec));
    if (!isDefaultSort()) p.push('sort=' + state.sort.key + ':' + state.sort.dir);
    return '#/anomal-sessions' + (p.length ? '?' + p.join('&') : '');
  }

  function writeHash() {
    var next = serialize();
    if (next === location.hash) return;
    hashLock = true;
    location.hash = next;
    setTimeout(function () { hashLock = false; }, 0);
  }

  function readHash() {
    var raw = location.hash.replace(/^#\/?[^?]*\??/, '');
    var q = {};
    raw.split('&').forEach(function (pair) {
      if (!pair) return;
      var i = pair.indexOf('=');
      q[pair.slice(0, i)] = decodeURIComponent(pair.slice(i + 1) || '');
    });

    state.from = q.from || '';
    state.to = q.to || '';
    state.sec = q.sec || '';
    state.boards = q.board ? q.board.split(',').filter(function (b) {
      return ALL_BOARDS.indexOf(b) > -1;
    }) : [];
    state.levels = q.lvl ? q.lvl.split(',').map(Number).filter(function (l) {
      return ALL_LEVELS.indexOf(l) > -1;
    }) : [];

    var sort = (q.sort || '').split(':');
    state.sort = sort[0] && document.querySelector('.sort[data-sort="' + sort[0] + '"]')
      ? { key: sort[0], dir: sort[1] === 'asc' ? 'asc' : 'desc' }
      : { key: DEFAULT_SORT.key, dir: DEFAULT_SORT.dir };
  }

  /* --- События --------------------------------------------------- */

  function commit() {
    writeHash();
    lastListHash = serialize();
    render();
  }

  function toggle(list, value) {
    var i = list.indexOf(value);
    if (i > -1) list.splice(i, 1); else list.push(value);
  }

  el.from.addEventListener('change', function () { state.from = el.from.value; commit(); });
  el.to.addEventListener('change', function () { state.to = el.to.value; commit(); });

  var secTimer = null;
  el.sec.addEventListener('input', function () {
    clearTimeout(secTimer);
    secTimer = setTimeout(function () {
      state.sec = el.sec.value.trim();
      commit();
    }, DEBOUNCE);
  });

  el.boards.addEventListener('click', function (e) {
    var chip = e.target.closest('.chip');
    if (!chip) return;
    toggle(state.boards, chip.dataset.value);
    commit();
  });

  el.levels.addEventListener('click', function (e) {
    var chip = e.target.closest('.chip');
    if (!chip) return;
    toggle(state.levels, +chip.dataset.value);
    commit();
  });

  document.addEventListener('click', function (e) {
    /* Только заголовки витрины: у таблицы метрик в разборе своя сортировка. */
    var btn = e.target.closest('.sort[data-sort]');
    if (!btn) return;
    var key = btn.dataset.sort;
    if (state.sort.key === key) {
      state.sort.dir = state.sort.dir === 'desc' ? 'asc' : 'desc';
    } else {
      state.sort = { key: key, dir: key === 'security' || key === 'board' ? 'asc' : 'desc' };
    }
    commit();
  });

  function reset() {
    state.from = '';
    state.to = '';
    state.sec = '';
    state.boards = [];
    state.levels = [];
    state.sort = { key: DEFAULT_SORT.key, dir: DEFAULT_SORT.dir };
    el.sec.value = '';
    if (window.MSD.tooltip) window.MSD.tooltip.hide();
    commit();
  }

  el.reset.addEventListener('click', reset);
  document.addEventListener('click', function (e) {
    if (e.target.closest('[data-reset]')) reset();
  });

  /* --- Переход в разбор сессии ------------------------------------ */

  function openRow(tr) {
    if (tr && tr.dataset.href) location.hash = tr.dataset.href;
  }

  el.body.addEventListener('click', function (e) {
    openRow(e.target.closest('tr[data-href]'));
  });

  el.body.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    var tr = e.target.closest('tr[data-href]');
    if (!tr) return;
    e.preventDefault();
    openRow(tr);
  });

  document.addEventListener('click', function (e) {
    var stub = e.target.closest('[data-stub]');
    if (!stub) return;
    document.getElementById('s-stub-note').textContent =
      '«' + stub.dataset.stub + '» — заглушка: раздел появится в следующей итерации прототипа.';
  });

  /* --- Роутер ------------------------------------------------------ */

  var views = {
    list: document.getElementById('view-list'),
    session: document.getElementById('view-session'),
    rating: document.getElementById('view-rating'),
    client: document.getElementById('view-client'),
    missing: document.getElementById('view-404')
  };
  var shell = document.getElementById('shell');
  var backLink = document.getElementById('back-link');
  var lastListHash = '#/anomal-sessions';

  function showView(name) {
    Object.keys(views).forEach(function (k) { views[k].hidden = k !== name; });
    shell.classList.toggle('shell--wide', name === 'list');
    shell.classList.toggle('shell--full', name !== 'list');

    var section = (name === 'rating' || name === 'client') ? 'rating' : 'list';
    Array.prototype.forEach.call(document.querySelectorAll('.topnav a'), function (a) {
      a.classList.toggle('is-current', a.dataset.nav === section);
    });
  }

  function findRow(date, board, security) {
    for (var i = 0; i < ROWS.length; i++) {
      if (ROWS[i].date === date && ROWS[i].board === board && ROWS[i].security === security) {
        return ROWS[i];
      }
    }
    return null;
  }

  function route() {
    if (window.MSD.tooltip) window.MSD.tooltip.hide();

    if (/^#\/rating/.test(location.hash)) {
      showView('rating');
      window.MSD.rating.show();
      window.scrollTo(0, 0);
      return;
    }

    var client = location.hash.match(/^#\/client\/([^/?]+)/);
    if (client) {
      var code = decodeURIComponent(client[1]);
      showView('client');
      if (!window.MSD.client.render(code)) showView('missing');
      window.scrollTo(0, 0);
      return;
    }

    var m = location.hash.match(/^#\/session\/([^/]+)\/([^/?]+)\/([^/?]+)/);
    if (m) {
      var row = findRow(decodeURIComponent(m[1]), decodeURIComponent(m[2]), decodeURIComponent(m[3]));
      backLink.setAttribute('href', lastListHash);
      showView(row ? 'session' : 'missing');
      if (row) window.MSD.session.render(row);
      window.scrollTo(0, 0);
      return;
    }

    readHash();
    lastListHash = serialize();
    showView('list');
    render();
  }

  window.addEventListener('hashchange', function () {
    if (hashLock) return;
    route();
  });

  /* --- Старт ----------------------------------------------------- */

  buildStatics();
  route();
})();
