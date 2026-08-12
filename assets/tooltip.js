/* Тултипы: один плавающий элемент на страницу, содержимое — из data-tip.
   Работает по наведению и по фокусу с клавиатуры; \n в data-tip даёт перенос. */

(function () {
  'use strict';

  var GAP = 8;
  var el = document.getElementById('tooltip');
  var current = null;

  function place(target) {
    var r = target.getBoundingClientRect();
    var t = el.getBoundingClientRect();

    var left = r.left + r.width / 2 - t.width / 2;
    left = Math.max(GAP, Math.min(left, window.innerWidth - t.width - GAP));

    var top = r.top - t.height - GAP;
    if (top < GAP) top = r.bottom + GAP;

    el.style.left = Math.round(left) + 'px';
    el.style.top = Math.round(top) + 'px';
  }

  function show(target) {
    var text = target.getAttribute('data-tip');
    if (!text) return;

    current = target;
    el.textContent = text;
    el.style.left = '-9999px';
    el.style.top = '0px';
    el.setAttribute('aria-hidden', 'false');

    place(target);
    el.classList.add('is-visible');
  }

  function hide() {
    current = null;
    el.classList.remove('is-visible');
    el.setAttribute('aria-hidden', 'true');
  }

  function pick(node) {
    return node && node.closest ? node.closest('[data-tip]') : null;
  }

  document.addEventListener('mouseover', function (e) {
    var target = pick(e.target);
    if (target === current) return;
    if (target) show(target);
    else if (current) hide();
  });

  document.addEventListener('mouseout', function (e) {
    if (current && !pick(e.relatedTarget)) hide();
  });

  document.addEventListener('focusin', function (e) {
    var target = pick(e.target);
    if (target) show(target);
  });

  document.addEventListener('focusout', hide);

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') hide();
  });

  window.addEventListener('scroll', function () {
    if (current) place(current);
  }, true);

  window.addEventListener('resize', hide);

  window.MSD = window.MSD || {};
  window.MSD.tooltip = { hide: hide };
})();
