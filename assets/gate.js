/* Вход в витрину.

   ВАЖНО про уровень защиты. Сайт статический и лежит в публичном репозитории,
   поэтому проверка учётных данных происходит в браузере: здесь хранится только
   SHA-256 от пары «логин + пароль», сам пароль в коде не лежит. Это заслонка
   от случайного захода, а не контроль доступа — файлы витрины (в том числе
   assets/data.js) отдаются по прямой ссылке в обход этой формы.

   Если понадобится настоящая защита без бэкенда — данные надо шифровать
   ключом из пароля (PBKDF2 + AES-GCM) и держать исходники вне публикуемой
   папки; тогда без пароля расшифровывать будет нечего. */

(function () {
  'use strict';

  var HASH = '031a6971eef92bef738bc8b084ac5a28b575e6e8ed803fc5b233928bd9f15562';
  var KEY = 'msd.gate.v1';

  var lock = document.getElementById('lock');
  var shell = document.getElementById('shell');
  var form = document.getElementById('lock-form');
  var error = document.getElementById('lock-error');

  function open() {
    lock.hidden = true;
    shell.hidden = false;
    /* Инлайновый стиль — страховка от устаревшего theme.css в кеше браузера:
       без него правило .lock { display: flex } перебивает атрибут hidden
       и форма остаётся поверх открытой витрины. */
    lock.style.display = 'none';
    shell.style.display = '';
  }

  function fail(text) {
    error.textContent = text;
    error.hidden = false;
  }

  function digest(login, pass) {
    var bytes = new TextEncoder().encode(login + '\n' + pass);
    return crypto.subtle.digest('SHA-256', bytes).then(function (buf) {
      return Array.prototype.map.call(new Uint8Array(buf), function (b) {
        return b.toString(16).padStart(2, '0');
      }).join('');
    });
  }

  try {
    if (sessionStorage.getItem(KEY) === HASH) open();
  } catch (e) { /* приватный режим */ }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    error.hidden = true;

    var login = document.getElementById('lock-login').value.trim();
    var pass = document.getElementById('lock-pass').value;

    if (!window.crypto || !crypto.subtle) {
      fail('Витрину нужно открывать по http(s): проверка не работает с локального файла.');
      return;
    }

    digest(login, pass).then(function (hex) {
      if (hex !== HASH) {
        fail('Неверный логин или пароль.');
        document.getElementById('lock-pass').value = '';
        return;
      }
      try { sessionStorage.setItem(KEY, HASH); } catch (e2) { /* приватный режим */ }
      open();
    });
  });
})();
