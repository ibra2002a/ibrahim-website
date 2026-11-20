(function () {
"use strict";
const CFG = Object.assign(
{ whatsappNumber: "", whatsappGreeting: "", currency: "$", supabaseUrl: "", supabaseAnonKey: "" },
window.SITE_CONFIG || {}
);
const LANG = document.documentElement.lang === "en" ? "en" : "ar";
const STR = {
ar: {
nameErr: "اكتب اسمك من فضلك.", phoneErr: "اكتب رقم واتساب صحيح.",
msgTitle: "طلب استشارة جديد 👋", name: "الاسم", phone: "الرقم", type: "نوع النشاط",
budget: "الميزانية", plan: "الباقة", goal: "الهدف", source: "المصدر",
breakEven: (x) => `نقطة التعادل: ROAS ${x}x`,
noMargin: "أدخل هامش ربح أكبر من صفر حتى نحسب نقطة التعادل.",
noCustomers: "أدخل عدد العملاء المتوقع حتى نحسب الإيرادات وتكلفة العميل.",
profitable: "الأرقام فوق نقطة التعادل: الإيراد يغطي الإعلان ويترك ربحًا تقديريًا.",
loss: "الأرقام تحت نقطة التعادل: ارفع معدل التحويل أو متوسط السعر، أو خفّض تكلفة العميل.",
calcTitle: "طلب تحليل مجاني من الحاسبة 📊", calcPlan: "تحليل مجاني (الحاسبة)",
calcLine: (v) => `أرقامي: ميزانية $${v.budget}، متوسط السعر $${v.price}، العملاء المتوقعون ${v.customers}، هامش ${v.margin}% ← ROAS ${v.roas}، تكلفة العميل ${v.cac}`,
},
en: {
nameErr: "Please enter your name.", phoneErr: "Please enter a valid WhatsApp number.",
msgTitle: "New consultation request 👋", name: "Name", phone: "Phone", type: "Business type",
budget: "Budget", plan: "Plan", goal: "Goal", source: "Source",
breakEven: (x) => `Break-even: ${x}x ROAS`,
noMargin: "Enter a profit margin above zero to calculate break-even.",
noCustomers: "Enter the expected number of customers to calculate revenue and CAC.",
profitable: "Above break-even: revenue covers ad spend and leaves an estimated profit.",
loss: "Below break-even: lift conversion rate or average price, or lower the cost per customer.",
calcTitle: "Free analysis request from the calculator 📊", calcPlan: "Free analysis (calculator)",
calcLine: (v) => `My numbers: budget $${v.budget}, avg price $${v.price}, expected customers ${v.customers}, margin ${v.margin}% → ROAS ${v.roas}, CAC ${v.cac}`,
},
}[LANG];
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const track = (name, data) => { try { window.Track && window.Track.event(name, data); } catch (_) {} };
const waUrl = (text) =>
"https://wa.me/" + encodeURIComponent(CFG.whatsappNumber) + "?text=" + encodeURIComponent(text);
function initHeader() {
const header = $(".site-header");
if (!header) return;
let ticking = false;
const update = () => { header.classList.toggle("is-scrolled", window.scrollY > 8); ticking = false; };
window.addEventListener("scroll", () => {
if (!ticking) { ticking = true; window.requestAnimationFrame(update); }
}, { passive: true });
update();
}
function initNav() {
const toggle = $("#navToggle");
const nav = $("#nav");
if (!toggle || !nav) return;
const setOpen = (open) => {
nav.classList.toggle("open", open);
document.body.classList.toggle("nav-open", open);
toggle.setAttribute("aria-expanded", String(open));
toggle.setAttribute("aria-label", open ? toggle.dataset.labelClose : toggle.dataset.labelOpen);
};
toggle.addEventListener("click", () => setOpen(!nav.classList.contains("open")));
$$("a", nav).forEach((a) => a.addEventListener("click", () => setOpen(false)));
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && nav.classList.contains("open")) { setOpen(false); toggle.focus(); } });
window.matchMedia("(min-width: 961px)").addEventListener("change", (mq) => { if (mq.matches) setOpen(false); });
}
function initCalculator() {
const form = $("#calc");
if (!form) return;
const money = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const money2 = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const cur = CFG.currency || "$";
const num = (name) => {
const v = parseFloat(form.elements[name].value);
return Number.isFinite(v) && v >= 0 ? v : 0;
};
const paint = (range) => {
const min = parseFloat(range.min) || 0, max = parseFloat(range.max) || 100;
const p = Math.min(100, Math.max(0, ((parseFloat(range.value) - min) / (max - min)) * 100));
range.style.setProperty("--p", p + "%");
};
$$(".rf-range", form).forEach((range) => {
const input = document.getElementById(range.dataset.for);
if (!input) return;
range.value = input.value;
paint(range);
range.addEventListener("input", () => { input.value = range.value; paint(range); });
input.addEventListener("input", () => { if (input.value !== "") { range.value = input.value; paint(range); } });
});
const out = {
roas: $("#outRoas"), state: $("#roasState"), revenue: $("#outRevenue"),
cac: $("#outCac"), profit: $("#outProfit"), hint: $("#calcHint"),
liveRoas: $("#liveRoas"), liveProfit: $("#liveProfit"), // ملخص ثابت أعلى الحاسبة على الموبايل
};
const update = () => {
const budget = num("budget"), price = num("price"), customers = Math.floor(num("customers"));
const margin = Math.min(num("margin"), 100) / 100;
const revenue = price * customers;                   // الإيرادات = متوسط السعر × عدد العملاء
const roas = budget > 0 ? revenue / budget : 0;      // ROAS = الإيرادات ÷ الميزانية
const cac = customers > 0 ? budget / customers : 0;  // CAC = الميزانية ÷ عدد العملاء
const profit = revenue * margin - budget;            // الربح = (الإيرادات × الهامش) − الميزانية
const breakEven = margin > 0 ? 1 / margin : Infinity;
out.roas.textContent = roas.toFixed(2) + "x";
out.revenue.textContent = cur + money.format(revenue);
out.cac.textContent = customers > 0 ? cur + money2.format(cac) : "—";
out.profit.textContent = (profit < 0 ? "-" : "") + cur + money.format(Math.abs(profit));
out.profit.classList.toggle("neg", profit < 0);
out.state.textContent = Number.isFinite(breakEven) ? STR.breakEven(breakEven.toFixed(2)) : "";
if (out.liveRoas) out.liveRoas.textContent = out.roas.textContent;
if (out.liveProfit) { out.liveProfit.textContent = out.profit.textContent; out.liveProfit.classList.toggle("neg", profit < 0); }
if (customers === 0) out.hint.textContent = STR.noCustomers;
else if (!Number.isFinite(breakEven)) out.hint.textContent = STR.noMargin;
else out.hint.textContent = roas >= breakEven ? STR.profitable : STR.loss;
};
let used = false;
form.addEventListener("input", () => {
update();
if (!used) { used = true; track("UseCalculator", {}); }
});
form.addEventListener("submit", (e) => e.preventDefault());
update();
}
function initCaseDialogs() {
$$(".case-open[data-dialog]").forEach((btn) => {
const dlg = document.getElementById(btn.dataset.dialog);
if (!dlg) return;
btn.addEventListener("click", () => {
if (typeof dlg.showModal === "function") dlg.showModal(); else dlg.setAttribute("open", "");
document.body.classList.add("dialog-open");
track("ViewCaseStudy", { content_name: btn.dataset.dialog });
});
});
$$(".case-dialog").forEach((dlg) => {
const close = () => { if (typeof dlg.close === "function") dlg.close(); else dlg.removeAttribute("open"); document.body.classList.remove("dialog-open"); };
dlg.addEventListener("close", () => document.body.classList.remove("dialog-open"));
$$("[data-close]", dlg).forEach((el) => el.addEventListener("click", close));
dlg.addEventListener("click", (e) => { if (e.target === dlg) close(); }); // الضغط على الخلفية
});
}
function initBlogFilter() {
const chips = $$(".cat-filter .chip");
const posts = $$("#posts .post-card");
if (!chips.length || !posts.length) return;
chips.forEach((chip) => chip.addEventListener("click", () => {
const cat = chip.dataset.cat || "";
chips.forEach((c) => { const on = c === chip; c.classList.toggle("is-active", on); c.setAttribute("aria-pressed", String(on)); });
posts.forEach((p) => { p.hidden = Boolean(cat) && p.dataset.cat !== cat; });
}));
}
function initPlanLinks() {
const select = $("#f-plan");
if (!select) return;
$$("[data-plan]").forEach((btn) =>
btn.addEventListener("click", () => {
const want = btn.dataset.plan;
const opt = Array.from(select.options).find((o) => o.value === want || o.textContent.trim() === want);
if (opt) select.value = opt.value;
track("SelectPlan", { content_name: want });
})
);
}
async function saveLead(lead) {
if (!CFG.supabaseUrl || !CFG.supabaseAnonKey) return false;
try {
const res = await fetch(CFG.supabaseUrl.replace(/\/$/, "") + "/rest/v1/leads", {
method: "POST",
headers: {
"Content-Type": "application/json",
apikey: CFG.supabaseAnonKey,
Authorization: "Bearer " + CFG.supabaseAnonKey,
Prefer: "return=minimal",
},
body: JSON.stringify(lead),
keepalive: true,
});
return res.ok;
} catch (_) { return false; } // ما نوقف تجربة المستخدم إذا فشل الحفظ
}
function initLeadForm() {
const form = $("#leadForm");
if (!form) return;
const clean = (s, max = 600) => String(s || "").replace(/[<>]/g, "").trim().slice(0, max);
const setError = (input, msg) => {
const field = input.closest(".field");
field.classList.toggle("invalid", Boolean(msg));
$(".err", field).textContent = msg || "";
};
const validate = () => {
let ok = true;
const { name, phone } = form.elements;
if (clean(name.value).length < 2) { setError(name, STR.nameErr); ok = false; } else setError(name, "");
const digits = phone.value.replace(/[^\d+]/g, "");
if (!/^\+?\d{8,15}$/.test(digits)) { setError(phone, STR.phoneErr); ok = false; } else setError(phone, "");
return ok;
};
form.addEventListener("submit", (e) => {
e.preventDefault();
form.dataset.touched = "1";
if (form.elements.website.value) return; // honeypot: بوت
if (!validate()) {
const bad = $(".field.invalid input", form);
if (bad) bad.focus();
return;
}
const el = form.elements;
const attr = (window.Track && window.Track.attribution()) || {};
const lead = {
name: clean(el.name.value, 80),
phone: clean(el.phone.value, 20),
business_type: clean(el.type.value, 60),
budget: clean(el.budget.value, 40),
plan: clean(el.plan.value, 40),
message: clean(el.message.value, 600),
lang: LANG,
source: attr.utm_source || (document.referrer ? "referral" : "direct"),
campaign: attr.utm_campaign || null,
attribution: Object.keys(attr).length ? attr : null,
};
saveLead(lead);
track("Lead", { content_category: lead.business_type, content_name: lead.plan });
const text = [
STR.msgTitle,
`${STR.name}: ${lead.name}`,
`${STR.phone}: ${lead.phone}`,
lead.business_type ? `${STR.type}: ${lead.business_type}` : "",
lead.budget ? `${STR.budget}: ${lead.budget}` : "",
lead.plan ? `${STR.plan}: ${lead.plan}` : "",
lead.message ? `${STR.goal}: ${lead.message}` : "",
attr.utm_source ? `${STR.source}: ${[attr.utm_source, attr.utm_campaign].filter(Boolean).join(" / ")}` : "",
].filter(Boolean).join("\n");
const url = waUrl(text);
$("#waLink").href = url;
$("#formSuccess").hidden = false;
try { window.open(url, "_blank", "noopener"); } catch (_) {}
});
["name", "phone"].forEach((n) =>
form.elements[n].addEventListener("blur", () => form.dataset.touched && validate())
);
}
function initCalcLead() {
const box = $("#calcLead"), calc = $("#calc");
if (!box || !calc) return;
const btn = $("#cl-send"), err = $("#cl-err");
btn.addEventListener("click", () => {
const name = String($("#cl-name").value || "").replace(/[<>]/g, "").trim().slice(0, 80);
const phone = String($("#cl-phone").value || "").replace(/[<>]/g, "").trim().slice(0, 20);
err.textContent = "";
if (name.length < 2) { err.textContent = STR.nameErr; return $("#cl-name").focus(); }
if (!/^\+?\d{8,15}$/.test(phone.replace(/[^\d+]/g, ""))) { err.textContent = STR.phoneErr; return $("#cl-phone").focus(); }
const v = (n) => calc.elements[n].value || "0";
const line = STR.calcLine({
budget: v("budget"), price: v("price"), customers: v("customers"), margin: v("margin"),
roas: $("#outRoas").textContent, cac: $("#outCac").textContent,
});
const attr = (window.Track && window.Track.attribution()) || {};
saveLead({ name, phone, business_type: null, budget: "$" + v("budget"), plan: STR.calcPlan, message: line, lang: LANG,
source: attr.utm_source || "calculator", campaign: attr.utm_campaign || null, attribution: Object.keys(attr).length ? attr : null });
track("Lead", { content_category: "calculator", content_name: STR.calcPlan });
const url = waUrl([STR.calcTitle, `${STR.name}: ${name}`, `${STR.phone}: ${phone}`, line].join("\n"));
$("#cl-wa").href = url;
$("#cl-ok").hidden = false;
try { window.open(url, "_blank", "noopener"); } catch (_) {}
});
}
function initMobileCta() {
const bar = $("#mobileCta");
if (!bar || !("IntersectionObserver" in window)) return;
const targets = [$("#contact"), $(".hero-actions"), $(".cta-box")].filter(Boolean);
const visible = new Set();
const io = new IntersectionObserver((entries) => {
entries.forEach((e) => (e.isIntersecting ? visible.add(e.target) : visible.delete(e.target)));
bar.classList.toggle("hide", visible.size > 0); // نخفيه إذا أزرار الحجز ظاهرة أصلًا
}, { threshold: 0.15 });
targets.forEach((t) => io.observe(t));
}
function initWhatsAppLinks() {
if (!CFG.whatsappNumber) return;
const greet = LANG === "en" ? CFG.whatsappGreetingEn || CFG.whatsappGreeting : CFG.whatsappGreeting;
if (!greet) return;
$$('#waFloat, .mobile-cta a[href*="wa.me/"]').forEach((a) => { a.href = waUrl(greet); });
}
function initReveal() {
if (!("IntersectionObserver" in window)) return;
if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
const sel = [
".section-head", ".stats", ".about-media", ".about-body", ".why-grid li", ".svc-card", ".svc-more",
".timeline li", ".case", ".sectors li", ".calc-inputs", ".calc-results", ".calc-lead", ".offer", ".plan",
".testi", ".faq details", ".post-card", ".cta-box", ".contact-copy", ".form",
".svc-tile", ".svc-benefits li", ".svc-fit li", ".svc-steps li", ".post-cta",
].join(",");
const els = $$(sel).filter((el) => !el.closest(".hero, .case-dialog, .ai-panel"));
els.forEach((el) => {
const sibs = el.parentElement ? Array.from(el.parentElement.children).filter((c) => c.matches(sel)) : [];
const i = sibs.indexOf(el) % 4;
el.classList.add("reveal");
if (i > 0) el.classList.add("d" + i);
});
const io = new IntersectionObserver(
(entries) => entries.forEach((en) => {
if (en.isIntersecting) { en.target.classList.add("in"); io.unobserve(en.target); }
}),
{ threshold: 0.1, rootMargin: "0px 0px -30px 0px" }
);
els.forEach((el) => io.observe(el));
}
document.addEventListener("DOMContentLoaded", () => {
const y = $("#year");
if (y) y.textContent = new Date().getFullYear();
initHeader();
initNav();
initCalculator();
initCaseDialogs();
initBlogFilter();
initPlanLinks();
initLeadForm();
initWhatsAppLinks();
initCalcLead();
initMobileCta();
initReveal();
});
})();
