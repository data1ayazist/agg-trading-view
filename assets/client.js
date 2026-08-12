/* Карточка клиента: агрегация метрик за 30 дней и за 6 месяцев,
   разложение индекса опасности, помесячная динамика, бумаги и эпизоды.

   Всё считается из универсума (assets/universe.js), поэтому карточка
   согласована с рейтингом и с разбором конкретной сессии. */

(function () {
  'use strict';

  var MSD = window.MSD;
  var U = MSD.universe;
  var F = MSD.fmt;
  var attr = F.attr;

  var C = { code: null, window: 1 };

  function weights() {
    return MSD.rating ? MSD.rating.weights() : U.defaultWeights();
  }

  function metricText(m, v) {
    if (m.unit === 'pct') return F.pct1.format(v);
    if (m.unit === 'mln') return F.num2.format(v / 1e6) + ' млн ₽';
    return F.num0.format(Math.round(v));
  }

  /* --- Индекс за оба окна ------------------------------------------- */

  function place(months, code) {
    var ranked = U.rank(months, weights());
    var mine = null;
    ranked.rows.forEach(function (r) { if (r.client.code === code) mine = r; });
    return { ranked: ranked, row: mine };
  }

  function renderHeadline(client, month, half) {
    var cards = [
      { label: '30 дней', months: 1, data: month },
      { label: '6 месяцев', months: U.months, data: half }
    ];

    document.getElementById('c-index').innerHTML = cards.map(function (c) {
      if (!c.data.row) {
        return '<div class="score"><p class="score__label">' + c.label + '</p>' +
          '<p class="score__value score__value--muted" data-tip="' +
          attr('Клиент не прошёл порог активности за это окно:\nтейкерский объём от ' +
               F.mln(U.eligible.takerVolume) + ' и от ' + U.eligible.activeDays + ' активных дней') +
          '">—</p><p class="score__note">ниже порога активности</p></div>';
      }
      var r = c.data.row;
      var pool = c.data.ranked.rows.length;
      var percentile = 1 - (r.rank - 1) / Math.max(1, pool - 1);
      return '<div class="score"><p class="score__label">' + c.label + '</p>' +
        '<p class="score__value" data-tip="' +
        attr('Индекс опасности: ' + F.num1.format(r.ari) + ' из 100\nОкно: ' + c.label +
             '\nМесто ' + r.rank + ' из ' + pool + '\nВыше ' + F.pct0.format(percentile) + ' клиентов рейтинга') +
        '">' + F.num1.format(r.ari) + '</p>' +
        '<p class="score__note">место <b>' + r.rank + '</b> из ' + pool + '</p></div>';
    }).join('');

    var m = month.row, h = half.row;
    var delta = m && h ? m.ari - h.ari : null;
    document.getElementById('c-verdict').innerHTML = delta === null
      ? 'Для одного из окон данных недостаточно.'
      : (delta > 5
          ? 'Клиент <b>разгоняется</b>: индекс за 30 дней на ' + F.num1.format(delta) +
            ' выше полугодового. Свежий эпизод важнее исторического фона.'
          : (delta < -5
              ? 'Клиент <b>затухает</b>: индекс за 30 дней на ' + F.num1.format(-delta) +
                ' ниже полугодового. Основная активность — в прошлом.'
              : 'Поведение <b>устойчиво</b>: индекс за 30 дней и за полгода различаются меньше чем на 5 пунктов.'));
  }

  /* --- Таблица агрегатов -------------------------------------------- */

  function renderAggregates(client, month, half) {
    var a1 = U.aggregate(client, 1);
    var a6 = U.aggregate(client, U.months);

    var rows = U.metrics.map(function (m) {
      var v1 = a1[m.key], v6 = a6[m.key];
      var pr1 = month.row ? month.row.pr[m.key] : null;
      var pr6 = half.row ? half.row.pr[m.key] : null;

      return '<tr>' +
        '<th scope="row" class="cell-metric" data-tip="' + attr(m.label + '\n' + m.hint) + '">' +
        attr(m.label) + '</th>' +
        '<td class="cell-num" data-tip="' + attr('За 30 дней: ' + metricText(m, v1) +
          (pr1 === null ? '' : '\nПерцентиль: ' + F.pct0.format(pr1))) + '">' +
        attr(metricText(m, v1)) + '</td>' +
        '<td class="cell-num cell-dim" data-tip="' + attr(pr1 === null ? 'Вне рейтинга за это окно'
          : 'Перцентиль за 30 дней: ' + F.pct0.format(pr1)) + '">' +
        (pr1 === null ? '—' : F.pct0.format(pr1)) + '</td>' +
        '<td class="cell-num" data-tip="' + attr('За 6 месяцев: ' + metricText(m, v6) +
          (pr6 === null ? '' : '\nПерцентиль: ' + F.pct0.format(pr6))) + '">' +
        attr(metricText(m, v6)) + '</td>' +
        '<td class="cell-num cell-dim" data-tip="' + attr(pr6 === null ? 'Вне рейтинга за это окно'
          : 'Перцентиль за 6 месяцев: ' + F.pct0.format(pr6)) + '">' +
        (pr6 === null ? '—' : F.pct0.format(pr6)) + '</td></tr>';
    }).join('');

    document.getElementById('c-agg').innerHTML =
      '<thead><tr><th scope="col">Метрика</th>' +
      '<th scope="col" class="th--num">30 дней</th><th scope="col" class="th--num">перц.</th>' +
      '<th scope="col" class="th--num">6 месяцев</th><th scope="col" class="th--num">перц.</th>' +
      '</tr></thead><tbody>' + rows + '</tbody>';
  }

  /* --- Разложение индекса ------------------------------------------- */

  function renderBreakdown(month, half) {
    var data = C.window === 1 ? month : half;
    var host = document.getElementById('c-breakdown');

    if (!data.row) {
      host.innerHTML = '<p class="card__foot">За это окно клиент не прошёл порог активности, ' +
        'индекс не считается.</p>';
      return;
    }

    var r = data.row;
    var max = Math.max.apply(null, U.metrics.map(function (m) { return r.contrib[m.key]; })) || 1;

    host.innerHTML = U.metrics.slice().sort(function (a, b) {
      return r.contrib[b.key] - r.contrib[a.key];
    }).map(function (m) {
      var contrib = r.contrib[m.key] * 100;
      var tip = m.label + '\n' + m.hint +
        '\nЗначение: ' + metricText(m, r.agg[m.key]) +
        '\nПерцентиль: ' + F.pct0.format(r.pr[m.key]) +
        '\nВес: ' + F.num2.format(weights()[m.key]) +
        '\nВклад: ' + F.num1.format(contrib) + ' из ' + F.num1.format(r.ari);

      return '<div class="bar" data-tip="' + attr(tip) + '">' +
        '<span class="bar__label">' + attr(m.short) + '</span>' +
        '<span class="bar__track"><span class="bar__fill" style="width:' +
        (r.contrib[m.key] / max * 100).toFixed(1) + '%"></span></span>' +
        '<span class="bar__value">' + F.num1.format(contrib) + '</span></div>';
    }).join('');
  }

  /* --- Помесячная динамика ------------------------------------------ */

  function renderTrend(series) {
    var W = 660, H = 210, padL = 4, padR = 4, padT = 12, padB = 26;
    var plotW = W - padL - padR, plotH = H - padT - padB;
    var step = plotW / series.length;

    var maxVol = Math.max.apply(null, series.map(function (s) { return s.buyVolume; })) || 1;
    var svg = [];

    /* Сетка по объёму */
    [0.25, 0.5, 0.75, 1].forEach(function (k) {
      var y = padT + plotH - plotH * k;
      svg.push('<line class="chart__grid" x1="' + padL + '" x2="' + (W - padR) + '" y1="' +
        y.toFixed(1) + '" y2="' + y.toFixed(1) + '"/>');
    });

    series.forEach(function (s, i) {
      var x = padL + step * i;
      var bw = step * 0.28;
      var hBuy = s.buyVolume / maxVol * plotH;
      var hTaker = s.takerVolume / maxVol * plotH;

      svg.push('<rect class="mbar mbar--buy" x="' + (x + step * 0.16).toFixed(1) + '" y="' +
        (padT + plotH - hBuy).toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' +
        hBuy.toFixed(1) + '" data-tip="' + attr(F.month(s.to) + '\nОбъём покупок: ' + F.mln(s.buyVolume) +
        '\nТейкерский объём: ' + F.mln(s.takerVolume)) + '"/>');

      svg.push('<rect class="mbar mbar--taker" x="' + (x + step * 0.16 + bw + 2).toFixed(1) + '" y="' +
        (padT + plotH - hTaker).toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' +
        hTaker.toFixed(1) + '" data-tip="' + attr(F.month(s.to) + '\nТейкерский объём: ' + F.mln(s.takerVolume) +
        '\nДоля от покупок: ' + F.pct1.format(s.takerVolume / (s.buyVolume || 1))) + '"/>');

      svg.push('<text class="chart__time" x="' + (x + step / 2).toFixed(1) + '" y="' +
        (H - 8) + '">' + attr(F.month(s.to)) + '</text>');
    });

    /* Линия индекса: 0–100 по той же высоте */
    var pts = series.map(function (s, i) {
      var x = padL + step * i + step / 2;
      var y = padT + plotH - (s.ari === null ? 0 : s.ari / 100 * plotH);
      return { x: x, y: y, s: s };
    });

    svg.push('<polyline class="mline" points="' + pts.map(function (p) {
      return p.x.toFixed(1) + ',' + p.y.toFixed(1);
    }).join(' ') + '"/>');

    pts.forEach(function (p) {
      svg.push('<circle class="mdot" cx="' + p.x.toFixed(1) + '" cy="' + p.y.toFixed(1) +
        '" r="3.5" data-tip="' + attr(F.month(p.s.to) + '\nИндекс опасности: ' +
        (p.s.ari === null ? 'ниже порога активности' : F.num1.format(p.s.ari) +
          '\nМесто ' + p.s.rank + ' из ' + p.s.pool) +
        '\nАномальных сессий: ' + p.s.anomalyHits +
        '\nПрибыль FIFO: ' + F.ths(p.s.pnl)) + '"/>');
    });

    document.getElementById('c-trend').innerHTML =
      '<svg viewBox="0 0 ' + W + ' ' + H + '" class="trend" role="img" ' +
      'aria-label="Помесячная динамика объёмов и индекса">' + svg.join('') + '</svg>';
  }

  /* --- Бумаги -------------------------------------------------------- */

  function renderMix(mix) {
    var R = 62, SW = 22, CIRC = 2 * Math.PI * R;
    var offset = 0;

    var arcs = mix.map(function (s, i) {
      var len = CIRC * s.share;
      var el = '<circle class="donut__seg" cx="80" cy="80" r="' + R + '" stroke-width="' + SW +
        '" stroke-dasharray="' + (len - 1.5).toFixed(2) + ' ' + (CIRC - len + 1.5).toFixed(2) +
        '" stroke-dashoffset="' + (-offset).toFixed(2) + '" style="opacity:' +
        (0.9 - i * 0.14).toFixed(2) + '" data-tip="' +
        attr(s.security + '\nДоля тейкерского объёма: ' + F.pct1.format(s.share) +
             '\nОбъём: ' + F.mln(s.volume)) + '"/>';
      offset += len;
      return el;
    }).join('');

    var legend = mix.map(function (s, i) {
      return '<li class="legend__item" data-tip="' + attr(s.security + '\nДоля: ' +
        F.pct1.format(s.share) + '\nОбъём: ' + F.mln(s.volume)) + '">' +
        '<span class="legend__dot" style="opacity:' + (0.9 - i * 0.14).toFixed(2) + '"></span>' +
        '<span class="legend__name">' + attr(s.security) + '</span>' +
        '<span class="legend__value">' + F.pct1.format(s.share) + '</span></li>';
    }).join('');

    document.getElementById('c-mix').innerHTML =
      '<svg viewBox="0 0 160 160" class="donut" role="img" aria-label="Распределение объёма по бумагам">' +
      '<circle class="donut__base" cx="80" cy="80" r="' + R + '" stroke-width="' + SW + '"/>' +
      arcs + '</svg><ul class="legend">' + legend + '</ul>';
  }

  /* --- Эпизоды ------------------------------------------------------- */

  function renderIncidents(client) {
    var items = U.incidents(client);
    var host = document.getElementById('c-incidents');

    if (!items.length) {
      host.innerHTML = '<tbody><tr><td class="cell-dim">За полгода клиент не попадал ' +
        'в топ покупателей аномальных сессий.</td></tr></tbody>';
      return;
    }

    host.innerHTML = '<thead><tr>' +
      '<th scope="col">Дата</th><th scope="col">Бумага</th><th scope="col">Роль</th>' +
      '<th scope="col" class="th--num">Изм. закрытия</th>' +
      '<th scope="col" class="th--num">Макс. минута</th>' +
      '<th scope="col" class="th--num">Объём сессии, млн ₽</th>' +
      '<th scope="col">Разбор</th></tr></thead><tbody>' +
      items.map(function (it) {
        var href = '#/session/' + it.date + '/' + it.board + '/' + it.security;
        return '<tr>' +
          '<td class="cell-date" data-tip="' + attr(F.longDate(it.date)) + '">' +
            F.shortDate(it.date) + '</td>' +
          '<td class="cell-sec" data-tip="' + attr(it.security + ' · ' + it.board +
            ' · уровень листинга ' + it.listing) + '">' + attr(it.security) + '</td>' +
          '<td data-tip="' + attr(it.suspect
            ? 'Клиент — основной агрессор сессии'
            : 'Клиент в топ-8 покупателей, место ' + it.rank) + '">' +
            (it.suspect ? '<span class="flag flag--marking">агрессор</span>'
                        : '<span class="cell-dim">топ-' + it.rank + '</span>') + '</td>' +
          '<td class="cell-num ' + (it.closeChange > 0 ? 'delta--up' : 'delta--down') + '">' +
            F.pctSigned.format(it.closeChange) + '</td>' +
          '<td class="cell-num">' + F.pct1.format(it.maxMinuteGain) + '</td>' +
          '<td class="cell-num">' + F.num2.format(it.volume / 1e6) + '</td>' +
          '<td>' + (it.real
            ? '<a class="backlink backlink--inline" href="' + href + '">открыть →</a>'
            : '<span class="cell-dim" data-tip="' +
              attr('Эпизод вне текущей выгрузки: разбор доступен только для сессий из anomal-sessions.xlsx') +
              '">вне выгрузки</span>') + '</td></tr>';
      }).join('') + '</tbody>';
  }

  /* --- Флаг расследования -------------------------------------------- */

  function renderFlag(code) {
    var on = U.flags.has(code);
    var at = on ? U.flags.get(code).at : '';

    document.getElementById('c-flag-btn').outerHTML =
      '<button type="button" class="btn-action btn-action--wide' + (on ? ' is-on' : '') +
      '" id="c-flag-btn" data-flag-client="' + attr(code) + '" aria-pressed="' + on + '">' +
      (on ? 'Снять с расследования' : 'Отправить на расследование') +
      '<span class="btn-action__tag">' + (on ? 'отправлен' : 'флаг') + '</span></button>';

    document.getElementById('c-flag-note').innerHTML = on
      ? 'Отправлен на расследование <b>' + attr(at) + '</b>. Статус хранится в базе ' +
        'надзорной системы и виден коллегам.'
      : 'Статус сохраняется в базе надзорной системы и попадёт в фильтр ' +
        '«Расследование» на витрине рейтинга.';

    document.getElementById('c-status').innerHTML = on
      ? '<span class="flag flag--marking">на расследовании</span>'
      : '<span class="flag flag--off">не отправлен</span>';
  }

  /* --- Сборка -------------------------------------------------------- */

  function render(code) {
    var client = U.byCode(code);
    if (!client) return false;

    C.code = code;
    var month = place(1, code);
    var half = place(U.months, code);

    document.getElementById('c-eyebrow').textContent =
      'Карточка клиента · ' + client.broker + ' · ИНН ' + client.inn;
    document.getElementById('c-title').textContent = client.code;
    document.getElementById('c-lede').innerHTML =
      'Тип клиента — <b>' + attr(client.type) + '</b> · бумаг в работе <b>' +
      client.securities.length + '</b> · данные по ' + F.longDate(U.asOf) +
      ' · история <b>' + U.months + '</b> месяцев.';

    renderHeadline(client, month, half);
    renderAggregates(client, month, half);
    renderBreakdown(month, half);
    renderTrend(U.monthlySeries(code, weights()));
    renderMix(U.securityMix(client, C.window === 1 ? 1 : U.months));
    renderIncidents(client);
    renderFlag(code);

    document.getElementById('c-window').innerHTML = [
      { m: 1, label: '30 дней' },
      { m: U.months, label: '6 месяцев' }
    ].map(function (o) {
      return '<button type="button" class="chip" data-cwindow="' + o.m + '" aria-pressed="' +
        (C.window === o.m) + '">' + o.label + '</button>';
    }).join('');

    return true;
  }

  /* --- События -------------------------------------------------------- */

  document.addEventListener('click', function (e) {
    var win = e.target.closest('[data-cwindow]');
    if (win) {
      C.window = +win.dataset.cwindow;
      render(C.code);
      return;
    }

    var flagBtn = e.target.closest('[data-flag-client]');
    if (flagBtn) {
      U.flags.toggle(flagBtn.dataset.flagClient);
      renderFlag(C.code);
    }
  });

  MSD.client = { render: render };
})();
