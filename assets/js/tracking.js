/**
 * tracking.js — Meta Pixel + TikTok Pixel + Google Analytics 4 + UTM attribution
 *
 * - يحمّل أي بكسل فقط إذا حطيت الـ ID مالته في config.js
 * - يحفظ مصدر الزيارة (utm_source / utm_campaign / fbclid / ttclid) ويضيفه لكل طلب
 * - يوفر window.Track.event(name, data) لباقي الكود
 *
 * الأحداث المرسلة:
 *   Lead      ← إرسال نموذج الاستشارة   (Meta: Lead | TikTok: SubmitForm | GA4: generate_lead)
 *   Contact   ← الضغط على أي رابط واتساب  (Meta: Contact | TikTok: Contact | GA4: contact)
 *   SelectPlan← اختيار باقة               (Meta: custom | TikTok: ClickButton | GA4: select_item)
 *   UseCalculator ← استخدام حاسبة العائد (مرة وحدة بالجلسة)
 */
(function () {
  "use strict";
  const CFG = window.SITE_CONFIG || {};
  const T = CFG.tracking || {};

  /* ---------- UTM / مصدر الزيارة ---------- */
  const ATTR_KEY = "lead_attribution";
  const KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "fbclid", "ttclid", "gclid"];

  function readAttribution() {
    try { return JSON.parse(sessionStorage.getItem(ATTR_KEY)) || null; } catch (_) { return null; }
  }
  function captureAttribution() {
    const q = new URLSearchParams(location.search);
    const found = {};
    KEYS.forEach((k) => { const v = q.get(k); if (v) found[k] = v.slice(0, 120); });
    if (!found.utm_source) {
      if (found.fbclid) found.utm_source = "facebook/instagram";
      else if (found.ttclid) found.utm_source = "tiktok";
      else if (found.gclid) found.utm_source = "google";
    }
    // first touch بالجلسة: ما نكتب فوق المصدر الأول
    if (Object.keys(found).length && !readAttribution()) {
      found.landing = location.pathname;
      found.referrer = document.referrer ? new URL(document.referrer).hostname : "";
      try { sessionStorage.setItem(ATTR_KEY, JSON.stringify(found)); } catch (_) {}
    }
  }
  captureAttribution();

  /* ---------- تحميل السكربتات ---------- */
  function loadScript(src) {
    const s = document.createElement("script");
    s.async = true; s.src = src;
    document.head.appendChild(s);
  }

  // Meta Pixel
  if (T.metaPixelId) {
    !function (f, n) {
      if (f.fbq) return;
      n = f.fbq = function () { n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments); };
      if (!f._fbq) f._fbq = n;
      n.push = n; n.loaded = true; n.version = "2.0"; n.queue = [];
    }(window);
    loadScript("https://connect.facebook.net/en_US/fbevents.js");
    window.fbq("init", T.metaPixelId);
    window.fbq("track", "PageView");
  }

  // TikTok Pixel
  if (T.tiktokPixelId) {
    const ttq = (window.ttq = window.ttq || []);
    ttq.methods = ["page", "track", "identify", "instances", "debug", "on", "off", "once", "ready", "alias", "group", "enableCookie", "disableCookie"];
    ttq.setAndDefer = function (t, e) { t[e] = function () { t.push([e].concat(Array.prototype.slice.call(arguments, 0))); }; };
    ttq.methods.forEach((m) => ttq.setAndDefer(ttq, m));
    ttq.instance = function (t) { const e = ttq._i[t] || []; ttq.methods.forEach((m) => ttq.setAndDefer(e, m)); return e; };
    const id = T.tiktokPixelId, base = "https://analytics.tiktok.com/i18n/pixel/events.js";
    ttq._i = ttq._i || {}; ttq._i[id] = []; ttq._i[id]._u = base;
    ttq._t = ttq._t || {}; ttq._t[id] = +new Date();
    ttq._o = ttq._o || {}; ttq._o[id] = {};
    loadScript(base + "?sdkid=" + encodeURIComponent(id) + "&lib=ttq");
    ttq.page();
  }

  // Google Analytics 4
  if (T.ga4Id) {
    window.dataLayer = window.dataLayer || [];
    window.gtag = function () { window.dataLayer.push(arguments); };
    window.gtag("js", new Date());
    window.gtag("config", T.ga4Id);
    loadScript("https://www.googletagmanager.com/gtag/js?id=" + encodeURIComponent(T.ga4Id));
  }

  /* ---------- إرسال الأحداث ---------- */
  const MAP = {
    Lead:          { meta: ["track", "Lead"],                 tt: "SubmitForm",  ga: "generate_lead" },
    Contact:       { meta: ["track", "Contact"],              tt: "Contact",     ga: "contact" },
    SelectPlan:    { meta: ["trackCustom", "SelectPlan"],     tt: "ClickButton", ga: "select_item" },
    UseCalculator: { meta: ["trackCustom", "UseCalculator"],  tt: "ClickButton", ga: "use_calculator" },
  };

  function event(name, data) {
    const m = MAP[name];
    if (!m) return;
    const payload = Object.assign({}, data || {});
    try { if (window.fbq) window.fbq(m.meta[0], m.meta[1], payload); } catch (_) {}
    try { if (window.ttq && window.ttq.track) window.ttq.track(m.tt, payload); } catch (_) {}
    try { if (window.gtag) window.gtag("event", m.ga, payload); } catch (_) {}
    if (T.debug) console.info("[Track]", name, payload);
  }

  // تتبع تلقائي لكل روابط الواتساب (زر عائم، بطاقات التواصل، الفوتر)
  document.addEventListener("click", (e) => {
    const a = e.target.closest && e.target.closest('a[href*="wa.me"]');
    if (a) event("Contact", { method: "whatsapp", location: a.className || "link" });
  });

  window.Track = { event, attribution: readAttribution };
})();
