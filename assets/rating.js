/* Рейтинг агрессивных трейдеров между сессиями.

   Порядок задаёт индекс опасности: перцентильные ранги восьми метрик внутри
   выбранного окна, сложенные с весами. Перцентиль, а не min-max, — чтобы один
   выброс не схлопывал шкалу остальным. Клиенты ниже порога активности
   в рейтинг не попадают: одна удачная сделка в рывке дала бы им 100-й
   перцентиль по доле покупок в рывках. */

(function () {
  'use strict';

  var MSD = window.MSD;
  var U = MSD.universe;
  var F = MSD.fmt;
  var attr = F.attr;

  var R = {
    months: 1,
    types: [],
    inn: '',
    flag: 'all',
    sort: { key: 'ari', dir: 'desc' },
    page: 1,
    perPage: 20,
    weights: U.defaultWeights(),
    ranked: null,
    other: null
  };

  /* --- Колонки ----------------------------------------------------- */

  function metricCol(m) {
    return {
      key: m.key,
      label: m.label,
      head: m.hint,
      num: true,
      value: function (r) { return r.agg[m.key]; },
      text: function (r) {
        var v = r.agg[m.key];
        if (m.unit === 'pct') return F.pct1.format(v);
        if (m.unit === 'mln') return F.num2.format(v / 1e6);
        return F.num0.format(Math.round(v));
      },
      tip: function (r) {
        var v = r.agg[m.key];
        var raw = m.unit === 'mln' ? F.rub(v)
                : (m.unit === 'pct' ? F.pct2.format(v) : F.num0.format(Math.round(v)));
        return m.label + '\nЗначение: ' + raw +
               '\nПерцентиль: ' + F.pct0.format(r.pr[m.key]) +
               '\nВклад в индекс: ' + F.num1.format(r.contrib[m.key] * 100) + ' из 100' +
               '\nВес: ' + F.num2.format(R.weights[m.key]);
      }
    };
  }

  var COLS = [
    { key: 'rank', label: '#', num: true, cls: 'cell-rank',
      head: 'Место в рейтинге за выбранное окно.',
      value: function (r) { return r.rank; },
      text: function (r) { return String(r.rank); },
      tip: function (r) { return 'Место ' + r.rank + ' из ' + R.ranked.rows.length; } },

    { key: 'code', label: 'Код клиента', cls: 'cell-client',
      head: 'Код клиента у брокера. Клик по строке открывает карточку.',
      value: function (r) { return r.client.code; },
      text: function (r) { return r.client.code; },
      tip: function (r) {
        return 'Код: ' + r.client.code + '\nБрокер: ' + r.client.broker + ' · ИНН ' + r.client.inn +
               '\nТип: ' + r.client.type + '\nВ тепловых картах: ' + r.client.id;
      } },

    { key: 'broker', label: 'Брокер', cls: 'cell-dim',
      head: 'Брокер клиента.',
      value: function (r) { return r.client.broker; },
      text: function (r) { return r.client.broker; },
      tip: function (r) { return r.client.broker + '\nИНН ' + r.client.inn; } },

    { key: 'type', label: 'Тип', cls: 'cell-dim',
      head: 'ЮЛ, ФЛ или нерезидент.',
      value: function (r) { return r.client.type; },
      text: function (r) { return r.client.type; },
      tip: function (r) { return 'Тип клиента: ' + r.client.type; } },

    { key: 'ari', label: 'Индекс опасности', num: true, cls: 'cell-ari',
      head: 'Взвешенная сумма перцентильных рангов восьми метрик, 0–100.',
      value: function (r) { return r.ari; },
      text: function (r) {
        return '<span class="ari"><span class="ari__bar" style="width:' + r.ari.toFixed(1) +
               '%"></span><span class="ari__value">' + F.num1.format(r.ari) + '</span></span>';
      },
      html: true,
      tip: function (r) {
        return 'Индекс опасности: ' + F.num1.format(r.ari) + ' из 100' +
               '\nОкно: ' + windowLabel() + '\nМесто ' + r.rank + ' из ' + R.ranked.rows.length;
      } },

    { key: 'drivers', label: 'Почему', cls: 'cell-drivers', sortable: false,
      head: 'Две метрики с наибольшим вкладом в индекс — с них и начинать разбор.',
      text: function (r) {
        return r.drivers.map(function (m) {
          return '<span class="driver" data-tip="' +
            attr(m.label + '\nВклад: ' + F.num1.format(r.contrib[m.key] * 100) + ' из 100' +
                 '\nПерцентиль: ' + F.pct0.format(r.pr[m.key])) + '">' + attr(m.short) + '</span>';
        }).join('');
      },
      html: true,
      tip: null },

    { key: 'other', label: 'Индекс за другое окно', num: true,
      head: 'Тот же индекс за второе окно: стрелка показывает, разгоняется клиент или затухает.',
      value: function (r) { return other(r) - r.ari; },
      text: function (r) {
        var o = other(r);
        var delta = r.ari - o;
        var mark = Math.abs(delta) < 3 ? '·' : (delta > 0 ? '↑' : '↓');
        return F.num1.format(o) + ' <span class="trend">' + mark + '</span>';
      },
      html: true,
      tip: function (r) {
        var o = other(r);
        return 'Индекс за ' + (R.months === 1 ? '6 месяцев' : '30 дней') + ': ' + F.num1.format(o) +
               '\nЗа ' + windowLabel() + ': ' + F.num1.format(r.ari) +
               '\nРазница: ' + F.num1.format(r.ari - o) +
               (r.ari - o > 3 ? '\nКлиент разгоняется в свежем окне' : '');
      } }
  ]
    .concat(U.metrics.map(metricCol))
    .concat([
      { key: 'flag', label: 'Расследование', cls: 'cell-flag', sortable: true,
        head: 'Отметка «клиент отправлен на расследование». Статус хранится в базе надзорной системы.',
        value: function (r) { return U.flags.has(r.client.code) ? 1 : 0; },
        text: function (r) {
          var on = U.flags.has(r.client.code);
          var at = on ? U.flags.get(r.client.code).at : '';
          return '<button type="button" class="flag-btn' + (on ? ' is-on' : '') +
            '" data-flag="' + attr(r.client.code) + '" aria-pressed="' + on + '" data-tip="' +
            attr(on ? 'Отправлен на расследование ' + at + '\nНажмите, чтобы снять отметку'
                    : 'Отправить клиента на расследование') + '">' +
            (on ? '✓ отправлен' : 'отправить') + '</button>';
        },
        html: true,
        tip: null }
    ]);

  function windowLabel() {
    return R.months === 1 ? '30 дней' : '6 месяцев';
  }

  function other(r) {
    var row = R.other.map[r.client.code];
    return row ? row.ari : 0;
  }

  /* --- Данные ------------------------------------------------------ */

  function recompute() {
    R.ranked = U.rank(R.months, R.weights);
    var alt = U.rank(R.months === 1 ? U.months : 1, R.weights);
    alt.map = {};
    alt.rows.forEach(function (row) { alt.map[row.client.code] = row; });
    R.other = alt;
  }

  function filtered() {
    return R.ranked.rows.filter(function (r) {
      if (R.types.length && R.types.indexOf(r.client.type) === -1) return false;
      if (R.inn && r.client.inn !== R.inn) return false;
      if (R.flag === 'on' && !U.flags.has(r.client.code)) return false;
      if (R.flag === 'off' && U.flags.has(r.client.code)) return false;
      return true;
    });
  }

  function sortRows(rows) {
    var col = COLS.filter(function (c) { return c.key === R.sort.key; })[0];
    if (!col || !col.value) return rows;
    var sign = R.sort.dir === 'asc' ? 1 : -1;

    return rows.slice().sort(function (a, b) {
      var x = col.value(a), y = col.value(b), d;
      if (typeof x === 'string') d = x.localeCompare(y, 'ru');
      else d = x - y;
      if (d) return d * sign;
      return a.rank - b.rank;
    });
  }

  /* --- Отрисовка --------------------------------------------------- */

  function renderHead() {
    document.getElementById('r-head').innerHTML = '<tr>' + COLS.map(function (col) {
      var active = R.sort.key === col.key;
      var cls = col.num ? 'th--num' : '';
      if (col.sortable === false) {
        return '<th scope="col" class="' + cls + '"><span class="sort is-static" data-tip="' +
          attr(col.label + '\n' + col.head) + '">' + attr(col.label) + '</span></th>';
      }
      return '<th scope="col" class="' + cls + '">' +
        '<button type="button" class="sort' + (active ? ' is-active' : '') + '" data-rkey="' +
        attr(col.key) + '" data-tip="' + attr(col.label + '\n' + col.head) + '">' + attr(col.label) +
        '<span class="sort__mark" aria-hidden="true">' +
        (active ? (R.sort.dir === 'asc' ? '▲' : '▼') : '') + '</span></button></th>';
    }).join('') + '</tr>';
  }

  function renderBody(rows) {
    document.getElementById('r-body').innerHTML = rows.map(function (r) {
      var flagged = U.flags.has(r.client.code);
      return '<tr data-href="#/client/' + attr(r.client.code) + '" role="link" tabindex="0"' +
        (flagged ? ' class="is-flagged"' : '') + ' aria-label="' +
        attr('Карточка клиента ' + r.client.code) + '">' +
        COLS.map(function (col) {
          var cls = (col.num ? 'cell-num ' : '') + (col.cls || '');
          var tip = col.tip ? ' data-tip="' + attr(col.tip(r)) + '"' : '';
          var body = col.html ? col.text(r) : attr(col.text(r));
          return '<td class="' + cls.trim() + '"' + tip + '>' + body + '</td>';
        }).join('') + '</tr>';
    }).join('');
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
      return '<button type="button" class="pager__btn" data-rpage="' + p + '"' + (extra || '') +
             '>' + text + '</button>';
    };
    return btn(page - 1, '←', (page === 1 ? ' disabled' : '')) +
      list.map(function (p) {
        return p === '…' ? '<span class="pager__gap">…</span>'
                         : btn(p, p, p === page ? ' aria-current="true"' : '');
      }).join('') +
      btn(page + 1, '→', (page === pages ? ' disabled' : ''));
  }

  function renderWeightsGrid() {
    document.getElementById('r-weights-grid').innerHTML = U.metrics.map(function (m) {
      var w = R.weights[m.key];
      return '<div class="weight' + (w === 0 ? ' is-off' : '') + '">' +
        '<span class="weight__label" data-tip="' + attr(m.label + '\n' + m.hint) + '">' +
        attr(m.short) + '</span>' +
        '<input type="range" class="weight__slider" min="0" max="1" step="0.05" value="' + w +
        '" data-rweight="' + attr(m.key) + '" aria-label="' + attr('Вес: ' + m.label) + '">' +
        '<span class="weight__value">' + F.num2.format(w) + '</span></div>';
    }).join('');
  }

  function render() {
    var rows = sortRows(filtered());
    var pages = Math.max(1, Math.ceil(rows.length / R.perPage));
    R.page = Math.min(Math.max(1, R.page), pages);

    var from = (R.page - 1) * R.perPage;
    var page = rows.slice(from, from + R.perPage);

    renderHead();
    renderBody(page);

    var flagged = rows.filter(function (r) { return U.flags.has(r.client.code); }).length;

    document.getElementById('r-count').innerHTML =
      'В рейтинге <b>' + R.ranked.rows.length + '</b> ' +
      F.plural(R.ranked.rows.length, 'клиент', 'клиента', 'клиентов') +
      ' · после фильтров <b>' + rows.length + '</b> · на расследовании <b>' + flagged + '</b>';

    document.getElementById('r-count').setAttribute('data-tip',
      'Окно: ' + windowLabel() + ' (' + F.shortDate(R.ranked.rows.length ? R.ranked.rows[0].agg.from : U.asOf) +
      ' — ' + F.shortDate(U.asOf) + ')' +
      '\nВсего клиентов в универсуме: ' + U.size +
      '\nНе прошли порог активности: ' + R.ranked.skipped +
      '\nПорог: тейкерский объём от ' + F.mln(U.eligible.takerVolume) +
      ' и от ' + U.eligible.activeDays + ' активных дней');

    document.getElementById('r-page-info').textContent = rows.length
      ? 'Показаны ' + (from + 1) + '–' + (from + page.length) + ' из ' + rows.length
      : 'Под фильтры не попал ни один клиент';

    document.getElementById('r-pager').innerHTML = pagerHtml(R.page, pages);

    document.getElementById('r-weights-note').innerHTML = R.sort.key === 'ari'
      ? 'Индекс = взвешенная сумма перцентильных рангов метрик внутри окна. Вес 0 выключает метрику.'
      : 'Список отсортирован по столбцу таблицы. ' +
        '<button type="button" class="btn-quiet" data-rsort="ari">Вернуть сортировку по индексу</button>';
  }

  function renderControls() {
    document.getElementById('r-window').innerHTML = [
      { m: 1, label: '30 дней' },
      { m: U.months, label: '6 месяцев' }
    ].map(function (o) {
      return '<button type="button" class="chip" data-rwindow="' + o.m + '" aria-pressed="' +
        (R.months === o.m) + '" data-tip="' + attr('Окно ' + o.label + ' до ' + F.shortDate(U.asOf)) +
        '">' + o.label + '</button>';
    }).join('');

    document.getElementById('r-types').innerHTML = U.types.map(function (t) {
      var n = U.clients.filter(function (c) { return c.type === t; }).length;
      return '<button type="button" class="chip" data-rtype="' + attr(t) + '" aria-pressed="' +
        (R.types.indexOf(t) > -1) + '" data-tip="' + attr(t + '\nВ универсуме: ' + n) + '">' +
        attr(t) + '</button>';
    }).join('');

    document.getElementById('r-flag').innerHTML = [
      { v: 'all', label: 'Все' },
      { v: 'on', label: 'Отправленные' },
      { v: 'off', label: 'Не отправленные' }
    ].map(function (o) {
      return '<button type="button" class="chip" data-rflag="' + o.v + '" aria-pressed="' +
        (R.flag === o.v) + '">' + o.label + '</button>';
    }).join('');

    document.getElementById('r-inn').innerHTML = '<option value="">Все брокеры</option>' +
      U.brokers.map(function (b) {
        return '<option value="' + attr(b.inn) + '"' + (R.inn === b.inn ? ' selected' : '') + '>' +
          attr(b.name + ' · ' + b.inn) + '</option>';
      }).join('');

    document.getElementById('r-lede').innerHTML =
      'Клиенты, ранжированные по индексу опасности за выбранное окно. Данные по ' +
      F.longDate(U.asOf) + ' · универсум <b>' + U.size + '</b> клиентов · глубина истории <b>' +
      U.months + '</b> месяцев.';
  }

  /* --- События ----------------------------------------------------- */

  document.addEventListener('click', function (e) {
    var win = e.target.closest('[data-rwindow]');
    if (win) {
      R.months = +win.dataset.rwindow;
      R.page = 1;
      recompute();
      renderControls();
      render();
      return;
    }

    var type = e.target.closest('[data-rtype]');
    if (type) {
      var t = type.dataset.rtype;
      var at = R.types.indexOf(t);
      if (at > -1) R.types.splice(at, 1); else R.types.push(t);
      type.setAttribute('aria-pressed', at > -1 ? 'false' : 'true');
      R.page = 1;
      render();
      return;
    }

    var flagFilter = e.target.closest('[data-rflag]');
    if (flagFilter) {
      R.flag = flagFilter.dataset.rflag;
      R.page = 1;
      renderControls();
      render();
      return;
    }

    var flagBtn = e.target.closest('[data-flag]');
    if (flagBtn) {
      e.stopPropagation();
      U.flags.toggle(flagBtn.dataset.flag);
      render();
      return;
    }

    var sortBtn = e.target.closest('[data-rkey]');
    if (sortBtn) {
      var key = sortBtn.dataset.rkey;
      if (R.sort.key === key) R.sort.dir = R.sort.dir === 'desc' ? 'asc' : 'desc';
      else R.sort = { key: key, dir: 'desc' };
      R.page = 1;
      render();
      return;
    }

    var back = e.target.closest('[data-rsort="ari"]');
    if (back) {
      R.sort = { key: 'ari', dir: 'desc' };
      R.page = 1;
      render();
      return;
    }

    var pageBtn = e.target.closest('.pager__btn[data-rpage]');
    if (pageBtn && !pageBtn.disabled) {
      R.page = +pageBtn.dataset.rpage;
      render();
      return;
    }

    var toggle = e.target.closest('#r-weights-toggle');
    if (toggle) {
      var panel = document.getElementById('r-weights');
      var open = panel.hidden;
      panel.hidden = !open;
      toggle.setAttribute('aria-expanded', String(open));
      toggle.textContent = open ? 'Свернуть настройку индекса' : 'Перенастроить индекс';
      return;
    }

    if (e.target.closest('#r-weights-reset')) {
      R.weights = U.defaultWeights();
      R.sort = { key: 'ari', dir: 'desc' };
      R.page = 1;
      recompute();
      renderWeightsGrid();
      render();
      return;
    }

    var row = e.target.closest('#r-body tr[data-href]');
    if (row) location.hash = row.dataset.href;
  });

  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    var row = e.target.closest('#r-body tr[data-href]');
    if (!row) return;
    e.preventDefault();
    location.hash = row.dataset.href;
  });

  document.getElementById('r-inn').addEventListener('change', function (e) {
    R.inn = e.target.value;
    R.page = 1;
    render();
  });

  var weightTimer = null;
  document.getElementById('r-weights').addEventListener('input', function (e) {
    var slider = e.target.closest('[data-rweight]');
    if (!slider) return;

    var value = +slider.value;
    slider.parentNode.querySelector('.weight__value').textContent = F.num2.format(value);
    slider.parentNode.classList.toggle('is-off', value === 0);
    R.weights[slider.dataset.rweight] = value;

    clearTimeout(weightTimer);
    weightTimer = setTimeout(function () {
      if (R.sort.key !== 'ari') R.sort = { key: 'ari', dir: 'desc' };
      recompute();
      render();
    }, 220);
  });

  MSD.rating = {
    weights: function () { return R.weights; },
    show: function () {
      recompute();
      renderControls();
      renderWeightsGrid();
      render();
    }
  };
})();
