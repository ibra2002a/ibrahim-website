#!/usr/bin/env node
/**
 * build.mjs — مولّد موقع ثابت بدون أي مكتبات (Node 18+)
 *
 *   node build.mjs              ← بناء الإنتاج إلى dist/
 *   node build.mjs --drafts     ← يُظهر المسودات (دراسات الحالة والمقالات draft: true)
 *   node build.mjs --preview    ← روابط بصيغة index.html (للمعاينة بدون سيرفر)
 *
 * المصادر:
 *   src/layouts/   القالب العام        src/partials/  الهيدر والفوتر
 *   src/pages/     محتوى الصفحات       src/i18n/      نصوص الواجهة لكل لغة
 *   content/       المدونة (Markdown) ودراسات الحالة (JSON)
 *   public/        ملفات تُنسخ كما هي (CSS, JS, صور, admin)
 *   content/settings.json  الإعدادات (واتساب، Pixels، Supabase) ← يولّد assets/js/config.js
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(ROOT, "dist");
const args = new Set(process.argv.slice(2));
const PREVIEW = args.has("--preview");
const DRAFTS = args.has("--drafts") || PREVIEW;

const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const readJSON = (p) => JSON.parse(read(p));
const CONFIG = readJSON("content/settings.json");
const SITE = CONFIG.siteUrl.replace(/\/$/, "");
const LANGS = CONFIG.languages;
const I18N = Object.fromEntries(LANGS.map((l) => [l, readJSON(`src/i18n/${l}.json`)]));

/* ---------------- helpers ---------------- */
const esc = (s = "") =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

function write(rel, html) {
  const file = path.join(OUT, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, html);
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
  let rel = path.posix.relative(fromDir === "." ? "" : fromDir, toDir.replace(/\/$/, ""));
  if (PREVIEW) return (rel ? rel + "/" : "") + "index.html";
  return rel ? rel + "/" : "./";
}
const rootOf = (fromFile) => {
  const depth = path.posix.dirname(fromFile).split("/").filter((p) => p && p !== ".").length;
  return "../".repeat(depth);
};
const absUrl = (dir) => `${SITE}/${dir}`;

/* ---------------- templating ---------------- */
const PARTIALS = Object.fromEntries(
  fs.readdirSync(path.join(ROOT, "src/partials")).map((f) => [f.replace(/\.html$/, ""), read(`src/partials/${f}`)])
);
function render(tpl, ctx) {
  tpl = tpl.replace(/\{\{>\s*([\w-]+)\s*\}\}/g, (_, name) => PARTIALS[name] ?? "");
  return tpl.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key) => {
    const v = key.split(".").reduce((o, k) => (o == null ? undefined : o[k]), ctx);
    return v == null ? "" : String(v);
  });
}
const LAYOUT = read("src/layouts/base.html");

function page({ file, lang, title, description, content, alternates = {}, jsonld = [], ogType = "website",
  robots = "index, follow", bodyClass = "", isHome = false, altUrlFile }) {
  const t = I18N[lang];
  const homeDir = langPrefix(lang);
  const otherLang = LANGS.find((l) => l !== lang);
  const ctx = {
    lang, dir: lang === "ar" ? "rtl" : "ltr", t, site_url: SITE,
    title: esc(title), description: esc(description), robots, og_type: ogType, body_class: bodyClass,
    canonical: absUrl(path.posix.dirname(file) === "." ? "" : path.posix.dirname(file) + "/"),
    root: rootOf(file),
    home: isHome ? "" : link(file, homeDir),
    home_link: isHome ? "#top" : link(file, homeDir),
    blog_url: link(file, `${homeDir}blog/`),
    alt_lang: otherLang,
    alt_url: link(file, altUrlFile ?? langPrefix(otherLang)),
    whatsapp: CONFIG.whatsapp, instagram: CONFIG.instagram,
    footer_services: (() => {
      const items = publishedServices(lang);
      return items.length ? `<nav class="footer-svc" aria-label="${esc(t.footer_services)}">${items.map((x) => `<a href="${link(file, `${homeDir}services/${x.slug}/`)}">${esc(x[lang].title)}</a>`).join("")}</nav>` : "";
    })(),
    verify_meta: [
      CONFIG.seo && CONFIG.seo.googleVerification ? `  <meta name="google-site-verification" content="${esc(CONFIG.seo.googleVerification)}">` : "",
      CONFIG.seo && CONFIG.seo.bingVerification ? `  <meta name="msvalidate.01" content="${esc(CONFIG.seo.bingVerification)}">` : "",
    ].filter(Boolean).join("\n"),
    alternates: Object.entries(alternates)
      .map(([l, dir]) => `  <link rel="alternate" hreflang="${l}" href="${absUrl(dir)}">`)
      .concat(alternates[CONFIG.defaultLang] != null ? [`  <link rel="alternate" hreflang="x-default" href="${absUrl(alternates[CONFIG.defaultLang])}">`] : [])
      .join("\n"),
    jsonld: jsonld.map((j) => `  <script type="application/ld+json">${JSON.stringify(j)}</script>`).join("\n"),
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

/* ---------------- المحتوى ---------------- */
function loadPosts(lang) {
  const dir = path.join(ROOT, "content/blog", lang);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith(".md")).map((f) => {
    const { data, body } = frontMatter(fs.readFileSync(path.join(dir, f), "utf8"));
    const words = body.split(/\s+/).filter(Boolean).length;
    return { ...data, slug: data.slug || f.replace(/\.md$/, ""), html: markdown(body), minutes: Math.max(1, Math.round(words / 200)), lang };
  }).filter((p) => DRAFTS || !p.draft).sort((a, b) => String(b.date).localeCompare(String(a.date)));
}
const fmtDate = (d, lang) => {
  const dt = new Date(d);
  return isNaN(dt) ? "" : dt.toLocaleDateString(I18N[lang].date_locale, { year: "numeric", month: "long", day: "numeric" });
};

const readContent = (f, fallback) => {
  const fp = path.join(ROOT, "content", f);
  return fs.existsSync(fp) ? JSON.parse(fs.readFileSync(fp, "utf8")) : fallback;
};
const publishedCases = (lang) => readContent("case-studies.json", []).filter((c) => (DRAFTS || !c.draft) && c[lang]);
const publishedServices = (lang) => readContent("services.json", []).filter((x) => (DRAFTS || !x.draft) && x[lang] && x.slug);
const publishedStats = () => readContent("stats.json", []).filter((x) => (DRAFTS || !x.draft) && x.value);
const publishedTestimonials = (lang) => readContent("testimonials.json", []).filter((x) => (DRAFTS || !x.draft) && x[lang] && x[lang].quote);

function caseStudiesHTML(lang, root) {
  const t = I18N[lang];
  const items = publishedCases(lang);
  if (!items.length) return ""; // القسم يختفي تلقائيًا إذا ماكو دراسات منشورة
  const cards = items.map((c) => {
    const d = c[lang];
    const meta = [d.industry, d.period].filter(Boolean).map(esc).join(" · ");
    return `
          <article class="case${c.draft ? " case-draft" : ""}">
            ${c.draft ? `<span class="case-badge">${esc(t.draft_badge)}</span>` : ""}
            <div class="case-head">
              <div><h3>${esc(d.client)}</h3><p class="case-meta">${meta}</p></div>
              <ul class="case-platforms">${(c.platforms || []).map((p) => `<li>${esc(p)}</li>`).join("")}</ul>
            </div>
            <div class="case-results">${(d.results || []).map((r) => `<div><strong>${esc(r.value)}</strong><small>${esc(r.label)}</small></div>`).join("")}</div>
            <dl class="case-facts">
              ${d.goal ? `<div><dt>${esc(t.case_goal)}</dt><dd>${esc(d.goal)}</dd></div>` : ""}
              ${d.budget ? `<div><dt>${esc(t.case_budget)}</dt><dd>${esc(d.budget)}</dd></div>` : ""}
            </dl>
            ${d.challenge || d.solution ? `<details class="case-more">
              <summary><span class="when-closed">${esc(t.case_details)}</span><span class="when-open">${esc(t.case_hide)}</span></summary>
              <dl class="case-body">
                ${d.challenge ? `<dt>${esc(t.case_challenge)}</dt><dd>${esc(d.challenge)}</dd>` : ""}
                ${d.solution ? `<dt>${esc(t.case_strategy)}</dt><dd>${esc(d.solution)}</dd>` : ""}
              </dl>
            </details>` : ""}
          </article>`;
  }).join("");
  return `
    <section class="section" id="work">
      <div class="container">
        <header class="section-head">
          <p class="kicker">${esc(t.cases_kicker)}</p>
          <h2>${esc(t.cases_title)}</h2>
          <p class="section-sub">${esc(t.cases_sub)}</p>
        </header>
        <div class="cases">${cards}
        </div>
        ${ctaBand(lang)}
      </div>
    </section>`;
}

function ctaBand(lang, text) {
  const t = I18N[lang];
  return `<div class="cta-band"><p>${esc(text || t.post_cta_title)}</p><a class="btn btn-accent" href="#contact">${esc(t.cta_short)}</a></div>`;
}

function resultsHTML(lang) {
  const t = I18N[lang];
  const items = publishedStats().filter((x) => x[lang]);
  if (!items.length) return "";
  const anyDraft = items.some((x) => x.draft);
  return `
    <section class="results" id="results" aria-label="${esc(t.results_kicker)}">
      <div class="container">
        <div class="results-head">
          <p class="kicker">${esc(t.results_kicker)}</p>
          <h2>${esc(t.results_title)}</h2>
          ${anyDraft ? `<span class="case-badge">${esc(t.draft_stats)}</span>` : ""}
        </div>
        <div class="stats">${items.map((x) => `
          <div class="stat"><strong>${esc(x.value)}</strong><span>${esc(x[lang])}</span></div>`).join("")}
        </div>
      </div>
    </section>`;
}

function testimonialsHTML(lang, root) {
  const t = I18N[lang];
  const items = publishedTestimonials(lang);
  if (!items.length) return "";
  const initials = (n) => { const w = String(n || "").replace(/^مثال:\s*/, "").trim().split(/\s+/); return /[a-z]/i.test(w[0] || "") ? w.slice(0, 2).map((x) => x[0].toUpperCase()).join("") : (w[0] || "").slice(0, 1); };
  return `
    <section class="section section-alt" id="testimonials">
      <div class="container">
        <header class="section-head">
          <p class="kicker">${esc(t.testi_kicker)}</p>
          <h2>${esc(t.testi_title)}</h2>
          <p class="section-sub">${esc(t.testi_sub)}</p>
        </header>
        <div class="testis">${items.map((x) => {
          const d = x[lang];
          return `
          <figure class="testi${x.draft ? " case-draft" : ""}">
            ${x.draft ? `<span class="case-badge">${esc(t.draft_badge)}</span>` : ""}
            ${d.result ? `<span class="testi-result">${esc(d.result)}</span>` : ""}
            <blockquote>${esc(d.quote)}</blockquote>
            <figcaption>
              ${x.photo ? `<img src="${root}${esc(x.photo)}" alt="" width="48" height="48" loading="lazy">` : `<span class="testi-avatar" aria-hidden="true">${esc(initials(x.name))}</span>`}
              <span><b>${esc(x.name)}</b><small>${esc([d.role, x.company].filter(Boolean).join(" · "))}</small></span>
            </figcaption>
          </figure>`;
        }).join("")}
        </div>
        ${ctaBand(lang)}
      </div>
    </section>`;
}

function pricingHTML(lang) {
  const file = path.join(ROOT, "content/pricing.json");
  if (!fs.existsSync(file)) return "";
  return JSON.parse(fs.readFileSync(file, "utf8")).filter((p) => p[lang] && !p.entry).map((p) => {
    const d = p[lang];
    const numeric = /\d/.test(d.price || "");
    return `
          <article class="plan${p.featured ? " plan-featured" : ""}">
            ${p.featured && d.badge ? `<span class="badge">${esc(d.badge)}</span>` : ""}
            <h3>${esc(d.name)}</h3>
            <p class="plan-for">${esc(d.for)}</p>
            <p class="price${numeric ? "" : " price-text"}"><span>${esc(d.price)}</span>${d.period ? " " + esc(d.period) : ""}</p>
            <ul>${(d.features || []).filter(Boolean).map((f) => `<li>${esc(f)}</li>`).join("")}</ul>
            <a class="btn ${p.featured ? "btn-accent" : "btn-outline"}" href="#contact" data-plan="${esc(d.name)}">${esc(d.cta || "")}</a>
          </article>`;
  }).join("");
}

// عرض الدخول (مثل فحص الحساب): بطاقة عريضة فوق الباقات
function entryOfferHTML(lang, pre = "") {
  const file = path.join(ROOT, "content/pricing.json");
  if (!fs.existsSync(file)) return "";
  return JSON.parse(fs.readFileSync(file, "utf8")).filter((p) => p[lang] && p.entry).map((p) => {
    const d = p[lang];
    return `
        <article class="offer">
          <div class="offer-main">
            ${d.badge ? `<span class="offer-badge">${esc(d.badge)}</span>` : ""}
            <h3>${esc(d.name)}</h3>
            <p>${esc(d.for)}</p>
            <p class="offer-price"><span>${esc(d.price)}</span>${d.period ? " " + esc(d.period) : ""}</p>
            <div class="offer-actions"><a class="btn btn-accent" href="#contact" data-plan="${esc(d.name)}">${esc(d.cta || "")}</a>${p.page && publishedServices(lang).some((x) => x.slug === p.page) ? `<a class="offer-more" href="${link(`${pre}index.html`, `${pre}services/${p.page}/`)}">${esc(I18N[lang].offer_details)}</a>` : ""}</div>
          </div>
          <ul class="offer-list">${(d.features || []).filter(Boolean).map((f) => `<li>${esc(f)}</li>`).join("")}</ul>
        </article>`;
  }).join("");
}

function planOptions(lang) {
  const file = path.join(ROOT, "content/pricing.json");
  if (!fs.existsSync(file)) return "";
  return JSON.parse(fs.readFileSync(file, "utf8")).filter((p) => p[lang]).map((p) => `<option>${esc(p[lang].name)}</option>`).join("");
}

function faqHTML(lang) {
  const file = path.join(ROOT, "content/faq.json");
  if (!fs.existsSync(file)) return "";
  const items = JSON.parse(fs.readFileSync(file, "utf8"))[lang] || [];
  return items.filter((f) => f.q).map((f) => `
          <details>
            <summary>${esc(f.q)}</summary>
            <p>${esc(f.a)}</p>
          </details>`).join("");
}

const person = (lang) => ({
  "@context": "https://schema.org", "@type": "Person",
  name: I18N[lang].name, jobTitle: I18N[lang].role, url: absUrl(langPrefix(lang)),
  image: `${SITE}/assets/img/ibrahim-640.jpg`, telephone: "+" + CONFIG.whatsapp, sameAs: [CONFIG.instagram],
  knowsAbout: ["Meta Ads", "TikTok Ads", "Snapchat Ads", "UGC Ads", "WhatsApp Marketing", "Instagram Marketing", "Facebook Ads", "Conversions API", "Performance Marketing"],
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

  // الصفحة الرئيسية
  const homeTpl = read(`src/pages/home.${lang}.html`)
    .replace("{{case_studies}}", caseStudiesHTML(lang, rootOf(`${pre}index.html`)))
    .replace("{{results}}", resultsHTML(lang))
    .replace("{{testimonials}}", testimonialsHTML(lang, rootOf(`${pre}index.html`)))
    .replaceAll("{{work_link}}", publishedCases(lang).length ? "#work" : publishedStats().length ? "#results" : "#services")
    .replaceAll("{{work_label}}", esc(publishedCases(lang).length || publishedStats().length ? t.work_cases : t.work_services))
    .replace("{{pricing}}", pricingHTML(lang))
    .replace("{{entry_offer}}", entryOfferHTML(lang, pre))
    .replace(/\{\{svc:([\w-]+)\}\}/g, (_, slug) => link(`${pre}index.html`, `${pre}services/${slug}/`))
    .replace("{{faq}}", faqHTML(lang))
    .replace("{{plan_options}}", planOptions(lang));
  page({ file: `${pre}index.html`, lang, isHome: true, title: t.home_title, description: t.home_description,
    content: homeTpl, alternates: homeAlts, jsonld: [person(lang)], altUrlFile: langPrefix(other) });
  sitemap.push({ loc: pre, alts: homeAlts, priority: "1.0" });

  // المدونة
  const posts = loadPosts(lang);
  const otherPosts = loadPosts(other);
  const blogFile = `${pre}blog/index.html`;
  const cards = posts.map((p) => `
          <article class="post-card">
            <p class="post-meta"><time datetime="${esc(p.date)}">${fmtDate(p.date, lang)}</time> · ${p.minutes} ${esc(t.min_read)}${p.draft ? " · draft" : ""}</p>
            <h2><a href="${link(blogFile, `${pre}blog/${p.slug}/`)}">${esc(p.title)}</a></h2>
            <p>${esc(p.description)}</p>
            <a class="post-more" href="${link(blogFile, `${pre}blog/${p.slug}/`)}">${esc(t.read_more)}</a>
          </article>`).join("");
  page({ file: blogFile, lang, title: t.blog_title, description: t.blog_sub, bodyClass: "page-blog",
    alternates: blogAlts, altUrlFile: `${langPrefix(other)}blog/`,
    jsonld: [{ "@context": "https://schema.org", "@type": "Blog", name: t.blog_title, url: absUrl(`${pre}blog/`), inLanguage: lang }],
    content: `
  <main id="main">
    <section class="page-hero">
      <div class="container">
        <p class="kicker">${esc(t.blog_heading)}</p>
        <h1>${esc(t.blog_heading)}</h1>
        <p class="lead">${esc(t.blog_sub)}</p>
      </div>
    </section>
    <section class="section">
      <div class="container posts">${cards || `<p>${esc(t.blog_empty)}</p>`}
      </div>
    </section>
  </main>` });
  sitemap.push({ loc: `${pre}blog/`, alts: blogAlts, priority: "0.8" });

  for (const p of posts) {
    const file = `${pre}blog/${p.slug}/index.html`;
    const trans = p.translation && otherPosts.find((o) => o.slug === p.translation);
    const alts = { [lang]: `${pre}blog/${p.slug}/` };
    if (trans) alts[other] = `${langPrefix(other)}blog/${trans.slug}/`;
    page({ file, lang, title: `${p.title} | ${t.name}`, description: p.description, ogType: "article",
      bodyClass: "page-post", alternates: alts,
      robots: p.draft ? "noindex" : "index, follow",
      altUrlFile: trans ? alts[other] : `${langPrefix(other)}blog/`,
      jsonld: [{ "@context": "https://schema.org", "@type": "BlogPosting", headline: p.title, description: p.description,
        datePublished: p.date, inLanguage: lang, mainEntityOfPage: absUrl(`${pre}blog/${p.slug}/`),
        image: `${SITE}/assets/img/og-image.jpg`, author: { "@type": "Person", name: t.name, url: absUrl(pre) } }],
      content: `
  <main id="main">
    <article class="post">
      <header class="page-hero">
        <div class="container narrow">
          <a class="back" href="${link(file, `${pre}blog/`)}">${esc(t.back_to_blog)}</a>
          <h1>${esc(p.title)}</h1>
          <p class="post-meta"><time datetime="${esc(p.date)}">${fmtDate(p.date, lang)}</time> · ${p.minutes} ${esc(t.min_read)}</p>
        </div>
      </header>
      <div class="container narrow prose">
${p.html.replace(/href="\/([^"#]*)(#[^"]*)?"/g, (_, dir, hash) => `href="${link(file, dir)}${hash || ""}"`)}
      </div>
      <aside class="container narrow">
        <div class="post-cta">
          <h2>${esc(t.post_cta_title)}</h2>
          <p>${esc(t.post_cta_text)}</p>
          <a class="btn btn-accent" href="${link(file, pre)}#contact">${esc(t.cta)}</a>
        </div>
      </aside>
    </article>
  </main>` });
    if (!p.draft) sitemap.push({ loc: `${pre}blog/${p.slug}/`, alts: alts, priority: "0.7", lastmod: p.date });
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
  page({ file: idxFile, lang, title: t.svc_index_title, description: t.svc_index_sub, bodyClass: "page-services", alternates: idxAlts,
    altUrlFile: `${langPrefix(other)}services/`,
    content: `
  <main id="main">
    <section class="page-hero">
      <div class="container">
        <p class="kicker">${esc(t.svc_index_heading)}</p>
        <h1>${esc(t.svc_index_heading)}</h1>
        <p class="lead">${esc(t.svc_index_sub)}</p>
      </div>
    </section>
    <section class="section">
      <div class="container svc-index">${all.map((x) => `
        <a class="svc-tile" href="${link(idxFile, `${pre}services/${x.slug}/`)}">
          <span class="card-ic">${esc(x.icon || "◎")}</span>
          <h2>${esc(x[lang].title)}</h2>
          <p>${esc(x[lang].description)}</p>
          <span class="card-more">${esc(t.svc_more)}</span>
        </a>`).join("")}
      </div>
    </section>
  </main>` });
  sitemap.push({ loc: `${pre}services/`, alts: idxAlts, priority: "0.8" });

  for (const x of all) {
    const d = x[lang];
    const file = `${pre}services/${x.slug}/index.html`;
    const alts = Object.fromEntries(LANGS.filter((l) => x[l]).map((l) => [l, `${langPrefix(l)}services/${x.slug}/`]));
    const wa = `https://wa.me/${CONFIG.whatsapp}?text=${encodeURIComponent(`${t.svc_wa_msg} ${d.title}`)}`;
    const related = all.filter((r) => r.slug !== x.slug).slice(0, 3);
    const homeUrl = link(file, pre);
    page({ file, lang, title: d.seoTitle || `${d.title} | ${t.name}`, description: d.description, bodyClass: "page-service",
      alternates: alts, altUrlFile: alts[other] || `${langPrefix(other)}services/`, robots: x.draft ? "noindex" : "index, follow",
      jsonld: [
        { "@context": "https://schema.org", "@type": "Service", name: d.title, description: d.description, serviceType: d.title,
          areaServed: ["IQ", "Middle East"], url: absUrl(`${pre}services/${x.slug}/`), provider: { "@type": "Person", name: t.name, url: absUrl(pre) } },
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
        <nav class="crumbs" aria-label="breadcrumb"><a href="${homeUrl}">${esc(t.home)}</a><span>/</span><a href="${link(file, `${pre}services/`)}">${esc(t.svc_index_heading)}</a></nav>
        <p class="kicker">${esc(t.svc_kicker)}</p>
        <h1>${esc(d.title)}</h1>
        <p class="lead">${esc(d.intro)}</p>
        <div class="hero-actions">
          <a class="btn btn-accent" href="${homeUrl}#contact">${esc(t.cta_short)}</a>
          <a class="btn btn-ghost" href="${wa}" target="_blank" rel="noopener">${esc(t.svc_wa)}</a>
        </div>
      </div>
    </section>

    <section class="section">
      <div class="container">
        <header class="section-head"><h2>${esc(t.svc_benefits)}</h2></header>
        <ul class="svc-benefits">${(d.benefits || []).map((b) => `<li>${esc(b)}</li>`).join("")}</ul>
      </div>
    </section>

    <section class="section section-alt">
      <div class="container svc-two">
        <div>
          <h2>${esc(t.svc_fit)}</h2>
          <ul class="svc-fit">${(d.fit || []).map((f) => `<li>${esc(f)}</li>`).join("")}</ul>
        </div>
        <div>
          <h2>${esc(t.svc_steps)}</h2>
          <ol class="svc-steps">${(d.steps || []).map((st, i) => `<li><span>${String(i + 1).padStart(2, "0")}</span>${esc(st)}</li>`).join("")}</ol>
        </div>
      </div>
    </section>

    ${d.faq && d.faq.length ? `<section class="section">
      <div class="container faq-wrap">
        <header class="section-head"><h2>${esc(t.svc_faq)}</h2></header>
        <div class="faq">${d.faq.map((f) => `
          <details><summary>${esc(f.q)}</summary><p>${esc(f.a)}</p></details>`).join("")}
        </div>
      </div>
    </section>` : ""}

    <section class="section svc-cta-wrap">
      <div class="container">
        <div class="post-cta svc-cta">
          <h2>${esc(t.svc_cta_title)}</h2>
          <p>${esc(t.svc_cta_text)}</p>
          <div class="hero-actions">
            <a class="btn btn-accent" href="${homeUrl}#contact">${esc(t.cta_short)}</a>
            <a class="btn btn-ghost" href="${homeUrl}#pricing">${esc(t.svc_pricing)}</a>
          </div>
        </div>
        ${related.length ? `<h2 class="related-title">${esc(t.svc_related)}</h2>
        <div class="svc-index related">${related.map((r) => `
          <a class="svc-tile" href="${link(file, `${pre}services/${r.slug}/`)}">
            <span class="card-ic">${esc(r.icon || "◎")}</span>
            <h3>${esc(r[lang].title)}</h3>
            <span class="card-more">${esc(t.svc_more)}</span>
          </a>`).join("")}
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
  const nf = render(read("src/pages/404.ar.html"), { t, root: PREVIEW ? "" : base });
  write("404.html", nf);
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
  const strip = (h) => String(h).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  const know = {
    person: { ar: I18N.ar.name, en: I18N.en.name, role: { ar: I18N.ar.role, en: I18N.en.role } },
    contact: { whatsapp: CONFIG.whatsapp, instagram: CONFIG.instagram, site: SITE },
    langs: {},
  };
  const pricingAll = readContent("pricing.json", []);
  const faqAll = readContent("faq.json", {});
  for (const lang of LANGS) {
    const tpl = read(`src/pages/home.${lang}.html`);
    const svc = tpl.slice(tpl.indexOf('id="services"'), tpl.indexOf('id="about"'));
    const services = [...svc.matchAll(/<h3>([\s\S]*?)<\/h3>\s*<p>([\s\S]*?)<\/p>/g)].map((m) => ({ name: strip(m[1]).replace(/\s*(جديد|New)$/, ""), desc: strip(m[2]) }));
    const about = tpl.slice(tpl.indexOf('class="about-qa"'), tpl.indexOf('id="why"'));
    const why = tpl.slice(tpl.indexOf('class="why-grid"'), tpl.indexOf('id="process"'));
    know.langs[lang] = {
      services,
      about: [...about.matchAll(/<h3>([\s\S]*?)<\/h3>\s*<p>([\s\S]*?)<\/p>/g)].map((m) => `${strip(m[1])} ${strip(m[2])}`),
      why: [...why.matchAll(/<b>([\s\S]*?)<\/b><span>([\s\S]*?)<\/span>/g)].map((m) => `${strip(m[1])}: ${strip(m[2])}`),
      plans: pricingAll.filter((p) => p[lang]).map((p) => ({ name: p[lang].name, for: p[lang].for, price: p[lang].price, period: p[lang].period || "",
        features: p[lang].features || [], entry: !!p.entry, featured: !!p.featured })),
      faq: (faqAll[lang] || []).filter((f) => f.q),
      stats: readContent("stats.json", []).filter((x) => !x.draft && x.value && x[lang]).map((x) => `${x.value} ${x[lang]}`),
      cases: readContent("case-studies.json", []).filter((c) => !c.draft && c[lang]).map((c) => ({ client: c[lang].client, industry: c[lang].industry,
        goal: c[lang].goal, results: (c[lang].results || []).map((r) => `${r.value} ${r.label}`) })),
    };
  }
  write("assets/ai-knowledge.json", JSON.stringify(know));
}

// بيانات العرض التجريبي للوحة التحكم (بدون المسودات وبدون مفاتيح)
{
  const files = {}, dirs = {};
  for (const f of ["pricing.json", "faq.json", "case-studies.json", "stats.json", "testimonials.json", "services.json"]) {
    const fp = path.join(ROOT, "content", f);
    if (fs.existsSync(fp)) files[`content/${f}`] = JSON.parse(fs.readFileSync(fp, "utf8"));
  }
  const safeSettings = { ...CONFIG, supabaseUrl: "", supabaseAnonKey: "" };
  files["content/settings.json"] = safeSettings;
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
    ["مثال: علي حسن", "07701234567", "متجر إلكتروني", "300$ – 1,000$", "النمو", "instagram", "nov-offer", "new", "أريد أزيد طلبات المتجر", 2],
    ["مثال: سارة محمد", "07809876543", "عيادة أو خدمات", "أقل من 300$", "البداية", "facebook", "clinic-leads", "contacted", "", 20],
    ["مثال: مطعم البيت", "07501112233", "مطعم أو كافيه", "1,000$ – 5,000$", "التوسع", "tiktok", "food-video", "qualified", "نحتاج حملات توصيل", 50],
    ["مثال: Ahmed K.", "+971501234567", "Clothing brand", "$1,000 – $5,000", "Growth", "direct", null, "won", "Expand to Gulf market", 96],
    ["مثال: براند حيدر", "07712223344", "براند ملابس", "300$ – 1,000$", "غير محدد", "instagram", "nov-offer", "new", "", 5],
    ["مثال: نور العراق", "07723334455", "أخرى", "أقل من 300$", "البداية", "referral", null, "lost", "", 200],
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

console.log(`✓ Built ${sitemap.length} indexable pages → dist/${PREVIEW ? " (preview)" : ""}${DRAFTS ? " (with drafts)" : ""}`);
