/*!
 * dms-tracker.js v1
 * Lead tracking script para o site Dana (Magazord)
 * — Cookie first-party `dms_visitor_id` (12 meses)
 * — Pageview no load + on history change (SPA)
 * — Captura UTM da URL automaticamente
 * — `navigator.sendBeacon` quando possível, fetch keepalive como fallback
 * — Sem dependências externas
 *
 * Uso no Magazord (uma única tag no <head>):
 *   <script async src="https://danamarketing.vercel.app/dms-tracker.js"></script>
 *
 * Pra capturar conversões, o checkout pode chamar globalmente:
 *   window.DMSTracker.identify({ contato_nome, email, empresa })
 *   window.DMSTracker.event('purchase', { valor_pedido, pedido_id })
 *
 * LGPD: cookie first-party (mesmo domínio) + IP mascarado server-side.
 */
(function () {
  'use strict';
  if (window.DMSTracker) return; // idempotente

  var INGEST = 'https://wltmiqbhziefusnzmmkt.supabase.co/functions/v1/dms-tracker-ingest';
  var COOKIE_NAME = 'dms_visitor_id';
  var COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // 12 meses

  // ───────────── Cookie helpers ─────────────
  function getCookie(name) {
    var match = document.cookie.match('(^|;)\\s*' + name + '\\s*=\\s*([^;]+)');
    return match ? decodeURIComponent(match[2]) : null;
  }
  function setCookie(name, value) {
    try {
      var attrs = '; path=/; max-age=' + COOKIE_MAX_AGE + '; SameSite=Lax';
      if (location.protocol === 'https:') attrs += '; Secure';
      document.cookie = name + '=' + encodeURIComponent(value) + attrs;
    } catch (e) {}
  }

  // ───────────── UUID v4 ─────────────
  function uuid() {
    if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0;
      var v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  // Visitor ID persistente
  var visitorId = getCookie(COOKIE_NAME);
  if (!visitorId || !/^[0-9a-f-]{36}$/i.test(visitorId)) {
    visitorId = uuid();
    setCookie(COOKIE_NAME, visitorId);
  }

  // ───────────── Detect device/browser/os (leve) ─────────────
  var ua = navigator.userAgent || '';
  var device = /Mobi|Android|iPhone|iPad|iPod|Opera Mini|IEMobile/i.test(ua)
    ? (/iPad|Tablet/i.test(ua) ? 'tablet' : 'mobile')
    : 'desktop';
  var browser = (function () {
    if (/Edg\//.test(ua)) return 'edge';
    if (/Chrome\//.test(ua)) return 'chrome';
    if (/Firefox\//.test(ua)) return 'firefox';
    if (/Safari\//.test(ua)) return 'safari';
    if (/MSIE|Trident/.test(ua)) return 'ie';
    return 'other';
  })();
  var os = (function () {
    if (/Windows NT/.test(ua)) return 'windows';
    if (/Mac OS X|Macintosh/.test(ua)) return 'macos';
    if (/Android/.test(ua)) return 'android';
    if (/iPhone|iPad|iPod/.test(ua)) return 'ios';
    if (/Linux/.test(ua)) return 'linux';
    return 'other';
  })();

  // ───────────── Captura de UTM (URL atual + sessão) ─────────────
  var SESSION_KEY = 'dms_first_attribution';
  function captureUtm() {
    var p = new URLSearchParams(location.search);
    var keys = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'];
    var out = {};
    var any = false;
    for (var i = 0; i < keys.length; i++) {
      var v = p.get(keys[i]);
      if (v) { out[keys[i]] = v.slice(0, 200); any = true; }
    }
    // Persiste primeiro toque da sessão (last-touch fica no ping de cada evento, first-touch via sessionStorage)
    if (any) {
      try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(out)); } catch (e) {}
    } else {
      try {
        var saved = sessionStorage.getItem(SESSION_KEY);
        if (saved) out = JSON.parse(saved) || {};
      } catch (e) {}
    }
    return out;
  }

  // Identidade resolvida (setada via DMSTracker.identify)
  var identity = {};
  function setIdentity(payload) {
    payload = payload || {};
    if (payload.contato_nome) identity.contato_nome = String(payload.contato_nome).slice(0, 200);
    if (payload.empresa) identity.empresa = String(payload.empresa).slice(0, 20);
    // email → SHA256 hex (LGPD friendly). Só hash, não envia plaintext.
    if (payload.email) {
      sha256Hex(String(payload.email).toLowerCase().trim()).then(function (h) {
        identity.email_hash = h;
      });
    }
  }

  // SHA256 hex via Web Crypto
  async function sha256Hex(s) {
    if (!window.crypto || !window.crypto.subtle) return null;
    try {
      var buf = new TextEncoder().encode(s);
      var hash = await window.crypto.subtle.digest('SHA-256', buf);
      return Array.from(new Uint8Array(hash)).map(function (b) { return b.toString(16).padStart(2, '0'); }).join('');
    } catch (e) { return null; }
  }

  // ───────────── Send event ─────────────
  function send(eventoTipo, extra) {
    extra = extra || {};
    var utm = captureUtm();
    var payload = {
      cookie_id: visitorId,
      evento_tipo: eventoTipo,
      url: location.href.slice(0, 2000),
      url_path: location.pathname.slice(0, 250),
      referrer: (document.referrer || '').slice(0, 2000),
      utm_source: utm.utm_source || null,
      utm_medium: utm.utm_medium || null,
      utm_campaign: utm.utm_campaign || null,
      utm_content: utm.utm_content || null,
      utm_term: utm.utm_term || null,
      device: device,
      browser: browser,
      os: os,
      contato_nome: identity.contato_nome || null,
      email_hash: identity.email_hash || null,
      empresa: identity.empresa || null,
      metadata: extra.metadata || null,
    };
    var body = JSON.stringify(payload);
    var headers = { 'Content-Type': 'application/json', 'X-Tracker-Version': '1' };
    try {
      // sendBeacon não aceita Content-Type custom — só cabe se for application/json + Blob
      if (navigator.sendBeacon) {
        var blob = new Blob([body], { type: 'application/json' });
        var ok = navigator.sendBeacon(INGEST, blob);
        if (ok) return;
      }
    } catch (e) {}
    // Fallback fetch keepalive
    try {
      fetch(INGEST, { method: 'POST', headers: headers, body: body, keepalive: true, mode: 'cors' })
        .catch(function () {});
    } catch (e) {}
  }

  // ───────────── SPA pageview (Magazord usa MPA mas se for SPA captura history) ─────────────
  var lastPath = location.pathname + location.search;
  function maybePageview() {
    var path = location.pathname + location.search;
    if (path !== lastPath) {
      lastPath = path;
      send('pageview');
    }
  }
  // Patch history para SPAs
  ['pushState', 'replaceState'].forEach(function (m) {
    var orig = history[m];
    history[m] = function () {
      var ret = orig.apply(this, arguments);
      setTimeout(maybePageview, 0);
      return ret;
    };
  });
  window.addEventListener('popstate', maybePageview);

  // ───────────── API pública ─────────────
  window.DMSTracker = {
    visitorId: visitorId,
    event: function (tipo, metadata) { send(tipo, { metadata: metadata }); },
    identify: setIdentity,
    pageview: function () { send('pageview'); },
  };

  // Pageview inicial (depois de tudo configurado)
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { send('pageview'); });
  } else {
    send('pageview');
  }
})();
