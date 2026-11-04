/* ==========================================================================
   main.js
   Acceso con contraseña (WebCrypto), idioma, audio sintetizado y animaciones.
   ========================================================================== */
(function () {
  'use strict';

  var doc = document;
  var $ = function (s, c) { return (c || doc).querySelector(s); };
  var $$ = function (s, c) { return Array.prototype.slice.call((c || doc).querySelectorAll(s)); };
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function store(kind, key, val) {
    try {
      var s = window[kind];
      if (val === undefined) return s.getItem(key);
      if (val === null) s.removeItem(key); else s.setItem(key, val);
    } catch (e) { return null; }
  }

  /* ------------------------------------------------------------------------
     Textos públicos de la pantalla de acceso (lo único legible sin clave)
     ------------------------------------------------------------------------ */
  var GATE = {
    es: { whisper: 'La mansión escucha.', error: 'No te reconoce.', input: 'Contraseña', enter: 'Entrar' },
    en: { whisper: 'The manor is listening.', error: 'It does not recognize you.', input: 'Password', enter: 'Enter' }
  };

  var lang = store('localStorage', 'sg-lang') ||
    ((navigator.language || 'es').toLowerCase().indexOf('es') === 0 ? 'es' : 'en');

  /* ------------------------------------------------------------------------
     Criptografía: PBKDF2-SHA256 → AES-256-CBC + HMAC-SHA256 (encrypt-then-MAC)
     Formato de cada bloque: IV(16) | cifrado | HMAC(32)
     ------------------------------------------------------------------------ */
  var Crypto = {
    b64: function (s) {
      var bin = atob(s.replace(/\s+/g, '')), out = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      return out;
    },
    toB64: function (bytes) {
      var s = '';
      for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
      return btoa(s);
    },
    derive: function (pass, salt, iter) {
      var enc = new TextEncoder();
      return crypto.subtle.importKey('raw', enc.encode(pass), 'PBKDF2', false, ['deriveBits'])
        .then(function (base) {
          return crypto.subtle.deriveBits({ name: 'PBKDF2', salt: salt, iterations: iter, hash: 'SHA-256' }, base, 512);
        })
        .then(function (bits) { return new Uint8Array(bits); });
    },
    keys: function (bits) {
      return Promise.all([
        crypto.subtle.importKey('raw', bits.slice(0, 32), { name: 'AES-CBC' }, false, ['decrypt']),
        crypto.subtle.importKey('raw', bits.slice(32, 64), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify'])
      ]).then(function (k) { return { aes: k[0], mac: k[1] }; });
    },
    open: function (keys, data) {
      var n = data.length;
      var body = data.subarray(0, n - 32), tag = data.subarray(n - 32);
      return crypto.subtle.verify('HMAC', keys.mac, tag, body).then(function (ok) {
        if (!ok) throw new Error('mac');
        return crypto.subtle.decrypt({ name: 'AES-CBC', iv: data.subarray(0, 16) }, keys.aes, data.subarray(16, n - 32));
      });
    }
  };

  /* ------------------------------------------------------------------------
     Imágenes: en el sitio publicado están encriptadas (a/*.bin) y se
     desencriptan bajo demanda a URLs blob:. En desarrollo se usan directo.
     ------------------------------------------------------------------------ */
  var Assets = {
    map: null, keys: null, cache: {},
    pick: function (el) {
      var w = window.innerWidth * Math.min(window.devicePixelRatio || 1, 2);
      return (el.getAttribute('data-src-sm') && w < 1100) ? el.getAttribute('data-src-sm') : el.getAttribute('data-src');
    },
    url: function (path) {
      if (!this.map) return Promise.resolve(path);
      if (this.cache[path]) return this.cache[path];
      var bin = this.map[path], keys = this.keys;
      var p = !bin ? Promise.resolve(path) : fetch(bin)
        .then(function (r) { return r.arrayBuffer(); })
        .then(function (buf) { return Crypto.open(keys, new Uint8Array(buf)); })
        .then(function (plain) { return URL.createObjectURL(new Blob([plain], { type: /\.svg$/i.test(path) ? 'image/svg+xml' : /\.png$/i.test(path) ? 'image/png' : 'image/jpeg' })); });
      this.cache[path] = p;
      return p;
    },
    load: function (el) {
      if (el.__sgLoaded) return;
      el.__sgLoaded = true;
      this.url(this.pick(el)).then(function (u) {
        if (el.tagName === 'IMG') {
          el.onload = function () { el.classList.add('is-loaded'); };
          el.src = u;
        } else {
          el.style.backgroundImage = 'url("' + u + '")';
          el.classList.add('is-loaded');
        }
      }).catch(function () {});
    },
    observe: function () {
      var self = this, els = $$('#vault [data-src]');
      if (!('IntersectionObserver' in window)) { els.forEach(function (el) { self.load(el); }); return; }
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) { if (e.isIntersecting) { self.load(e.target); io.unobserve(e.target); } });
      }, { rootMargin: '150% 0px' });
      els.forEach(function (el) { io.observe(el); });
    }
  };

  /* ------------------------------------------------------------------------
     Idioma
     ------------------------------------------------------------------------ */
  var I18N = { orig: {}, origAttr: {} };

  function applyGateLang() {
    var t = GATE[lang];
    $$('[data-gate]').forEach(function (el) {
      var k = el.getAttribute('data-gate');
      if (k === 'error') { if (el.textContent) el.textContent = t.error; } else el.textContent = t[k];
    });
    $$('[data-gate-aria]').forEach(function (el) { el.setAttribute('aria-label', t[el.getAttribute('data-gate-aria')]); });
  }

  function applyLang(l) {
    lang = l;
    store('localStorage', 'sg-lang', l);
    doc.documentElement.lang = l;
    applyGateLang();
    $$('.lang-switch button').forEach(function (b) {
      var on = b.getAttribute('data-lang') === l;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    var dict = (window.SG_I18N && window.SG_I18N[l]) || null;
    $$('#vault [data-i18n]').forEach(function (el) {
      var k = el.getAttribute('data-i18n');
      if (!(k in I18N.orig)) I18N.orig[k] = el.innerHTML;
      el.innerHTML = (l !== 'es' && dict && dict[k] != null) ? dict[k] : I18N.orig[k];
    });
    $$('#vault [data-i18n-attr]').forEach(function (el) {
      el.getAttribute('data-i18n-attr').split(';').forEach(function (pair) {
        var p = pair.split(':'), attr = p[0], k = p[1], id = attr + '|' + k;
        if (!(id in I18N.origAttr)) I18N.origAttr[id] = el.getAttribute(attr);
        el.setAttribute(attr, (l !== 'es' && dict && dict[k] != null) ? dict[k] : I18N.origAttr[id]);
      });
    });
    if (doc.body.classList.contains('is-ready')) {
      buildNav();
      if (window.ScrollTrigger) window.ScrollTrigger.refresh();
    }
  }

  doc.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('.lang-switch button');
    if (b) applyLang(b.getAttribute('data-lang'));
    // enlaces internas (#capítulo): desplazamiento suave hecho a mano
    var a = e.target.closest && e.target.closest('#vault a[href^="#"]');
    if (a && a.getAttribute('href').length > 1) {
      var target = doc.getElementById(a.getAttribute('href').slice(1));
      if (target) {
        e.preventDefault();
        window.scrollTo({ top: target.getBoundingClientRect().top + window.scrollY, behavior: reduceMotion ? 'auto' : 'smooth' });
        if (history.replaceState) history.replaceState(null, '', '#' + target.id);
      }
    }
  });

  /* ------------------------------------------------------------------------
     Audio sintetizado (Web Audio): campanas del reloj + ambiente
     ------------------------------------------------------------------------ */
  var Sound = {
    ctx: null, on: false, amb: null,
    ensure: function () {
      if (!this.ctx) {
        var AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        var c = this.ctx = new AC();
        this.master = c.createGain(); this.master.gain.value = .9; this.master.connect(c.destination);
        // reverberación con impulso generado
        var len = c.sampleRate * 4, buf = c.createBuffer(2, len, c.sampleRate);
        for (var ch = 0; ch < 2; ch++) {
          var d = buf.getChannelData(ch);
          for (var i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6);
        }
        this.rev = c.createConvolver(); this.rev.buffer = buf;
        this.revGain = c.createGain(); this.revGain.gain.value = .45;
        this.rev.connect(this.revGain); this.revGain.connect(this.master);
      }
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return this.ctx;
    },
    bell: function (vol, f) {
      var c = this.ensure(); if (!c) return;
      vol = vol == null ? .5 : vol; f = f || 174.6;
      var t = c.currentTime + .02, out = c.createGain();
      out.gain.value = vol * .16; out.connect(this.master); out.connect(this.rev);
      // parciales inarmónicos de una campana
      [[.5, .55, 7], [1, 1, 5], [1.19, .55, 3.5], [1.56, .35, 3], [2, .45, 2.4], [2.51, .22, 1.8], [2.66, .18, 1.5], [3.01, .12, 1.2], [4.1, .07, .8]]
        .forEach(function (p) {
          var o = c.createOscillator(), g = c.createGain();
          o.type = 'sine'; o.frequency.value = f * p[0];
          g.gain.setValueAtTime(0, t);
          g.gain.linearRampToValueAtTime(p[1], t + .006);
          g.gain.exponentialRampToValueAtTime(.0001, t + p[2]);
          o.connect(g); g.connect(out); o.start(t); o.stop(t + p[2] + .1);
        });
    },
    startAmbient: function () {
      var c = this.ensure(); if (!c || this.amb) return;
      var t = c.currentTime, out = c.createGain();
      out.gain.setValueAtTime(0, t); out.gain.linearRampToValueAtTime(1, t + 3);
      out.connect(this.master); out.connect(this.rev);
      // viento: ruido marrón filtrado con LFO
      var len = c.sampleRate * 6, buf = c.createBuffer(1, len, c.sampleRate), d = buf.getChannelData(0), last = 0;
      for (var i = 0; i < len; i++) { var w = Math.random() * 2 - 1; last = (last + .02 * w) / 1.02; d[i] = last * 3.2; }
      var noise = c.createBufferSource(); noise.buffer = buf; noise.loop = true;
      var bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 420; bp.Q.value = .8;
      var lfo = c.createOscillator(), lfoG = c.createGain(); lfo.frequency.value = .07; lfoG.gain.value = 260;
      lfo.connect(lfoG); lfoG.connect(bp.frequency);
      var wg = c.createGain(); wg.gain.value = .22;
      noise.connect(bp); bp.connect(wg); wg.connect(out);
      // drone grave
      var lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 220;
      var dg = c.createGain(); dg.gain.value = .05;
      var o1 = c.createOscillator(), o2 = c.createOscillator(), o3 = c.createOscillator();
      o1.type = 'sawtooth'; o1.frequency.value = 43.65; o2.type = 'sawtooth'; o2.frequency.value = 43.95; o3.type = 'sine'; o3.frequency.value = 65.4;
      [o1, o2, o3].forEach(function (o) { o.connect(lp); });
      lp.connect(dg); dg.connect(out);
      [noise, lfo, o1, o2, o3].forEach(function (n) { n.start(t); });
      this.amb = { out: out, nodes: [noise, lfo, o1, o2, o3] };
    },
    stopAmbient: function () {
      if (!this.amb) return;
      var c = this.ctx, a = this.amb, t = c.currentTime;
      a.out.gain.cancelScheduledValues(t); a.out.gain.setValueAtTime(a.out.gain.value, t); a.out.gain.linearRampToValueAtTime(0, t + 1.2);
      a.nodes.forEach(function (n) { n.stop(t + 1.3); });
      this.amb = null;
    },
    toggle: function () {
      this.on = !this.on;
      if (this.on) { this.startAmbient(); this.bell(.35); } else this.stopAmbient();
      $$('.sound-btn').forEach(function (b) { b.setAttribute('aria-pressed', Sound.on ? 'true' : 'false'); });
    }
  };

  /* ------------------------------------------------------------------------
     Pantalla de acceso
     ------------------------------------------------------------------------ */
  var vaultData = $('#vault-data');
  var gate = $('#gate');

  function setupGate() {
    applyGateLang();
    var input = $('#gate-input'), eye = $('.gate__eye'), err = $('[data-gate="error"]'), busy = false;
    // largo de la clave (lo escribe el build): el último carácter abre el ojo al 100%
    var passLen = Math.max(1, parseInt(vaultData && vaultData.getAttribute('data-len'), 10) || 6);
    setTimeout(function () { try { input.focus({ preventScroll: true }); } catch (e) {} }, 400);
    input.addEventListener('input', function () {
      var n = input.value.length;
      // empieza como una línea y se abre con cada carácter
      eye.style.setProperty('--open', Math.min(.04 + (n / passLen) * .96, 1));
      gate.classList.toggle('is-awake', n >= 3);
      gate.classList.remove('is-wrong'); err.textContent = '';
    });
    $('.gate__form').addEventListener('submit', function (e) {
      e.preventDefault();
      if (busy || !input.value) return;
      busy = true; gate.classList.add('is-busy');
      Sound.ensure(); // el gesto del usuario habilita el audio
      tryPassword(input.value).then(function () {
        Sound.bell(.55);
        eye.style.setProperty('--open', 1);
        openGate();
      }).catch(function () {
        busy = false; gate.classList.remove('is-busy');
        gate.classList.remove('is-wrong'); void gate.offsetWidth; gate.classList.add('is-wrong');
        err.textContent = GATE[lang].error;
        eye.style.setProperty('--open', .04);
        gate.classList.remove('is-awake');
        input.value = ''; input.focus();
      });
    });
  }

  function tryPassword(pass) {
    if (!vaultData) return Promise.resolve(); // modo desarrollo
    if (!window.crypto || !crypto.subtle) return Promise.reject(new Error('no-crypto'));
    var salt = Crypto.b64(vaultData.getAttribute('data-salt'));
    var iter = parseInt(vaultData.getAttribute('data-iter'), 10);
    return Crypto.derive(pass, salt, iter).then(unlockWithBits);
  }

  function unlockWithBits(bits) {
    return Crypto.keys(bits).then(function (keys) {
      return Crypto.open(keys, Crypto.b64(vaultData.textContent)).then(function (plain) {
        var payload = JSON.parse(new TextDecoder().decode(plain));
        $('#vault').innerHTML = payload.html;
        if (payload.i18n) (new Function(payload.i18n))();
        Assets.map = payload.map || null;
        Assets.keys = keys;
      });
    });
  }

  function setTitle() {
    var t = $('#vault [data-doc-title]');
    if (t) doc.title = t.getAttribute('data-doc-title');
  }

  function openGate() {
    setTitle();
    initSite();
    // primero se desvanece todo (ojo, texto, vela) y recién después se abren las puertas.
    // El scroll se libera recién entonces: así el salto de la barra de scroll no se ve en el texto de la pantalla
    gate.classList.add('is-fading');
    setTimeout(function () {
      doc.body.classList.remove('is-locked');
      if (window.ScrollTrigger) ScrollTrigger.refresh(); // el ancho cambia al aparecer la barra
      gate.classList.add('is-opening');
    }, 950);
    setTimeout(function () { gate.parentNode && gate.parentNode.removeChild(gate); }, 950 + 2000);
  }

  function boot() {
    applyLang(lang);
    var dev = !vaultData;
    var showGate = !dev || /[?&]gate\b/.test(location.search);
    if (!showGate) {
      gate.parentNode.removeChild(gate);
      doc.body.classList.remove('is-locked');
      setTitle();
      initSite();
      return;
    }
    // siempre se arranca en la pantalla de contraseña (no se recuerda la clave entre recargas)
    store('sessionStorage', 'sg-k', null);
    setupGate();
  }

  /* ------------------------------------------------------------------------
     Navegación tipo reloj + hora actual
     ------------------------------------------------------------------------ */
  function buildNav() {
    var ol = $('.js-clocknav'); if (!ol) return;
    ol.innerHTML = '';
    navTargets().forEach(function (s) {
      var li = doc.createElement('li'), a = doc.createElement('a');
      var label = $('.chapter__label', s), num = s.getAttribute('data-num');
      a.href = '#' + s.id;
      a.innerHTML = num + '<span class="clocknav__l"></span>';
      a.lastChild.textContent = label ? label.textContent : '';
      a.setAttribute('aria-label', num + ' · ' + (label ? label.textContent : ''));
      li.appendChild(a); ol.appendChild(li);
    });
    updateNav();
  }

  // capítulos + puntos extra (.js-navpoint, p. ej. Contacto), en orden del documento
  function navTargets() { return $$('#vault .chapter, #vault .js-navpoint'); }

  var currentChapter = null, lastY = 0;
  function updateNav() {
    var targets = navTargets(), mid = window.innerHeight * .4, cur = targets[0];
    targets.forEach(function (s) { if (s.getBoundingClientRect().top <= mid) cur = s; });
    // al llegar al final de la página se marca el último punto aunque no alcance la línea media
    if (window.innerHeight + window.scrollY >= doc.documentElement.scrollHeight - 2) cur = targets[targets.length - 1];
    var idx = targets.indexOf(cur);
    $$('.js-clocknav a').forEach(function (a, i) {
      a.classList.toggle('is-on', i === idx);
      a.classList.toggle('is-past', i < idx);
      if (i === idx) a.setAttribute('aria-current', 'true'); else a.removeAttribute('aria-current');
    });
    var hourEl = $('.js-hour');
    if (hourEl && cur) {
      hourEl.textContent = cur.getAttribute('data-num');
      hourEl.parentNode.classList.toggle('is-on', idx > 0);
    }
    var y = window.scrollY, top = $('.topbar');
    if (top) {
      top.classList.toggle('is-solid', y > 40);
      // se oculta al bajar y reaparece al subir
      top.classList.toggle('is-hidden', y > 400 && y > lastY + 2);
      if (y < lastY - 2 || y <= 400) top.classList.remove('is-hidden');
    }
    lastY = y;
    var max = doc.documentElement.scrollHeight - window.innerHeight;
    var bar = $('.topbar__progress span');
    if (bar) bar.style.transform = 'scaleX(' + (max > 0 ? window.scrollY / max : 0) + ')';
    currentChapter = cur;
  }

  /* ------------------------------------------------------------------------
     Widgets
     ------------------------------------------------------------------------ */

  // Selector de duración (La mansión decide)
  function initTimer() {
    var box = $('.timer'); if (!box) return;
    var ring = $('.timer__ring', box), time = $('.js-timer-time', box), ballots = $$('.timer__ballots i', box);
    var C = 2 * Math.PI * 86, raf = null, started = false;
    ring.style.strokeDasharray = C;
    var ticks = $('.timer__ticks', box), NS = 'http://www.w3.org/2000/svg';
    for (var i = 0; i < 60; i++) {
      var a = i / 60 * Math.PI * 2, r1 = i % 5 ? 76 : 72, l = doc.createElementNS(NS, 'line');
      l.setAttribute('x1', 100 + Math.cos(a) * r1); l.setAttribute('y1', 100 + Math.sin(a) * r1);
      l.setAttribute('x2', 100 + Math.cos(a) * 79); l.setAttribute('y2', 100 + Math.sin(a) * 79);
      ticks.appendChild(l);
    }
    function fmt(sec) {
      var h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = Math.floor(sec % 60);
      var mm = (m < 10 ? '0' : '') + m, ss = (s < 10 ? '0' : '') + s;
      return h ? h + ':' + mm + ':' + ss : mm + ':' + ss;
    }
    function run(min) {
      cancelAnimationFrame(raf);
      box.classList.remove('is-done');
      ballots.forEach(function (b) { b.classList.remove('is-on'); });
      var total = min * 60, dur = reduceMotion ? 1 : 4200, t0 = performance.now();
      (function step(now) {
        var p = Math.min((now - t0) / dur, 1);
        ring.style.strokeDashoffset = (C * p).toFixed(2);
        time.textContent = fmt(total * (1 - p));
        if (p < 1) raf = requestAnimationFrame(step);
        else {
          box.classList.add('is-done');
          ballots.forEach(function (b, i) { setTimeout(function () { b.classList.add('is-on'); }, 350 + i * 320); });
        }
      })(t0);
    }
    $$('.timer__opts button', box).forEach(function (b) {
      b.addEventListener('click', function () {
        $$('.timer__opts button', box).forEach(function (x) { x.classList.toggle('is-on', x === b); });
        run(parseInt(b.getAttribute('data-min'), 10));
      });
    });
    time.textContent = fmt(60 * 60);
    if ('IntersectionObserver' in window) {
      var io = new IntersectionObserver(function (en) {
        if (en[0].isIntersecting && !started) { started = true; run(60); io.disconnect(); }
      }, { threshold: .5 });
      io.observe(box);
    }
  }

  // Escena del reloj (scroll)
  var night = { last: -1 };
  function initNightClock() {
    var scene = $('.js-night'); if (!scene) return;
    var NS = 'http://www.w3.org/2000/svg', ticks = $('.nc-ticks', scene), nums = $('.nc-nums', scene);
    for (var i = 0; i < 60; i++) {
      var a = i / 60 * Math.PI * 2, major = i % 5 === 0, r1 = major ? 80 : 85, l = doc.createElementNS(NS, 'line');
      l.setAttribute('x1', 110 + Math.sin(a) * r1); l.setAttribute('y1', 110 - Math.cos(a) * r1);
      l.setAttribute('x2', 110 + Math.sin(a) * 90); l.setAttribute('y2', 110 - Math.cos(a) * 90);
      if (major) l.setAttribute('class', 'is-major');
      ticks.appendChild(l);
    }
    var roman = ['XII', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI'];
    roman.forEach(function (r, i) {
      var a = i / 12 * Math.PI * 2, t = doc.createElementNS(NS, 'text');
      t.setAttribute('x', 110 + Math.sin(a) * 66); t.setAttribute('y', 110 - Math.cos(a) * 66);
      t.textContent = r; nums.appendChild(t);
    });
    night.scene = scene;
    night.faces = $$('.js-faces li', scene);
    // en cada carga: un superviviente al azar y un orden de caída al azar para los otros 11
    var idx = night.faces.map(function (_, i) { return i; });
    for (var k = idx.length - 1; k > 0; k--) { var r = Math.floor(Math.random() * (k + 1)), t = idx[k]; idx[k] = idx[r]; idx[r] = t; }
    night.heir = idx.pop();
    night.order = idx;
    night.hour = $('.nc-hour', scene); night.min = $('.nc-min', scene);
    night.time = $('.js-night-time', scene); night.alive = $('.js-alive', scene); night.hunt = $('.js-hunters', scene);
    renderNight(reduceMotion ? 1 : 0, true);
  }
  function renderNight(p, silent) {
    var h = p * 12, step = Math.min(Math.floor(h + 1e-6), 12), dead = Math.min(step, 11);
    night.hour.style.transform = 'rotate(' + ((7 + h) * 30) + 'deg)';
    night.min.style.transform = 'rotate(' + (h * 360) + 'deg)';
    if (step === night.last) return;
    var forward = step > night.last;
    night.time.textContent = (((19 + step) % 24) < 10 ? '0' : '') + ((19 + step) % 24) + ':00';
    night.alive.textContent = 12 - dead;
    night.hunt.textContent = dead;
    night.order.forEach(function (fi, i) {
      var li = night.faces[fi], wasDead = li.classList.contains('is-dead'), isDead = i < dead;
      li.classList.toggle('is-dead', isDead);
      if (isDead && !wasDead && !silent && forward) {
        li.classList.remove('is-fresh'); void li.offsetWidth; li.classList.add('is-fresh');
      }
    });
    night.scene.classList.toggle('is-dawn', step >= 12);
    night.faces[night.heir].classList.toggle('is-heir', step >= 11);
    if (!silent && forward && night.last >= 0 && Sound.on) Sound.bell(.3, step >= 12 ? 220 : 174.6);
    night.last = step;
  }

  // Gráfico de líneas: supervivientes vs cazadores
  function initCrossChart() {
    var host = $('.js-cross'); if (!host) return;
    var W = 760, H = 280, L = 34, R = 20, T = 16, B = 34, NS = 'http://www.w3.org/2000/svg';
    var x = function (i) { return L + i * (W - L - R) / 12; }, y = function (v) { return T + (12 - v) * (H - T - B) / 12; };
    var alive = [], hunt = [];
    for (var i = 0; i <= 12; i++) { alive.push(12 - Math.min(i, 11)); hunt.push(Math.min(i, 11)); }
    var hourLbl = function (i) { var hh = (19 + i) % 24; return (hh < 10 ? '0' : '') + hh + ':00'; };
    var svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" aria-hidden="true"><g class="xc-grid">';
    [0, 3, 6, 9, 12].forEach(function (v) { svg += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + y(v) + '" y2="' + y(v) + '"/>'; });
    svg += '</g><g class="xc-axis">';
    [0, 6, 12].forEach(function (v) { svg += '<text x="' + (L - 10) + '" y="' + (y(v) + 4) + '" text-anchor="end">' + v + '</text>'; });
    for (i = 0; i <= 12; i += 2) svg += '<text x="' + x(i) + '" y="' + (H - 10) + '" text-anchor="middle">' + hourLbl(i) + '</text>';
    svg += '</g>';
    var path = function (arr) { return arr.map(function (v, i) { return (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(v).toFixed(1); }).join(' '); };
    svg += '<circle class="xc-cross" cx="' + x(6) + '" cy="' + y(6) + '" r="16"/>';
    svg += '<path class="xc-line xc-line--alive" d="' + path(alive) + '"/>';
    svg += '<path class="xc-line xc-line--hunt" d="' + path(hunt) + '"/>';
    svg += '<line class="xc-hair" x1="0" x2="0" y1="' + T + '" y2="' + (H - B) + '" style="opacity:0"/>';
    svg += '<circle class="xc-dot xc-dot--a" r="5" fill="#efe6d8" style="opacity:0"/><circle class="xc-dot xc-dot--h" r="5" fill="#ff4444" style="opacity:0"/>';
    svg += '<text class="xc-label" x="' + (x(12) - 4) + '" y="' + (y(1) + 18) + '" text-anchor="end" fill="#efe6d8">1</text>';
    svg += '<text class="xc-label" x="' + (x(12) - 4) + '" y="' + (y(11) - 10) + '" text-anchor="end" fill="#ff4444">11</text>';
    for (i = 0; i <= 12; i++) svg += '<rect class="xc-hit" data-i="' + i + '" x="' + (x(i) - (W - L - R) / 24) + '" y="0" width="' + ((W - L - R) / 12) + '" height="' + H + '"/>';
    svg += '</svg><div class="tip" role="status"></div>';
    host.innerHTML = svg;
    var s = $('svg', host), tip = $('.tip', host), hair = $('.xc-hair', host), da = $('.xc-dot--a', host), dh = $('.xc-dot--h', host);
    function show(i) {
      var px = x(i);
      hair.setAttribute('x1', px); hair.setAttribute('x2', px); hair.style.opacity = 1;
      da.setAttribute('cx', px); da.setAttribute('cy', y(alive[i])); da.style.opacity = 1;
      dh.setAttribute('cx', px); dh.setAttribute('cy', y(hunt[i])); dh.style.opacity = 1;
      var dict = (lang !== 'es' && window.SG_I18N && window.SG_I18N[lang]) || {};
      var la = dict['night.alive2'] || I18N.orig['night.alive2'] || 'Con vida', lh = dict['night.hunters2'] || I18N.orig['night.hunters2'] || 'Cazadores';
      tip.innerHTML = '<b>' + hourLbl(i) + '</b><br>' + la + ': <b>' + alive[i] + '</b><br>' + lh + ': <b>' + hunt[i] + '</b>';
      var r = s.getBoundingClientRect();
      tip.style.left = (px / W * r.width) + 'px';
      tip.style.top = (y(Math.max(alive[i], hunt[i])) / H * r.height) + 'px';
      tip.classList.add('is-on');
    }
    function hide() { tip.classList.remove('is-on'); hair.style.opacity = 0; da.style.opacity = 0; dh.style.opacity = 0; }
    $$('.xc-hit', host).forEach(function (rect) {
      rect.addEventListener('mouseenter', function () { show(+rect.getAttribute('data-i')); });
      rect.addEventListener('touchstart', function () { show(+rect.getAttribute('data-i')); }, { passive: true });
    });
    s.addEventListener('mouseleave', hide);
  }

  // Espantos: boceto → render → peluche, en fundido automático y desfasado entre tarjetas
  function initHaunts() {
    $$('.js-haunt').forEach(function (box, n) {
      var imgs = $$('img', box), steps = $$('.haunt__steps li', box.parentNode), i = 0, timer = null, visible = false;
      if (imgs.length < 2 || reduceMotion) return;
      function show(k) {
        imgs.forEach(function (im, j) { im.classList.toggle('is-on', j === k); });
        steps.forEach(function (li, j) { li.classList.toggle('is-on', j === k); });
      }
      function start() { if (visible && !timer) timer = setInterval(function () { i = (i + 1) % imgs.length; show(i); }, 2600); }
      function stop() { clearInterval(timer); timer = null; }
      // arranca recién cuando la tarjeta entra en pantalla, con un pequeño desfase por posición
      new IntersectionObserver(function (entries) {
        entries.forEach(function (e) { visible = e.isIntersecting; if (visible) setTimeout(start, n * 650); else stop(); });
      }, { threshold: .25 }).observe(box);
    });
  }

  // Hall of Fame: cada tanto, algo aparece unos segundos dentro del marco del heredero
  function initHeirScare() {
    var frame = $('.js-heir-frame'); if (!frame || reduceMotion) return; // sin destellos si se pidió reducir movimiento
    var ghost = $('.heir-frame__ghost', frame), visible = false, timer = null;
    ghost.addEventListener('animationend', function () { frame.classList.remove('is-scare'); });
    function rnd(a, b) { return a + Math.random() * (b - a); }
    function scare() {
      timer = null;
      if (!visible || doc.hidden) return;
      if (ghost.classList.contains('is-loaded')) {
        frame.classList.remove('is-scare'); void frame.offsetWidth;
        frame.classList.add('is-scare'); // se quita al terminar la animación (animationend), así nunca se corta el fundido de salida
      }
      timer = setTimeout(scare, rnd(10000, 18000)); // el susto dura ~6 s con la vuelta del "?"
    }
    new IntersectionObserver(function (e) {
      visible = e[0].isIntersecting;
      // el primer susto llega poco después de que el cuadro entra en pantalla
      if (visible && !timer) timer = setTimeout(scare, rnd(2500, 5000));
      if (!visible && timer) { clearTimeout(timer); timer = null; }
    }, { threshold: .5 }).observe(frame);
  }

  // Ediciones: la marca roja avanza I → II → … → ∞ y vuelve a empezar, solo mientras se ve
  function initEditions() {
    $$('.js-editions').forEach(function (ol) {
      var li = $$('li', ol), i = 0, timer = null;
      if (li.length < 2 || reduceMotion) return;
      function step() {
        i = (i + 1) % li.length;
        li.forEach(function (el, j) { el.classList.toggle('is-on', j === i); });
      }
      new IntersectionObserver(function (entries) {
        entries.forEach(function (e) {
          if (e.isIntersecting && !timer) timer = setInterval(step, 1100);
          else if (!e.isIntersecting) { clearInterval(timer); timer = null; }
        });
      }, { threshold: .4 }).observe(ol);
    });
  }

  // Stream: el selector de señales salta solo entre la principal y las cámaras
  function initFeeds() {
    $$('.js-feeds').forEach(function (box) {
      var b = $$('b', box), i = 0;
      // cada etiqueta tiene su imagen de cámara; al cambiar de señal hay un corte con estática
      var screen = box.closest('.js-cams'), cams = screen ? $$('.player__cams i', screen) : [], shot = {};
      if (b.length < 2 || reduceMotion) return;
      setInterval(function () {
        if (doc.hidden) return;
        i = (i + 1) % b.length;
        b.forEach(function (el, j) { el.classList.toggle('is-on', j === i); });
        var takes = cams.filter(function (el) { return +el.getAttribute('data-feed') === i; });
        if (!takes.length) return;
        var on = takes[(shot[i] = ((shot[i] === undefined ? -1 : shot[i]) + 1) % takes.length)];
        cams.forEach(function (el) { el.classList.toggle('is-on', el === on); });
        screen.classList.remove('is-cut'); void screen.offsetWidth;
        screen.classList.add('is-cut');
      }, 3200);
    });
  }

  // Salud física y mental: simulación de dos barras independientes.
  // La física cae a golpes (impactos); la mental se escurre de a poco en la oscuridad.
  function initHealth() {
    var box = $('.hpbars'); if (!box) return;
    var bars = { body: $('.hpbar--body', box), mind: $('.hpbar--mind', box) };
    var v = { body: 100, mind: 100 }, timer = null, tick = 0;
    function draw(k, hit) {
      var el = bars[k];
      $('.hpbar__track i', el).style.setProperty('--v', v[k] + '%');
      $('b', $('p', el)).textContent = Math.round(v[k]);
      el.classList.toggle('is-low', v[k] < 30);
      if (hit) { el.classList.remove('is-hit'); void el.offsetWidth; el.classList.add('is-hit'); }
    }
    function step() {
      tick++;
      // mental: baja un poco casi siempre, con algún respiro
      v.mind = Math.max(4, v.mind - (Math.random() < .8 ? 3 + Math.random() * 5 : -6));
      // física: cada tanto, un impacto seco
      var hit = Math.random() < .22;
      if (hit) v.body = Math.max(6, v.body - (18 + Math.random() * 16));
      draw('mind'); draw('body', hit);
      // cuando una de las dos colapsa, se reinicia la ronda
      if (v.mind <= 4 || v.body <= 6 || tick > 26) {
        clearInterval(timer); timer = null;
        setTimeout(function () { v.body = 100; v.mind = 100; tick = 0; draw('body'); draw('mind'); start(); }, 2200);
      }
    }
    function start() { if (!timer) timer = setInterval(step, 1100); }
    function stop() { clearInterval(timer); timer = null; }
    if (reduceMotion) { v.body = 82; v.mind = 34; draw('body'); draw('mind'); return; }
    draw('body'); draw('mind');
    new IntersectionObserver(function (entries) {
      entries.forEach(function (e) { if (e.isIntersecting) start(); else stop(); });
    }, { threshold: .3 }).observe(box);
  }

  // Loop de juego: nodos alrededor del círculo, se iluminan al pasar el punto
  function initLoop() {
    var nodes = $$('.js-loop li'); if (!nodes.length) return;
    var n = nodes.length;
    nodes.forEach(function (li, i) {
      var a = i / n * Math.PI * 2;
      li.style.left = (50 + Math.sin(a) * 37.5) + '%';
      li.style.top = (50 - Math.cos(a) * 37.5) + '%';
    });
    if (reduceMotion) { nodes.forEach(function (li) { li.classList.add('is-lit'); }); return; }
    var period = 14000, t0 = performance.now();
    (function tick(now) {
      var p = ((now - t0) % period) / period, lit = Math.round(p * n) % n;
      nodes.forEach(function (li, i) { li.classList.toggle('is-lit', i === lit); });
      requestAnimationFrame(tick);
    })(t0);
  }

  // Onda de voz
  function initWave() {
    var w = $('.js-wave'); if (!w) return;
    var n = window.innerWidth < 600 ? 34 : 56, html = '';
    for (var i = 0; i < n; i++) {
      var c = 1 - Math.abs(i - n / 2) / (n / 2), h = (.15 + c * .85 * (.4 + Math.random() * .6)).toFixed(2);
      html += '<i style="--h:' + h + ';--d:' + (.5 + Math.random() * .9).toFixed(2) + 's;--dl:-' + (Math.random() * 1.5).toFixed(2) + 's"></i>';
    }
    w.innerHTML = html;
  }

  // Encuesta en vivo ilustrativa
  function initPoll() {
    var poll = $('.js-poll'); if (!poll) return;
    var items = $$('li', poll), vals = [42, 35, 23], timer = null;
    var player = poll.closest('.player') || poll;
    var viewersEl = $('.js-viewers'), viewers = 112418;
    var chat = $('.js-chat');
    function draw() {
      var sum = vals.reduce(function (a, b) { return a + b; }, 0), lead = vals.indexOf(Math.max.apply(null, vals));
      items.forEach(function (li, i) {
        var pct = Math.round(vals[i] / sum * 100);
        li.style.setProperty('--p', pct + '%');
        $('b', li).textContent = pct + '%';
        li.classList.toggle('is-lead', i === lead);
      });
    }
    function fmtNum(n) { return n.toLocaleString(lang === 'es' ? 'es-AR' : 'en-US'); }
    function step() {
      vals = vals.map(function (v) { return Math.max(6, v + (Math.random() * 10 - 5)); });
      draw();
      if (viewersEl) { viewers += Math.round(Math.random() * 420 - 60); viewersEl.textContent = fmtNum(viewers); }
      // el chat avanza: el mensaje más viejo pasa al final como si fuera nuevo
      if (chat) {
        var first = chat.firstElementChild;
        chat.appendChild(first);
        first.classList.remove('is-new'); void first.offsetWidth; first.classList.add('is-new');
      }
    }
    draw();
    if (viewersEl) viewersEl.textContent = fmtNum(viewers);
    if (reduceMotion || !('IntersectionObserver' in window)) return;
    new IntersectionObserver(function (en) {
      if (en[0].isIntersecting) { if (!timer) timer = setInterval(step, 1700); }
      else { clearInterval(timer); timer = null; }
    }).observe(player);
  }

  // Role Masters: contador de tiempo de la cámara de vigilancia
  function initTimecode() {
    var tc = $('.js-timecode'); if (!tc) return;
    var sec = 3 * 3600 + 12 * 60 + 44, timer = null;
    function pad(n) { return (n < 10 ? '0' : '') + n; }
    function tick() { sec++; tc.textContent = pad(Math.floor(sec / 3600)) + ':' + pad(Math.floor(sec % 3600 / 60)) + ':' + pad(sec % 60); }
    if (reduceMotion || !('IntersectionObserver' in window)) return;
    new IntersectionObserver(function (en) {
      if (en[0].isIntersecting) { if (!timer) timer = setInterval(tick, 1000); }
      else { clearInterval(timer); timer = null; }
    }).observe(tc.closest('.backstage') || tc);
  }

  // Videos de YouTube: se cargan solo al hacer clic
  function initVideos() {
    $$('.yt').forEach(function (b) {
      b.addEventListener('click', function () {
        var f = doc.createElement('iframe');
        f.src = 'https://www.youtube-nocookie.com/embed/' + b.getAttribute('data-yt') + '?autoplay=1&rel=0&modestbranding=1';
        f.title = b.getAttribute('aria-label') || 'YouTube';
        f.allow = 'accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture; fullscreen';
        f.allowFullscreen = true;
        f.referrerPolicy = 'strict-origin-when-cross-origin';
        b.parentNode.replaceChild(f, b);
        if (Sound.on) Sound.toggle();
      });
    });
  }

  // Barras de mercado
  function initBars() {
    $$('.bars').forEach(function (ul) {
      var max = parseFloat(ul.getAttribute('data-max'));
      $$('li', ul).forEach(function (li) {
        li.tabIndex = 0;
        li.__w = (parseFloat(li.getAttribute('data-v')) / max * 100) + '%';
        if (reduceMotion || !window.gsap) $('.bars__t i', li).style.setProperty('--w', li.__w);
      });
    });
  }

  // Contadores
  function countUp(el) {
    var target = parseFloat(el.getAttribute('data-count')), dec = parseInt(el.getAttribute('data-dec') || '0', 10);
    var fmt = function (v) { var s = v.toFixed(dec); return lang === 'es' ? s.replace('.', ',') : s; };
    if (!window.gsap || reduceMotion) { el.textContent = fmt(target); return; }
    var o = { v: 0 };
    window.gsap.to(o, { v: target, duration: 1.8, ease: 'power2.out', onUpdate: function () { el.textContent = fmt(o.v); } });
  }

  /* ------------------------------------------------------------------------
     Animaciones de scroll (GSAP + ScrollTrigger)
     ------------------------------------------------------------------------ */
  function initMotion() {
    var gsap = window.gsap, ST = window.ScrollTrigger;
    var counters = $$('[data-count]');

    if (!gsap || !ST || reduceMotion) {
      counters.forEach(countUp);
      $$('.bars li').forEach(function (li) { $('.bars__t i', li).style.setProperty('--w', li.__w); });
      $$('.js-launch, .js-roadmap').forEach(function (el) { el.style.setProperty('--p', 1); });
      $$('.hero__title .ln--big').forEach(function (el) { el.classList.add('is-flicker'); });
      return;
    }
    gsap.registerPlugin(ST);

    // Hero: entrada
    var tl = gsap.timeline({ delay: .35 });
    tl.from('.hero__bg', { scale: 1.12, opacity: 0, duration: 2.6, ease: 'power2.out' }, 0)
      .from('.hero__kicker .ln', { y: 20, opacity: 0, duration: 1, ease: 'power3.out' }, .5)
      .from('.hero__title .ln', { yPercent: 40, opacity: 0, duration: 1.4, stagger: .14, ease: 'expo.out' }, .7)
      .from('.hero__sub .ln', { opacity: 0, letterSpacing: '.4em', duration: 1.6, ease: 'power3.out' }, 1.3)
      .from('.hero__tag .ln, .hero__genre .ln', { y: 16, opacity: 0, duration: 1, stagger: .15, ease: 'power3.out' }, 1.7)
      .from('.hero__cue, .frame', { opacity: 0, duration: 1.4 }, 2)
      .add(function () { $$('.hero__title .ln--big').forEach(function (el) { el.classList.add('is-flicker'); }); });

    // Hero: parallax al hacer scroll
    // solo desplazamiento vertical: sin escala, para no "saltar" al empezar a scrollear
    gsap.to('.hero__bg', { yPercent: 14, ease: 'none', scrollTrigger: { trigger: '.hero', start: 'top top', end: 'bottom top', scrub: true } });
    gsap.to('.hero__inner', { yPercent: -18, opacity: 0, ease: 'none', scrollTrigger: { trigger: '.hero', start: 'top top', end: 'bottom 20%', scrub: true } });

    // Revelados genéricos
    gsap.set('.rv', { opacity: 0, y: 30 });
    ST.batch('.rv', {
      start: 'top 88%', once: true,
      onEnter: function (b) { gsap.to(b, { opacity: 1, y: 0, duration: 1.1, stagger: .09, ease: 'power3.out', overwrite: true }); }
    });

    // Números de hora gigantes y fondos con parallax
    $$('.hourmark').forEach(function (el) {
      gsap.fromTo(el, { yPercent: 30 }, { yPercent: -30, ease: 'none', scrollTrigger: { trigger: el.parentNode, start: 'top bottom', end: 'bottom top', scrub: true } });
    });
    $$('.chapter__bg').forEach(function (el) {
      gsap.fromTo(el, { yPercent: -6 }, { yPercent: 6, ease: 'none', scrollTrigger: { trigger: el.parentNode, start: 'top bottom', end: 'bottom top', scrub: true } });
    });
    // El ritual anual: la franja de calabazas con parallax
    // arranca mostrando la parte de arriba de la imagen y, al bajar, la recorre hasta las calabazas
    $$('.ritual-strip__img').forEach(function (el) {
      var strip = el.parentNode;
      gsap.fromTo(el, { y: 0 }, {
        y: function () { return -Math.max(0, el.offsetHeight - strip.offsetHeight); },
        ease: 'none', immediateRender: true,
        scrollTrigger: { trigger: strip, start: 'top bottom', end: 'bottom top', scrub: true, invalidateOnRefresh: true }
      });
    });
    // Portadas de modo: la imagen se acerca lentamente al bajar
    $$('.cover__bg').forEach(function (el) {
      gsap.fromTo(el, { scale: 1 }, { scale: 1.12, ease: 'none', scrollTrigger: { trigger: el.parentNode, start: 'top top', end: 'bottom top', scrub: true } });
    });


    // Contadores
    counters.forEach(function (el) { ST.create({ trigger: el, start: 'top 90%', once: true, onEnter: function () { countUp(el); } }); });

    // Barras de mercado
    $$('.bars').forEach(function (ul) {
      ST.create({ trigger: ul, start: 'top 85%', once: true, onEnter: function () {
        $$('li', ul).forEach(function (li, i) { setTimeout(function () { $('.bars__t i', li).style.setProperty('--w', li.__w); }, i * 200); });
      } });
    });

    // Gráfico cruzado: dibujar líneas
    $$('.xc-line').forEach(function (p) {
      var len = p.getTotalLength();
      gsap.fromTo(p, { strokeDasharray: len, strokeDashoffset: len }, { strokeDashoffset: 0, ease: 'none', scrollTrigger: { trigger: '.js-cross', start: 'top 85%', end: 'bottom 55%', scrub: 1 } });
    });

    // Líneas de lanzamiento y roadmap
    $$('.js-launch, .js-roadmap').forEach(function (el) {
      ST.create({ trigger: el, start: 'top 80%', end: 'bottom 60%', scrub: true, onUpdate: function (s) { el.style.setProperty('--p', s.progress.toFixed(3)); } });
    });

    // Escena del reloj: se fija y el scroll avanza la noche
    if (night.scene) {
      ST.create({
        trigger: night.scene, start: 'top top', end: function () { return '+=' + Math.round(window.innerHeight * 2.6); },
        pin: true, scrub: true, anticipatePin: 1, refreshPriority: 1, // el pin se calcula antes que lo que viene debajo
        onUpdate: function (s) { renderNight(s.progress); }
      });
    }

    // Final
    gsap.from('.finale__a', { scale: .92, scrollTrigger: { trigger: '.finale', start: 'top 85%', end: 'top 40%', scrub: 1 } });

    // ordenar los triggers según su posición en la página para que los que están después del reloj fijado
    // tengan en cuenta el espacio que agrega el pin, y recalcular
    ST.sort();
    ST.refresh();
    // las tipografías cambian alturas: recalcular cuando terminen de cargar
    if (doc.fonts && doc.fonts.ready) doc.fonts.ready.then(function () { ST.refresh(); });
  }

  /* ------------------------------------------------------------------------
     Inicio del sitio tras desbloquear
     ------------------------------------------------------------------------ */
  function initSite() {
    applyLang(lang);
    doc.body.classList.add('is-ready');
    Assets.observe();
    buildNav();
    initTimer();
    initNightClock();
    initCrossChart();
    initLoop();
    initHaunts();
    initFeeds();
    initEditions();
    initHeirScare();
    initHealth();
    initWave();
    initPoll();
    initTimecode();
    initVideos();
    initBars();
    initMotion();
    $$('.sound-btn').forEach(function (b) { b.addEventListener('click', function () { Sound.toggle(); }); });
    var ticking = false;
    window.addEventListener('scroll', function () {
      if (ticking) return; ticking = true;
      requestAnimationFrame(function () { updateNav(); ticking = false; });
    }, { passive: true });
    window.addEventListener('resize', updateNav);
    if (location.hash && location.hash.length > 1) {
      var target = doc.getElementById(location.hash.slice(1));
      if (target) setTimeout(function () { target.scrollIntoView(); }, 60);
    }
    // si no hay movimiento: dejar el reloj en el amanecer
    if (reduceMotion || !window.gsap) renderNight(1, true);
  }

  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', boot); else boot();
})();
