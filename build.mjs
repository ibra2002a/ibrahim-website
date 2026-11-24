#!/usr/bin/env node
/**
 * build.mjs — مولّد موقع ثابت بدون أي مكتبات (Node 18+)
 *
 *   node build.mjs              ← بناء الإنتاج إلى dist/ (مضغوط)
 *   node build.mjs --drafts     ← يُظهر كل المسودات (مقالات وخدمات draft: true)
 *   node build.mjs --preview    ← روابط بصيغة index.html (للمعاينة بدون سيرفر)
 *   node build.mjs --no-minify  ← بدون ضغط الملفات (للتطوير)
 *
 * المصادر:
 *   src/layouts/  القالب العام        src/partials/  الهيدر، الفوتر، الأيقونات (i-*.html)
 *   src/pages/    الصفحة الرئيسية     src/i18n/      نصوص الواجهة لكل لغة
 *   content/      كل المحتوى القابل للتعديل من لوحة التحكم (JSON + Markdown)
 *   public/       ملفات تُنسخ كما هي (CSS, JS, صور, admin)
 *
 * الأماكن المؤقتة (Placeholders): العناصر اللي عليها placeholder: true بالأرقام ودراسات الحالة والآراء
 * تظهر بعلامة واضحة إذا كان showPlaceholders = true بالإعدادات، وتختفي إذا صار false.
 * المسودات (draft: true) ما تظهر أبدًا إلا مع --drafts. المساعد الذكي ما يتعلم من أي منهما.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(ROOT, "dist");
const args = new Set(process.argv.slice(2));
const PREVIEW = args.has("--preview");
const DRAFTS = args.has("--drafts") || PREVIEW;
const MINIFY = !args.has("--no-minify");

const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const readJSON = (p) => JSON.parse(read(p));
const CONFIG = readJSON("content/settings.json");
const SITE = CONFIG.siteUrl.replace(/\/$/, "");
const LANGS = CONFIG.languages;
const I18N = Object.fromEntries(LANGS.map((l) => [l, readJSON(`src/i18n/${l}.json`)]));
const SHOW_PH = DRAFTS || CONFIG.showPlaceholders !== false;
const SOCIAL = CONFIG.social || {};

/* ---------------- helpers ---------------- */
// يمنع حقن قوالب {{ }} من النصوص اللي يكتبها المستخدم
const esc = (s = "") =>
  String(s).replace(/[&<>"'{}]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;", "{": "&#123;", "}": "&#125;" })[c]);

// يعزل المبالغ مثل $X أو $500 داخل النص العربي حتى ما ينقلب ترتيب الرمز
const escLtr = (s = "") => esc(s).replace(/[$€£][0-9A-Za-z][0-9A-Za-z.,+\-]*/g, (m) => `<bdi dir="ltr">${m}</bdi>`);

function write(rel, data) {
  const file = path.join(OUT, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, data);
}

function copyDir(src, dest) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dest, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name), d = path.join(dest, e.name);
    e.isDirectory() ? copyDir(s, d) : fs.copyFileSync(s, d);
  }
}

/** مسار الصفحة لكل لغة: "" للعربي (الافتراضي)، "en/" للإنكليزي */
const langPrefix = (lang) => (lang === CONFIG.defaultLang ? "" : `${lang}/`);

/** رابط نسبي من ملف صفحة إلى مجلد صفحة أخرى */
function link(fromFile, toDir) {
  const fromDir = path.posix.dirname(fromFile);
  const rel = path.posix.relative(fromDir === "." ? "" : fromDir, toDir.replace(/\/$/, ""));
  if (PREVIEW) return (rel ? rel + "/" : "") + "index.html";
  return rel ? rel + "/" : "./";
}
const rootOf = (fromFile) => "../".repeat(path.posix.dirname(fromFile).split("/").filter((p) => p && p !== ".").length);
const absUrl = (dir) => `${SITE}/${dir}`;

/* ---------------- templating ---------------- */
const PARTIALS = Object.fromEntries(
  fs.readdirSync(path.join(ROOT, "src/partials")).map((f) => [f.replace(/\.html$/, ""), read(`src/partials/${f}`)])
);
const icon = (name) => PARTIALS[`i-${name}`] || PARTIALS["i-spark"];
function render(tpl, ctx) {
  tpl = tpl.replace(/\{\{>\s*([\w-]+)\s*\}\}/g, (_, name) => PARTIALS[name] ?? "");
  return tpl.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key) => {
    const v = key.split(".").reduce((o, k) => (o == null ? undefined : o[k]), ctx);
    return v == null ? "" : String(v);
  });
}
const LAYOUT = read("src/layouts/base.html");

/* ---------------- المحتوى ---------------- */
const readContent = (f, fallback) => {
  const fp = path.join(ROOT, "content", f);
  return fs.existsSync(fp) ? JSON.parse(fs.readFileSync(fp, "utf8")) : fallback;
};
// placeholder: مثال توضيحي بشارة واضحة (يظهر إذا showPlaceholders مفعّل) · draft: مخفي إلا مع --drafts
const isPh = (x) => x.placeholder === true;
const visible = (x) => (isPh(x) ? SHOW_PH : DRAFTS || !x.draft);
const publishedCases = (lang) => readContent("case-studies.json", []).filter((c) => visible(c) && c[lang] && c[lang].client);
const publishedStats = (lang) => readContent("stats.json", []).filter((x) => visible(x) && x.value && x[lang]);
const publishedTestimonials = (lang) => readContent("testimonials.json", []).filter((x) => visible(x) && x[lang] && x[lang].quote);
const publishedServices = (lang) => readContent("services.json", []).filter((x) => (DRAFTS || !x.draft) && x[lang] && x.slug);
const allPlans = () => readContent("pricing.json", []);
const SVC_ICON = { "meta-ads": "target", "tiktok-ads": "note", "snapchat-ads": "phone", "ugc-ads": "video", "whatsapp-automation": "chat", "ad-account-audit": "audit",
  "web-app-development": "code", "cybersecurity": "shield" };
const svcIcon = (slug) => icon(SVC_ICON[slug] || "spark");
// group: "tech" ← خدمات تقنية (برمجة، أمن سيبراني) تظهر بقسم "حلول تقنية" بدل شريط المنصات
const isTech = (x) => x.group === "tech";

/* ---------------- قنوات التواصل ---------------- */
function channels(lang) {
  const t = I18N[lang];
  const wa = String(CONFIG.whatsapp || "");
  const local = wa.startsWith("964") ? "0" + wa.slice(3) : "+" + wa;
  const waShow = lang === "ar" ? local.replace(/^(\d{4})(\d{3})(\d+)$/, "$1 $2 $3") : "+" + wa.replace(/^(\d{3})(\d{3})(\d{3})(\d+)$/, "$1 $2 $3 $4");
  const handle = (u) => { try { const p = new URL(u).pathname.replace(/\/+$/, "").split("/").filter(Boolean); return p.length ? "@" + p[p.length - 1].replace(/^@/, "") : u; } catch { return u; } };
  const list = [];
  if (wa) list.push({ key: "whatsapp", label: t.channel_whatsapp, value: waShow, href: `https://wa.me/${wa}`, ic: "chat" });
  if (CONFIG.instagram) list.push({ key: "instagram", label: t.channel_instagram, value: handle(CONFIG.instagram), href: CONFIG.instagram, ic: "camera" });
  if (SOCIAL.facebook) list.push({ key: "facebook", label: t.channel_facebook, value: handle(SOCIAL.facebook), href: SOCIAL.facebook, ic: "users" });
  if (SOCIAL.tiktok) list.push({ key: "tiktok", label: t.channel_tiktok, value: handle(SOCIAL.tiktok), href: SOCIAL.tiktok, ic: "note" });
  if (SOCIAL.linkedin) list.push({ key: "linkedin", label: t.channel_linkedin, value: handle(SOCIAL.linkedin), href: SOCIAL.linkedin, ic: "briefcase" });
  if (SOCIAL.email) list.push({ key: "email", label: t.channel_email, value: SOCIAL.email, href: `mailto:${SOCIAL.email}`, ic: "mail" });
  return list;
}
const extAttrs = (href) => (/^https?:/.test(href) ? ' target="_blank" rel="noopener"' : "");
const channelsHTML = (lang) => channels(lang).map((c) => `
            <a class="channel" href="${esc(c.href)}"${extAttrs(c.href)}><span class="channel-ic">${icon(c.ic)}</span><span class="channel-txt"><small>${esc(c.label)}</small><b dir="ltr">${esc(c.value)}</b></span>${icon("arrow")}</a>`).join("");
const socialIconsHTML = (lang) => channels(lang).map((c) => `<a href="${esc(c.href)}"${extAttrs(c.href)} aria-label="${esc(c.label)}">${icon(c.ic)}</a>`).join("");

/* ---------------- الصفحة ---------------- */
function page({ file, lang, title, description, content, alternates = {}, jsonld = [], ogType = "website",
  robots = "index, follow", bodyClass = "", isHome = false, altUrlFile }) {
  const t = I18N[lang];
  const homeDir = langPrefix(lang);
  const otherLang = LANGS.find((l) => l !== lang);
  const home = isHome ? "" : link(file, homeDir);
  const altUrl = link(file, altUrlFile ?? langPrefix(otherLang));
  const langItem = (l) => (l === lang
    ? `<span class="is-active" aria-current="true" lang="${l}">${esc(I18N[l]["lang_" + l])}</span>`
    : `<a href="${altUrl}" hreflang="${l}" lang="${l}">${esc(I18N[lang]["lang_" + l])}</a>`);
  const ctx = {
    lang, dir: lang === "ar" ? "rtl" : "ltr", t, site_url: SITE,
    title: esc(title), description: esc(description), robots, og_type: ogType, body_class: bodyClass,
    canonical: absUrl(path.posix.dirname(file) === "." ? "" : path.posix.dirname(file) + "/"),
    root: rootOf(file), home, home_link: isHome ? "#top" : home,
    blog_url: link(file, `${homeDir}blog/`),
    work_href: `${home}${publishedCases(lang).length ? "#work" : "#services"}`,
    lang_switch: ["ar", "en"].filter((l) => LANGS.includes(l)).map(langItem).join('<span class="sep" aria-hidden="true">|</span>'),
    whatsapp: CONFIG.whatsapp, instagram: CONFIG.instagram,
    social_icons: socialIconsHTML(lang),
    footer_services: (() => {
      const items = publishedServices(lang);
      return items.length ? `<nav class="footer-svc" aria-label="${esc(t.footer_services)}"><p>${esc(t.footer_services)}</p>${items.map((x) => `<a href="${link(file, `${homeDir}services/${x.slug}/`)}">${esc(x[lang].title)}</a>`).join("")}</nav>` : "";
    })(),
    verify_meta: [
      CONFIG.seo && CONFIG.seo.googleVerification ? `  <meta name="google-site-verification" content="${esc(CONFIG.seo.googleVerification)}">` : "",
      CONFIG.seo && CONFIG.seo.bingVerification ? `  <meta name="msvalidate.01" content="${esc(CONFIG.seo.bingVerification)}">` : "",
    ].filter(Boolean).join("\n"),
    alternates: Object.entries(alternates)
      .map(([l, dir]) => `  <link rel="alternate" hreflang="${l}" href="${absUrl(dir)}">`)
      .concat(alternates[CONFIG.defaultLang] != null ? [`  <link rel="alternate" hreflang="x-default" href="${absUrl(alternates[CONFIG.defaultLang])}">`] : [])
      .join("\n"),
    jsonld: jsonld.map((j) => `  <script type="application/ld+json">${JSON.stringify(j).replace(/</g, "\\u003c")}</script>`).join("\n"),
  };
  ctx.content = render(content, ctx);
  write(file, render(LAYOUT, ctx));
}

/* ---------------- Markdown (مبسّط) ---------------- */
function inline(s) {
  return esc(s)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^\w])_([^_]+)_(?=[^\w]|$)/g, "$1<em>$2</em>")
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, txt, url) => {
      const safe = /^(https?:|\/|#|\.)/.test(url) ? url : "#";
      const ext = /^https?:/.test(safe) ? ' target="_blank" rel="noopener"' : "";
      return `<a href="${safe}"${ext}>${txt}</a>`;
    });
}
function markdown(src) {
  const lines = src.replace(/\r/g, "").split("\n");
  const out = []; let para = [], list = null;
  const flushP = () => { if (para.length) { out.push(`<p>${inline(para.join(" "))}</p>`); para = []; } };
  const flushL = () => { if (list) { out.push(`<${list.tag}>${list.items.map((i) => `<li>${inline(i)}</li>`).join("")}</${list.tag}>`); list = null; } };
  for (const raw of lines) {
    const line = raw.trimEnd();
    let m;
    if (!line.trim()) { flushP(); flushL(); continue; }
    if ((m = line.match(/^(#{2,4})\s+(.*)$/))) { flushP(); flushL(); const lv = m[1].length; out.push(`<h${lv}>${inline(m[2])}</h${lv}>`); continue; }
    if (/^---+$/.test(line)) { flushP(); flushL(); out.push("<hr>"); continue; }
    if ((m = line.match(/^>\s?(.*)$/))) { flushP(); flushL(); out.push(`<blockquote><p>${inline(m[1])}</p></blockquote>`); continue; }
    if ((m = line.match(/^[-*]\s+(.*)$/))) { flushP(); if (!list || list.tag !== "ul") { flushL(); list = { tag: "ul", items: [] }; } list.items.push(m[1]); continue; }
    if ((m = line.match(/^\d+[.)]\s+(.*)$/))) { flushP(); if (!list || list.tag !== "ol") { flushL(); list = { tag: "ol", items: [] }; } list.items.push(m[1]); continue; }
    flushL(); para.push(line.trim());
  }
  flushP(); flushL();
  return out.join("\n");
}
function frontMatter(src) {
  const m = src.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!m) return { data: {}, body: src };
  const data = {};
  for (const l of m[1].split("\n")) {
    const i = l.indexOf(":"); if (i < 0) continue;
    let v = l.slice(i + 1).trim().replace(/^["']|["']$/g, "");
    if (v === "true") v = true; else if (v === "false") v = false;
    data[l.slice(0, i).trim()] = v;
  }
  return { data, body: src.slice(m[0].length) };
}

function loadPosts(lang) {
  const dir = path.join(ROOT, "content/blog", lang);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith(".md")).map((f) => {
    const { data, body } = frontMatter(fs.readFileSync(path.join(dir, f), "utf8"));
    const words = body.split(/\s+/).filter(Boolean).length;
    return { ...data, slug: data.slug || f.replace(/\.md$/, ""), html: markdown(body), minutes: Math.max(1, Math.round(words / 180)), lang };
  }).filter((p) => DRAFTS || !p.draft).sort((a, b) => String(b.date).localeCompare(String(a.date)));
}
const fmtDate = (d, lang) => {
  const dt = new Date(d);
  return isNaN(dt) ? "" : dt.toLocaleDateString(I18N[lang].date_locale, { year: "numeric", month: "long", day: "numeric" });
};
const readTime = (n, lang) => {
  if (lang !== "ar") return `${n} ${I18N[lang].min_read}`;
  if (n <= 1) return "قراءة دقيقة";
  if (n === 2) return "قراءة دقيقتين";
  return n <= 10 ? `قراءة ${n} دقائق` : `قراءة ${n} دقيقة`;
};

/* ---------------- أقسام الصفحة الرئيسية ---------------- */
const phBadge = (text) => `<span class="ph-badge">${icon("doc")}${esc(text)}</span>`;

function resultsHTML(lang) {
  const t = I18N[lang];
  const items = publishedStats(lang);
  if (!items.length) return "";
  const anyPh = items.some(isPh);
  return `
    <section class="results" id="results" aria-labelledby="results-title">
      <div class="container">
        <h2 class="sr-only" id="results-title">${esc(t.results_title)}</h2>
        <div class="stats">${items.map((x) => `
          <div class="stat${isPh(x) ? " is-placeholder" : ""}"><strong dir="ltr">${esc(x.value)}</strong><span>${esc(x[lang])}</span></div>`).join("")}
        </div>
        ${anyPh ? `<p class="ph-note">${icon("doc")}${esc(t.placeholder_stats)}</p>` : ""}
      </div>
    </section>`;
}

function caseStudiesHTML(lang) {
  const t = I18N[lang];
  const items = publishedCases(lang);
  if (!items.length) return ""; // القسم يختفي إذا ماكو دراسات (ولا أماكن مؤقتة)
  const metrics = (d) => `<div class="case-metrics">${(d.results || []).filter((r) => r.value || r.label).map((r) => `<div><strong dir="ltr">${esc(r.value)}</strong><small>${esc(r.label)}</small></div>`).join("")}</div>`;
  const fact = (label, val) => (val ? `<div><dt>${esc(label)}</dt><dd>${escLtr(val)}</dd></div>` : "");
  const cards = items.map((c, i) => {
    const d = c[lang];
    return `
          <article class="case${isPh(c) ? " is-placeholder" : ""}">
            ${isPh(c) ? phBadge(t.placeholder_case) : ""}
            <header class="case-head">
              <div><p class="case-type">${esc(d.industry)}</p><h3>${esc(d.client)}</h3></div>
              <ul class="case-platforms">${(c.platforms || []).map((p) => `<li>${esc(p)}</li>`).join("")}</ul>
            </header>
            ${metrics(d)}
            <dl class="case-facts">${fact(t.case_goal, d.goal)}${fact(t.case_budget, d.budget)}${fact(t.case_period, d.period)}</dl>
            ${d.result ? `<p class="case-result"><b>${esc(t.case_result)}:</b> ${escLtr(d.result)}</p>` : ""}
            <button type="button" class="btn btn-secondary btn-sm case-open" data-dialog="case-${lang}-${i}">${esc(t.case_view)}${icon("arrow")}</button>
          </article>`;
  }).join("");
  const dialogs = items.map((c, i) => {
    const d = c[lang];
    return `
        <dialog class="case-dialog" id="case-${lang}-${i}" aria-labelledby="case-${lang}-${i}-t">
          <div class="cd-inner">
            <header class="cd-head">
              <div><p class="case-type">${esc(d.industry)}</p><h3 id="case-${lang}-${i}-t">${esc(d.client)}</h3></div>
              <button type="button" class="cd-close" data-close aria-label="${esc(t.close)}">✕</button>
            </header>
            ${isPh(c) ? phBadge(t.placeholder_case) : ""}
            ${metrics(d)}
            <dl class="case-facts">${fact(t.case_type, d.industry)}${fact(t.case_goal, d.goal)}${fact(t.case_budget, d.budget)}${fact(t.case_period, d.period)}${fact(t.case_platforms, (c.platforms || []).join(" · "))}</dl>
            <div class="cd-body">
              ${d.challenge ? `<h4>${esc(t.case_challenge)}</h4><p>${esc(d.challenge)}</p>` : ""}
              ${d.solution ? `<h4>${esc(t.case_strategy)}</h4><p>${esc(d.solution)}</p>` : ""}
              ${d.result ? `<h4>${esc(t.case_result)}</h4><p>${esc(d.result)}</p>` : ""}
            </div>
            <div class="cd-actions"><a class="btn btn-primary" href="#contact" data-close>${esc(t.cta)}</a></div>
          </div>
        </dialog>`;
  }).join("");
  return `
    <section class="section" id="work">
      <div class="container">
        <header class="section-head">
          <p class="eyebrow">${esc(t.cases_kicker)}</p>
          <h2>${esc(t.cases_title)}</h2>
          <p class="section-sub">${esc(t.cases_sub)}</p>
        </header>
        <div class="cases">${cards}
        </div>${dialogs}
      </div>
    </section>`;
}

function testimonialsHTML(lang, root) {
  const t = I18N[lang];
  const items = publishedTestimonials(lang);
  if (!items.length) return "";
  const initials = (n) => { const w = String(n || "").trim().split(/\s+/); return /[a-z]/i.test(w[0] || "") ? w.slice(0, 2).map((x) => x[0].toUpperCase()).join("") : (w[0] || "").slice(0, 1); };
  return `
    <section class="section section-alt" id="testimonials">
      <div class="container">
        <header class="section-head">
          <p class="eyebrow">${esc(t.testi_kicker)}</p>
          <h2>${esc(t.testi_title)}</h2>
          <p class="section-sub">${esc(t.testi_sub)}</p>
        </header>
        <div class="testis">${items.map((x) => {
          const d = x[lang];
          const name = d.name || x.name, company = d.company || x.company;
          return `
          <figure class="testi${isPh(x) ? " is-placeholder" : ""}">
            ${isPh(x) ? phBadge(t.placeholder_testi) : ""}
            <blockquote>${esc(d.quote)}</blockquote>
            ${d.result ? `<p class="testi-result">${icon("trend")}<span>${esc(d.result)}</span></p>` : ""}
            <figcaption>
              ${x.photo ? `<img src="${root}${esc(x.photo)}" alt="" width="48" height="48" loading="lazy" decoding="async">` : `<span class="testi-avatar" aria-hidden="true">${esc(initials(name))}</span>`}
              <span><b>${esc(name)}</b><small>${esc([d.role, company].filter(Boolean).join(" · "))}</small></span>
            </figcaption>
          </figure>`;
        }).join("")}
        </div>
      </div>
    </section>`;
}

function pricingHTML(lang) {
  const t = I18N[lang];
  const row = (ic, label, val) => (val ? `<div><dt>${icon(ic)}${esc(label)}</dt><dd>${esc(val)}</dd></div>` : "");
  return allPlans().filter((p) => p[lang] && !p.entry).map((p) => {
    const d = p[lang];
    const numeric = /\d/.test(d.price || "");
    return `
          <article class="plan${p.featured ? " plan-featured" : ""}">
            <header class="plan-head">
              ${p.featured && d.badge ? `<span class="plan-badge">${esc(d.badge)}</span>` : ""}
              <h3 class="plan-name"><bdi>${esc(d.name)}</bdi></h3>
              <p class="plan-for"><small>${esc(t.row_for)}</small>${esc(d.for)}</p>
            </header>
            <div class="plan-block">
              <p class="plan-label">${esc(t.row_services)}</p>
              <ul class="plan-list">${(d.features || []).filter(Boolean).map((f) => `<li>${icon("check")}<span>${esc(f)}</span></li>`).join("")}</ul>
            </div>
            <dl class="plan-rows">${row("campaign", t.row_campaigns, d.campaigns)}${row("doc", t.row_reports, d.reports)}${row("trend", t.row_optimization, d.optimization)}${row("chat", t.row_support, d.support)}</dl>
            <div class="plan-foot">
              <p class="plan-price">${numeric ? `<small>${esc(t.price_from)}</small>` : ""}<bdi>${esc(d.price)}</bdi>${d.period ? ` <span>${esc(d.period)}</span>` : ""}</p>
              <a class="btn ${p.featured ? "btn-primary" : "btn-secondary"} btn-block" href="#contact" data-plan="${esc(d.name)}">${esc(d.cta || t.cta)}</a>
            </div>
          </article>`;
  }).join("");
}

// عرض الدخول (مثل فحص الحساب): بطاقة عريضة فوق الباقات
function entryOfferHTML(lang, pre = "") {
  const t = I18N[lang];
  return allPlans().filter((p) => p[lang] && p.entry).map((p) => {
    const d = p[lang];
    const details = p.page && publishedServices(lang).some((x) => x.slug === p.page)
      ? `<a class="text-link" href="${link(`${pre}index.html`, `${pre}services/${p.page}/`)}">${esc(t.offer_details)}</a>` : "";
    return `
        <article class="offer${p.featured ? " offer-featured" : ""}">
          <div class="offer-main">
            ${d.badge ? `<span class="offer-badge">${esc(d.badge)}</span>` : ""}
            <h3>${esc(d.name)}</h3>
            <p class="offer-for">${esc(d.for)}</p>
            <p class="offer-price"><bdi>${esc(d.price)}</bdi>${d.period ? ` <span>${esc(d.period)}</span>` : ""}</p>
            <div class="offer-actions"><a class="btn btn-primary" href="#contact" data-plan="${esc(d.name)}">${esc(d.cta || t.cta)}</a>${details}</div>
          </div>
          <ul class="offer-list">${(d.features || []).filter(Boolean).map((f) => `<li>${icon("check")}<span>${esc(f)}</span></li>`).join("")}</ul>
        </article>`;
  }).join("");
}

const planOptions = (lang) => {
  const t = I18N[lang];
  const plans = allPlans().filter((p) => p[lang]).map((p) => `<option>${esc(p[lang].name)}</option>`).join("");
  const tech = publishedServices(lang).filter(isTech).map((x) => `<option data-slug="${esc(x.slug)}">${esc(x[lang].title)}</option>`).join("");
  return tech ? `<optgroup label="${esc(t.opt_plans)}">${plans}</optgroup><optgroup label="${esc(t.opt_tech)}">${tech}</optgroup>` : plans;
};

function faqHTML(lang) {
  const items = (readContent("faq.json", {})[lang] || []).filter((f) => f.q);
  return items.map((f) => `
          <details>
            <summary>${esc(f.q)}<span class="faq-ic" aria-hidden="true">${icon("plus")}</span></summary>
            <p>${esc(f.a)}</p>
          </details>`).join("");
}

function postCard(p, lang, fromFile, pre, tag = "h3") {
  const t = I18N[lang];
  const href = link(fromFile, `${pre}blog/${p.slug}/`);
  return `
          <article class="post-card" data-cat="${esc(p.category || "")}">
            ${p.category ? `<p class="post-cat">${esc(p.category)}</p>` : ""}
            <${tag} class="post-title"><a href="${href}">${esc(p.title)}</a></${tag}>
            <p class="post-excerpt">${esc(p.description)}</p>
            <div class="post-foot"><time datetime="${esc(p.date)}">${fmtDate(p.date, lang)}</time><a class="post-more" href="${href}" aria-label="${esc(t.read_more)}: ${esc(p.title)}">${esc(t.read_more)}${icon("arrow")}</a></div>
          </article>`;
}

function insightsHTML(lang, pre) {
  const t = I18N[lang];
  const posts = loadPosts(lang).slice(0, 3);
  if (!posts.length) return "";
  const file = `${pre}index.html`;
  return `
    <section class="section section-alt" id="insights">
      <div class="container">
        <header class="section-head section-head-row">
          <div>
            <p class="eyebrow">${esc(t.nav_blog)}</p>
            <h2>${esc(t.blog_heading)}</h2>
            <p class="section-sub">${esc(t.blog_sub)}</p>
          </div>
          <a class="btn btn-secondary" href="${link(file, `${pre}blog/`)}">${esc(t.all_posts)}${icon("arrow")}</a>
        </header>
        <div class="posts">${posts.map((p) => postCard(p, lang, file, pre)).join("")}
        </div>
      </div>
    </section>`;
}

function techHTML(lang, pre) {
  const t = I18N[lang];
  const file = `${pre}index.html`;
  const items = publishedServices(lang).filter(isTech);
  if (!items.length) return "";
  return `
        <div class="tech">
          <div class="tech-head">
            <p class="tech-title">${icon("code")}${esc(t.tech_title)}</p>
            <p class="tech-sub">${esc(t.tech_sub)}</p>
          </div>
          <div class="tech-grid">${items.map((x) => {
            const d = x[lang];
            return `
            <a class="tech-card" href="${link(file, `${pre}services/${x.slug}/`)}">
              <span class="svc-ic">${svcIcon(x.slug)}</span>
              <div class="tech-body">
                <h3>${esc(d.title)}</h3>
                <p>${esc(d.card || d.description)}</p>
                ${(d.tags || []).length ? `<ul class="tech-tags">${d.tags.map((g) => `<li>${esc(g)}</li>`).join("")}</ul>` : ""}
                <span class="svc-link">${esc(t.svc_more)}${icon("arrow")}</span>
              </div>
            </a>`;
          }).join("")}
          </div>
        </div>`;
}

function svcLinksHTML(lang, pre) {
  const file = `${pre}index.html`;
  return publishedServices(lang).filter((x) => !isTech(x)).map((x) => `<a class="svc-chip" href="${link(file, `${pre}services/${x.slug}/`)}"><span class="svc-chip-ic">${svcIcon(x.slug)}</span><span>${esc(x[lang].title)}</span>${icon("arrow")}</a>`).join("");
}

/* ---------------- Schema ---------------- */
const KNOWS = ["Digital Marketing", "Performance Marketing", "Meta Ads", "Facebook Ads", "Instagram Ads", "TikTok Ads", "Snapchat Ads", "UGC Ads", "Lead Generation", "Conversion Optimization", "Campaign Strategy", "Conversions API", "Web Development", "Mobile App Development", "Cybersecurity"];
function homeServices(lang) {
  const strip = (h) => String(h).replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
  const tpl = read(`src/pages/home.${lang}.html`);
  return [...tpl.matchAll(/<article class="svc-card">[\s\S]*?<h3>([\s\S]*?)<\/h3>\s*<p>([\s\S]*?)<\/p>/g)].map((m) => ({ name: strip(m[1]), desc: strip(m[2]) }));
}
function personSchema(lang) {
  const t = I18N[lang];
  const other = LANGS.find((l) => l !== lang);
  const offers = [...homeServices(lang).map((s) => ({ name: s.name, description: s.desc })),
    ...publishedServices(lang).filter((x) => !x.draft).map((x) => ({ name: x[lang].title, description: x[lang].description, url: absUrl(`${langPrefix(lang)}services/${x.slug}/`) }))];
  return {
    "@context": "https://schema.org", "@type": "Person", "@id": `${SITE}/#person`,
    name: t.name, alternateName: other ? I18N[other].name : undefined, jobTitle: t.job_title || t.role, description: t.home_description,
    url: absUrl(langPrefix(lang)), image: `${SITE}/assets/img/ibrahim-640.jpg`, telephone: "+" + CONFIG.whatsapp,
    sameAs: [CONFIG.instagram, SOCIAL.facebook, SOCIAL.tiktok, SOCIAL.linkedin].filter(Boolean),
    knowsAbout: KNOWS, areaServed: { "@type": "Country", name: "Iraq" },
    makesOffer: offers.map((o) => ({ "@type": "Offer", itemOffered: { "@type": "Service", ...o } })),
  };
}
const websiteSchema = (lang) => ({
  "@context": "https://schema.org", "@type": "WebSite", "@id": `${SITE}/#website-${lang}`, url: absUrl(langPrefix(lang)),
  name: I18N[lang].name, inLanguage: lang, publisher: { "@id": `${SITE}/#person` },
});

/* ---------------- البناء ---------------- */
fs.rmSync(OUT, { recursive: true, force: true });
copyDir(path.join(ROOT, "public"), OUT);
const sitemap = [];
const homeAlts = Object.fromEntries(LANGS.map((l) => [l, langPrefix(l)]));
const blogAlts = Object.fromEntries(LANGS.map((l) => [l, `${langPrefix(l)}blog/`]));

for (const lang of LANGS) {
  const t = I18N[lang];
  const pre = langPrefix(lang);
  const other = LANGS.find((l) => l !== lang);
  const root = rootOf(`${pre}index.html`);
  const hasCases = publishedCases(lang).length > 0;

  // الصفحة الرئيسية
  const homeTpl = read(`src/pages/home.${lang}.html`)
    .replace("{{results}}", () => resultsHTML(lang))
    .replace("{{case_studies}}", () => caseStudiesHTML(lang))
    .replace("{{testimonials}}", () => testimonialsHTML(lang, root))
    .replace("{{insights}}", () => insightsHTML(lang, pre))
    .replaceAll("{{work_link}}", () => hasCases ? "#work" : "#services")
    .replaceAll("{{work_label}}", () => esc(hasCases ? t.work_cases : t.work_services))
    .replace("{{entry_offer}}", () => entryOfferHTML(lang, pre))
    .replace("{{pricing}}", () => pricingHTML(lang))
    .replace("{{svc_links}}", () => svcLinksHTML(lang, pre))
    .replace("{{tech_services}}", () => techHTML(lang, pre))
    .replace("{{channels}}", () => channelsHTML(lang))
    .replace(/\{\{svc:([\w-]+)\}\}/g, (_, slug) => link(`${pre}index.html`, `${pre}services/${slug}/`))
    .replace("{{faq}}", () => faqHTML(lang))
    .replace("{{plan_options}}", () => planOptions(lang));
  page({ file: `${pre}index.html`, lang, isHome: true, title: t.home_title, description: t.home_description, bodyClass: "page-home",
    content: homeTpl, alternates: homeAlts, jsonld: [personSchema(lang), websiteSchema(lang)], altUrlFile: langPrefix(other) });
  sitemap.push({ loc: pre, alts: homeAlts, priority: "1.0" });

  // أفكار من السوق (المدونة)
  const posts = loadPosts(lang);
  const otherPosts = loadPosts(other);
  const blogFile = `${pre}blog/index.html`;
  const cats = [...new Set(posts.map((p) => p.category).filter(Boolean))];
  page({ file: blogFile, lang, title: t.blog_title, description: t.blog_sub, bodyClass: "page-blog",
    alternates: blogAlts, altUrlFile: `${langPrefix(other)}blog/`,
    jsonld: [{ "@context": "https://schema.org", "@type": "Blog", name: t.blog_heading, url: absUrl(`${pre}blog/`), inLanguage: lang, author: { "@id": `${SITE}/#person` } }],
    content: `
  <main id="main">
    <section class="page-hero">
      <div class="container">
        <p class="eyebrow">${esc(t.nav_blog)}</p>
        <h1>${esc(t.blog_heading)}</h1>
        <p class="lead">${esc(t.blog_sub)}</p>
      </div>
    </section>
    <section class="section section-tight">
      <div class="container">
        ${cats.length > 1 ? `<div class="cat-filter" role="group">${[`<button type="button" class="chip is-active" data-cat="" aria-pressed="true">${esc(t.blog_all)}</button>`, ...cats.map((c) => `<button type="button" class="chip" data-cat="${esc(c)}" aria-pressed="false">${esc(c)}</button>`)].join("")}</div>` : ""}
        <div class="posts posts-page" id="posts">${posts.map((p) => postCard(p, lang, blogFile, pre, "h2")).join("") || `<p>${esc(t.blog_empty)}</p>`}
        </div>
      </div>
    </section>
  </main>` });
  sitemap.push({ loc: `${pre}blog/`, alts: blogAlts, priority: "0.8" });

  for (const p of posts) {
    const file = `${pre}blog/${p.slug}/index.html`;
    const trans = p.translation && otherPosts.find((o) => o.slug === p.translation);
    const alts = { [lang]: `${pre}blog/${p.slug}/` };
    if (trans) alts[other] = `${langPrefix(other)}blog/${trans.slug}/`;
    const more = posts.filter((o) => o.slug !== p.slug).slice(0, 2);
    page({ file, lang, title: `${p.title} | ${t.name}`, description: p.description, ogType: "article",
      bodyClass: "page-post", alternates: alts, robots: p.draft ? "noindex" : "index, follow",
      altUrlFile: trans ? alts[other] : `${langPrefix(other)}blog/`,
      jsonld: [{ "@context": "https://schema.org", "@type": "BlogPosting", headline: p.title, description: p.description,
        datePublished: p.date, inLanguage: lang, articleSection: p.category || undefined, mainEntityOfPage: absUrl(`${pre}blog/${p.slug}/`),
        image: `${SITE}/assets/img/og-image.jpg`, author: { "@type": "Person", name: t.name, url: absUrl(pre) } }],
      content: `
  <main id="main">
    <article class="post">
      <header class="page-hero post-hero">
        <div class="container narrow">
          <a class="back" href="${link(file, `${pre}blog/`)}">${esc(t.back_to_blog)}</a>
          ${p.category ? `<p class="post-cat">${esc(p.category)}</p>` : ""}
          <h1>${esc(p.title)}</h1>
          <p class="post-meta"><time datetime="${esc(p.date)}">${fmtDate(p.date, lang)}</time><span>${readTime(p.minutes, lang)}</span></p>
        </div>
      </header>
      <div class="container narrow prose">
${p.html.replace(/href="\/([^"#]*)(#[^"]*)?"/g, (_, dir, hash) => `href="${link(file, dir)}${hash || ""}"`)}
      </div>
      <aside class="container narrow">
        <div class="post-cta">
          <h2>${esc(t.post_cta_title)}</h2>
          <p>${esc(t.post_cta_text)}</p>
          <a class="btn btn-primary" href="${link(file, pre)}#contact">${esc(t.cta)}</a>
        </div>
        ${more.length ? `<div class="posts posts-more">${more.map((o) => postCard(o, lang, file, pre)).join("")}</div>` : ""}
      </aside>
    </article>
  </main>` });
    if (!p.draft) sitemap.push({ loc: `${pre}blog/${p.slug}/`, alts, priority: "0.7", lastmod: p.date });
  }
}

// صفحات الخدمات
for (const lang of LANGS) {
  const t = I18N[lang];
  const pre = langPrefix(lang);
  const other = LANGS.find((l) => l !== lang);
  const all = publishedServices(lang);
  if (!all.length) continue;
  const idxFile = `${pre}services/index.html`;
  const idxAlts = Object.fromEntries(LANGS.map((l) => [l, `${langPrefix(l)}services/`]));
  const tile = (x, from, tag, withDesc = tag === "h2") => `
        <a class="svc-tile" href="${link(from, `${pre}services/${x.slug}/`)}">
          <span class="svc-ic">${svcIcon(x.slug)}</span>
          <${tag}>${esc(x[lang].title)}</${tag}>
          ${withDesc ? `<p>${esc(x[lang].description)}</p>` : ""}
          <span class="svc-link">${esc(t.svc_more)}${icon("arrow")}</span>
        </a>`;
  page({ file: idxFile, lang, title: t.svc_index_title, description: t.svc_index_sub, bodyClass: "page-services", alternates: idxAlts,
    altUrlFile: `${langPrefix(other)}services/`,
    content: `
  <main id="main">
    <section class="page-hero">
      <div class="container">
        <p class="eyebrow">${esc(t.svc_index_heading)}</p>
        <h1>${esc(t.svc_index_heading)}</h1>
        <p class="lead">${esc(t.svc_index_sub)}</p>
      </div>
    </section>
    <section class="section section-tight">
      <div class="container">${(() => {
        const groups = [[t.svc_group_marketing, all.filter((x) => !isTech(x))], [t.svc_group_tech, all.filter(isTech)]].filter(([, xs]) => xs.length);
        if (groups.length < 2) return `<div class="svc-index">${all.map((x) => tile(x, idxFile, "h2")).join("")}</div>`;
        return groups.map(([title, xs]) => `
        <h2 class="svc-group-title">${esc(title)}</h2>
        <div class="svc-index">${xs.map((x) => tile(x, idxFile, "h3", true)).join("")}</div>`).join("");
      })()}
      </div>
    </section>
  </main>` });
  sitemap.push({ loc: `${pre}services/`, alts: idxAlts, priority: "0.8" });

  for (const x of all) {
    const d = x[lang];
    const file = `${pre}services/${x.slug}/index.html`;
    const alts = Object.fromEntries(LANGS.filter((l) => x[l]).map((l) => [l, `${langPrefix(l)}services/${x.slug}/`]));
    const wa = `https://wa.me/${CONFIG.whatsapp}?text=${encodeURIComponent(`${t.svc_wa_msg} ${d.title}`)}`;
    const related = [...all.filter((r) => r.slug !== x.slug && isTech(r) === isTech(x)), ...all.filter((r) => r.slug !== x.slug && isTech(r) !== isTech(x))].slice(0, 3);
    const homeUrl = link(file, pre);
    const bookUrl = `${homeUrl}?service=${encodeURIComponent(x.slug)}#contact`; // يختار الخدمة تلقائيًا بنموذج الحجز
    page({ file, lang, title: d.seoTitle || `${d.title} | ${t.name}`, description: d.description, bodyClass: "page-service",
      alternates: alts, altUrlFile: alts[other] || `${langPrefix(other)}services/`, robots: x.draft ? "noindex" : "index, follow",
      jsonld: [
        { "@context": "https://schema.org", "@type": "Service", name: d.title, description: d.description, serviceType: d.title,
          areaServed: { "@type": "Country", name: "Iraq" }, url: absUrl(`${pre}services/${x.slug}/`), provider: { "@type": "Person", "@id": `${SITE}/#person`, name: t.name, url: absUrl(pre) } },
        ...(d.faq && d.faq.length ? [{ "@context": "https://schema.org", "@type": "FAQPage", mainEntity: d.faq.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })) }] : []),
        { "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [
          { "@type": "ListItem", position: 1, name: t.home, item: absUrl(pre) },
          { "@type": "ListItem", position: 2, name: t.svc_index_heading, item: absUrl(`${pre}services/`) },
          { "@type": "ListItem", position: 3, name: d.title, item: absUrl(`${pre}services/${x.slug}/`) } ] },
      ],
      content: `
  <main id="main">
    <section class="page-hero svc-hero">
      <div class="container">
        <nav class="crumbs" aria-label="breadcrumb"><a href="${homeUrl}">${esc(t.home)}</a><span aria-hidden="true">/</span><a href="${link(file, `${pre}services/`)}">${esc(t.svc_index_heading)}</a></nav>
        <div class="svc-hero-row">
          <span class="svc-ic svc-ic-lg">${svcIcon(x.slug)}</span>
          <div>
            <p class="eyebrow">${esc(t.svc_kicker)}</p>
            <h1>${esc(d.title)}</h1>
          </div>
        </div>
        <p class="lead">${esc(d.intro)}</p>
        <div class="hero-actions">
          <a class="btn btn-primary btn-lg" href="${bookUrl}">${esc(t.cta)}</a>
          <a class="btn btn-secondary btn-lg" href="${wa}" target="_blank" rel="noopener">${icon("chat")}${esc(t.svc_wa)}</a>
        </div>
      </div>
    </section>

    <section class="section">
      <div class="container">
        <header class="section-head"><h2>${esc(t.svc_benefits)}</h2></header>
        <ul class="svc-benefits">${(d.benefits || []).map((b) => `<li>${icon("check")}<span>${esc(b)}</span></li>`).join("")}</ul>
      </div>
    </section>

    <section class="section section-alt">
      <div class="container svc-two">
        <div>
          <h2>${esc(t.svc_fit)}</h2>
          <ul class="svc-fit">${(d.fit || []).map((f) => `<li>${icon("target")}<span>${esc(f)}</span></li>`).join("")}</ul>
        </div>
        <div>
          <h2>${esc(t.svc_steps)}</h2>
          <ol class="svc-steps">${(d.steps || []).map((st, i) => `<li><span class="tl-num">${String(i + 1).padStart(2, "0")}</span><p>${esc(st)}</p></li>`).join("")}</ol>
        </div>
      </div>
    </section>

    ${d.faq && d.faq.length ? `<section class="section">
      <div class="container faq-layout">
        <header class="section-head"><h2>${esc(t.svc_faq)}</h2></header>
        <div class="faq">${d.faq.map((f) => `
          <details><summary>${esc(f.q)}<span class="faq-ic" aria-hidden="true">${icon("plus")}</span></summary><p>${esc(f.a)}</p></details>`).join("")}
        </div>
      </div>
    </section>` : ""}

    <section class="section section-tight">
      <div class="container">
        <div class="cta-box cta-box-sm">
          <h2>${esc(t.svc_cta_title)}</h2>
          <p>${esc(t.svc_cta_text)}</p>
          <div class="cta-actions">
            <a class="btn btn-primary btn-lg" href="${bookUrl}">${esc(t.cta)}</a>
            ${isTech(x)
              ? `<a class="btn btn-secondary btn-lg" href="${wa}" target="_blank" rel="noopener">${icon("chat")}${esc(t.svc_wa)}</a>`
              : `<a class="btn btn-secondary btn-lg" href="${homeUrl}#pricing">${esc(t.svc_pricing)}</a>`}
          </div>
        </div>
        ${related.length ? `<h2 class="related-title">${esc(t.svc_related)}</h2>
        <div class="svc-index related">${related.map((r) => tile(r, file, "h3")).join("")}
        </div>` : ""}
      </div>
    </section>
  </main>` });
    if (!x.draft) sitemap.push({ loc: `${pre}services/${x.slug}/`, alts, priority: "0.8" });
  }
}

// 404 (روابط من الجذر لأنها تنعرض على أي مسار)
{
  const t = I18N.ar;
  const base = new URL(SITE + "/").pathname; // يدعم الاستضافة بمسار فرعي مثل GitHub Pages
  write("404.html", render(read("src/pages/404.ar.html"), { t, root: PREVIEW ? "" : base }));
}

// config.js للمتصفح (يتولد من content/settings.json)
{
  const pub = {
    brandName: I18N[CONFIG.defaultLang].name, whatsappNumber: CONFIG.whatsapp, instagramUrl: CONFIG.instagram,
    whatsappGreeting: CONFIG.whatsappGreeting, whatsappGreetingEn: CONFIG.whatsappGreetingEn, currency: CONFIG.currency || "$",
    supabaseUrl: CONFIG.supabaseUrl || "", supabaseAnonKey: CONFIG.supabaseAnonKey || "",
    github: CONFIG.github || null, siteUrl: SITE, tracking: CONFIG.tracking || {},
    aiEndpoint: CONFIG.aiEndpoint || "",
  };
  write("assets/js/config.js", `/* يتولد تلقائيًا من content/settings.json — لا تعدله هنا */\nwindow.SITE_CONFIG = ${JSON.stringify(pub, null, 2)};\n`);
}

// معرفة المساعد (تتولد من محتوى الموقع؛ يستخدمها المساعد بالموقع والـ AI Worker)
{
  const strip = (h) => String(h).replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
  const know = {
    person: { ar: I18N.ar.name, en: I18N.en.name, role: { ar: I18N.ar.job_title || I18N.ar.role, en: I18N.en.job_title || I18N.en.role } },
    contact: { whatsapp: CONFIG.whatsapp, instagram: CONFIG.instagram, site: SITE },
    langs: {},
  };
  for (const lang of LANGS) {
    const tpl = read(`src/pages/home.${lang}.html`);
    know.langs[lang] = {
      services: [...homeServices(lang), ...publishedServices(lang).filter((x) => !x.draft).map((x) => ({ name: x[lang].title, desc: x[lang].description }))],
      about: [...tpl.matchAll(/<p class="[^"]*" data-k="about">([\s\S]*?)<\/p>/g)].map((m) => strip(m[1])),
      why: [...tpl.matchAll(/<li data-k="why">[\s\S]*?<b>([\s\S]*?)<\/b><span>([\s\S]*?)<\/span>/g)].map((m) => `${strip(m[1])}: ${strip(m[2])}`),
      plans: allPlans().filter((p) => p[lang]).map((p) => ({ name: p[lang].name, for: p[lang].for, price: p[lang].price, period: p[lang].period || "",
        features: [...(p[lang].features || []), p[lang].campaigns, p[lang].reports, p[lang].optimization, p[lang].support].filter(Boolean),
        entry: !!p.entry, featured: !!p.featured })),
      faq: (readContent("faq.json", {})[lang] || []).filter((f) => f.q),
      stats: readContent("stats.json", []).filter((x) => !x.draft && !isPh(x) && x.value && x[lang]).map((x) => `${x.value} ${x[lang]}`),
      cases: readContent("case-studies.json", []).filter((c) => !c.draft && !isPh(c) && c[lang]).map((c) => ({ client: c[lang].client, industry: c[lang].industry,
        goal: c[lang].goal, results: (c[lang].results || []).map((r) => `${r.value} ${r.label}`) })),
    };
  }
  write("assets/ai-knowledge.json", JSON.stringify(know));
}

// بيانات العرض التجريبي للوحة التحكم (بدون المسودات الخاصة وبدون مفاتيح)
{
  const files = {}, dirs = {};
  for (const f of ["pricing.json", "faq.json", "case-studies.json", "stats.json", "testimonials.json", "services.json"]) {
    const fp = path.join(ROOT, "content", f);
    if (fs.existsSync(fp)) files[`content/${f}`] = JSON.parse(fs.readFileSync(fp, "utf8"));
  }
  files["content/settings.json"] = { ...CONFIG, supabaseUrl: "", supabaseAnonKey: "" };
  for (const lang of LANGS) {
    const dir = path.join(ROOT, "content/blog", lang);
    const names = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith(".md")) : [];
    dirs[`content/blog/${lang}`] = [];
    for (const n of names) {
      const src = fs.readFileSync(path.join(dir, n), "utf8");
      if (frontMatter(src).data.draft) continue;
      dirs[`content/blog/${lang}`].push(n);
      files[`content/blog/${lang}/${n}`] = src;
    }
  }
  const h = 3600000, now = Date.now();
  const leads = [
    ["مثال: علي حسن", "07701234567", "متجر إلكتروني", "300$ – 1,000$", "Growth", "instagram", "nov-offer", "new", "أريد أزيد طلبات المتجر", 2],
    ["مثال: سارة محمد", "07809876543", "عيادة أو خدمات", "أقل من 300$", "Starter", "facebook", "clinic-leads", "contacted", "", 20],
    ["مثال: مطعم البيت", "07501112233", "مطعم أو كافيه", "1,000$ – 5,000$", "Scale", "tiktok", "food-video", "qualified", "نحتاج حملات توصيل", 50],
    ["مثال: Ahmed K.", "+971501234567", "Clothing brand", "$1,000 – $5,000", "Growth", "direct", null, "won", "Expand to Gulf market", 96],
    ["مثال: براند حيدر", "07712223344", "براند ملابس", "300$ – 1,000$", "غير محدد", "instagram", "nov-offer", "new", "", 5],
    ["مثال: نور العراق", "07723334455", "أخرى", "أقل من 300$", "Starter", "referral", null, "lost", "", 200],
  ].map((r, i) => ({ id: "demo-" + i, name: r[0], phone: r[1], business_type: r[2], budget: r[3], plan: r[4], source: r[5], campaign: r[6],
    status: r[7], message: r[8], notes: null, lang: /[a-z]/i.test(r[2]) ? "en" : "ar", created_at: new Date(now - r[9] * h).toISOString() }));
  write("admin/demo-data.js", `/* بيانات تجريبية للوحة (تتولد تلقائيًا) */\nwindow.ADMIN_DEMO = ${JSON.stringify({ files, dirs, leads })};\n`);
}

// sitemap.xml + robots.txt
const urls = sitemap.map((u) => `  <url>
    <loc>${absUrl(u.loc)}</loc>${u.lastmod ? `\n    <lastmod>${u.lastmod}</lastmod>` : ""}
${Object.entries(u.alts || {}).map(([l, d]) => `    <xhtml:link rel="alternate" hreflang="${l}" href="${absUrl(d)}"/>`).join("\n")}
    <priority>${u.priority}</priority>
  </url>`).join("\n");
write("sitemap.xml", `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${urls}
</urlset>
`);
write("robots.txt", `User-agent: *\nAllow: /\nDisallow: /admin/\n\nSitemap: ${SITE}/sitemap.xml\n`);

/* ---------------- الضغط (Minify) — محافظ حتى ما يكسر شي ---------------- */
function minifyHTML(html) {
  return html.replace(/<!--(?!\[if)[\s\S]*?-->/g, "").replace(/^[ \t]+/gm, "").replace(/\n{2,}/g, "\n");
}
function minifyCSS(css) {
  return css
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\s+/g, " ")
    .replace(/\s*([{};,>~])\s*/g, "$1")
    .replace(/:\s+/g, ":")
    .replace(/;}/g, "}")
    .trim();
}
function minifyJS(js) {
  const out = []; let inBlock = false;
  for (const raw of js.split("\n")) {
    const line = raw.trim();
    if (inBlock) { const e = line.indexOf("*/"); if (e >= 0) { inBlock = false; const rest = line.slice(e + 2).trim(); if (rest) out.push(rest); } continue; }
    if (line.startsWith("/*")) { const e = line.indexOf("*/", 2); if (e < 0) { inBlock = true; continue; } const rest = line.slice(e + 2).trim(); if (rest) out.push(rest); continue; }
    if (!line || line.startsWith("//")) continue;
    out.push(line);
  }
  return out.join("\n") + "\n";
}
let saved = 0;
if (MINIFY) {
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
  for (const f of walk(OUT)) {
    const fn = f.endsWith(".html") ? minifyHTML : f.endsWith(".css") ? minifyCSS : f.endsWith(".js") ? minifyJS : null;
    if (!fn) continue;
    const before = fs.readFileSync(f, "utf8"), after = fn(before);
    saved += Buffer.byteLength(before) - Buffer.byteLength(after);
    fs.writeFileSync(f, after);
  }
}

// Cache busting: كل ملف CSS/JS ياخذ ?v=بصمة محتواه، حتى الزوار يشوفون النسخة الجديدة فورًا بعد أي تحديث
// (الاستضافة تخزّن هذي الملفات لفترة طويلة، فبدون البصمة ممكن يظهر تصميم قديم)
{
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
  const hash = {};
  for (const sub of ["css", "js"]) {
    const dir = path.join(OUT, "assets", sub);
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) hash[`${sub}/${f}`] = crypto.createHash("sha256").update(fs.readFileSync(path.join(dir, f))).digest("hex").slice(0, 10);
  }
  for (const f of walk(OUT).filter((x) => x.endsWith(".html"))) {
    const html = fs.readFileSync(f, "utf8");
    const out = html.replace(/(assets\/((?:css|js)\/[\w.-]+\.(?:css|js)))(?=["'])/g, (m, full, key) => (hash[key] ? `${full}?v=${hash[key]}` : m));
    if (out !== html) fs.writeFileSync(f, out);
  }
}

console.log(`✓ Built ${sitemap.length} indexable pages → dist/${PREVIEW ? " (preview)" : ""}${DRAFTS ? " (with drafts)" : ""}${SHOW_PH ? " · placeholders on" : ""}${MINIFY ? ` · minified −${Math.round(saved / 1024)}KB` : ""}`);
