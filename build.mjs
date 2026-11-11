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

function caseStudiesHTML(lang) {
  const file = path.join(ROOT, "content/case-studies.json");
  if (!fs.existsSync(file)) return "";
  const t = I18N[lang];
  const items = JSON.parse(fs.readFileSync(file, "utf8")).filter((c) => (DRAFTS || !c.draft) && c[lang]);
  if (!items.length) return ""; // القسم يختفي تلقائيًا إذا ماكو دراسات منشورة
  const cards = items.map((c) => {
    const d = c[lang];
    return `
          <article class="case${c.draft ? " case-draft" : ""}">
            ${c.draft ? `<span class="case-badge">${esc(t.draft_badge)}</span>` : ""}
            <div class="case-head">
              <div><h3>${esc(d.client)}</h3><p class="case-meta">${esc(d.industry)} · ${esc(d.period)}</p></div>
              <ul class="case-platforms">${(c.platforms || []).map((p) => `<li>${esc(p)}</li>`).join("")}</ul>
            </div>
            <div class="case-results">${(d.results || []).map((r) => `<div><strong>${esc(r.value)}</strong><small>${esc(r.label)}</small></div>`).join("")}</div>
            <dl class="case-body">
              <dt>${esc(t.case_challenge)}</dt><dd>${esc(d.challenge)}</dd>
              <dt>${esc(t.case_solution)}</dt><dd>${esc(d.solution)}</dd>
            </dl>
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
      </div>
    </section>`;
}

function pricingHTML(lang) {
  const file = path.join(ROOT, "content/pricing.json");
  if (!fs.existsSync(file)) return "";
  return JSON.parse(fs.readFileSync(file, "utf8")).filter((p) => p[lang]).map((p) => {
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
  knowsAbout: ["Meta Ads", "TikTok Ads", "Instagram Marketing", "Facebook Ads", "Conversions API", "Performance Marketing"],
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
    .replace("{{case_studies}}", caseStudiesHTML(lang))
    .replace("{{pricing}}", pricingHTML(lang))
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
  };
  write("assets/js/config.js", `/* يتولد تلقائيًا من content/settings.json — لا تعدله هنا */\nwindow.SITE_CONFIG = ${JSON.stringify(pub, null, 2)};\n`);
}

// بيانات العرض التجريبي للوحة التحكم (بدون المسودات وبدون مفاتيح)
{
  const files = {}, dirs = {};
  for (const f of ["pricing.json", "faq.json", "case-studies.json"]) {
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
