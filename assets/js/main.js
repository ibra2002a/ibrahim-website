/**
 * main.js — القائمة، الحاسبة، نموذج التواصل (واتساب + قاعدة البيانات)، الأنيميشن
 * كل وحدة تتحقق من وجود عناصرها، فتشتغل بأي صفحة بأمان.
 * النصوص بالعربي والإنكليزي حسب <html lang>.
 */
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
      msgTitle: "طلب استشارة جديد 👋", name: "الاسم", phone: "الرقم", type: "نوع المشروع",
      budget: "الميزانية", plan: "الباقة", goal: "الهدف", source: "المصدر",
      noMargin: "أدخل هامش ربح أكبر من صفر حتى نحسب نقطة التعادل.",
      profitable: (x) => `✓ حملتك رابحة. نقطة التعادل عندك ROAS ${x}x.`,
      loss: (x) => `تحتاج ROAS لا يقل عن ${x}x حتى تغطي تكلفة الإعلان. خفض تكلفة الطلب هو المفتاح.`,
    },
    en: {
      nameErr: "Please enter your name.", phoneErr: "Please enter a valid WhatsApp number.",
      msgTitle: "New consultation request 👋", name: "Name", phone: "Phone", type: "Business type",
      budget: "Budget", plan: "Plan", goal: "Goal", source: "Source",
      noMargin: "Enter a profit margin above zero to calculate break-even.",
      profitable: (x) => `✓ Profitable. Your break-even ROAS is ${x}x.`,
      loss: (x) => `You need at least ${x}x ROAS to cover ad spend. Lowering your CPA is the key.`,
    },
  }[LANG];

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const track = (name, data) => { try { window.Track && window.Track.event(name, data); } catch (_) {} };
  const waUrl = (text) =>
    "https://wa.me/" + encodeURIComponent(CFG.whatsappNumber) + "?text=" + encodeURIComponent(text);

  /* ---------- القائمة على الموبايل ---------- */
  function initNav() {
    const toggle = $("#navToggle");
    const nav = $("#nav");
    if (!toggle || !nav) return;
    const setOpen = (open) => {
      nav.classList.toggle("open", open);
      toggle.setAttribute("aria-expanded", String(open));
      toggle.setAttribute("aria-label", open ? toggle.dataset.labelClose : toggle.dataset.labelOpen);
    };
    toggle.addEventListener("click", () => setOpen(!nav.classList.contains("open")));
    $$("a", nav).forEach((a) => a.addEventListener("click", () => setOpen(false)));
    document.addEventListener("keydown", (e) => e.key === "Escape" && setOpen(false));
  }

  /* ---------- حاسبة العائد ---------- */
  function initCalculator() {
    const form = $("#calc");
    if (!form) return;
    const fmt = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
    const num = (name) => {
      const v = parseFloat(form.elements[name].value);
      return Number.isFinite(v) && v >= 0 ? v : 0;
    };
    const update = () => {
      const budget = num("budget"), cpa = num("cpa"), aov = num("aov");
      const margin = Math.min(num("margin"), 100) / 100;
      const orders = cpa > 0 ? Math.floor(budget / cpa) : 0;
      const revenue = orders * aov;
      const roas = budget > 0 ? revenue / budget : 0;
      const profit = revenue * margin - budget;
      const breakEven = margin > 0 ? 1 / margin : Infinity;

      $("#outOrders").textContent = fmt.format(orders);
      $("#outRevenue").textContent = CFG.currency + fmt.format(revenue);
      $("#outRoas").textContent = roas.toFixed(2) + "x";
      $("#outProfit").textContent = (profit < 0 ? "-" : "") + CFG.currency + fmt.format(Math.abs(profit));
      $("#outProfit").classList.toggle("neg", profit < 0);

      const hint = $("#calcHint");
      if (!Number.isFinite(breakEven)) hint.textContent = STR.noMargin;
      else hint.textContent = roas >= breakEven ? STR.profitable(breakEven.toFixed(2)) : STR.loss(breakEven.toFixed(2));
    };
    let used = false;
    form.addEventListener("input", () => {
      update();
      if (!used) { used = true; track("UseCalculator", {}); }
    });
    form.addEventListener("submit", (e) => e.preventDefault());
    update();
  }

  /* ---------- اختيار الباقة يعبّي النموذج ---------- */
  function initPlanLinks() {
    const select = $("#f-plan");
    if (!select) return;
    $$("[data-plan]").forEach((btn) =>
      btn.addEventListener("click", () => {
        select.value = btn.dataset.plan;
        track("SelectPlan", { content_name: btn.dataset.plan });
      })
    );
  }

  /* ---------- حفظ الطلب في Supabase ---------- */
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

  /* ---------- نموذج التواصل ---------- */
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
      if (!validate()) return;

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
        `${STR.type}: ${lead.business_type}`,
        `${STR.budget}: ${lead.budget}`,
        `${STR.plan}: ${lead.plan}`,
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

  /* ---------- زر الواتساب العائم ---------- */
  function initWhatsAppFloat() {
    const btn = $("#waFloat");
    if (!btn || !CFG.whatsappNumber) return;
    btn.href = waUrl(LANG === "en" ? CFG.whatsappGreetingEn || CFG.whatsappGreeting : CFG.whatsappGreeting);
    btn.target = "_blank";
    btn.rel = "noopener";
  }

  /* ---------- أنيميشن الظهور عند التمرير ---------- */
  function initReveal() {
    if (!("IntersectionObserver" in window)) return;
    const els = $$(".section-head, .about-card, .about-points li, .card, .steps li, .case, .plan, .faq details, .calc, .form, .post-card");
    els.forEach((el) => el.classList.add("reveal"));
    const io = new IntersectionObserver(
      (entries) => entries.forEach((en) => {
        if (en.isIntersecting) { en.target.classList.add("in"); io.unobserve(en.target); }
      }),
      { threshold: 0.12, rootMargin: "0px 0px -40px 0px" }
    );
    els.forEach((el) => io.observe(el));
  }

  document.addEventListener("DOMContentLoaded", () => {
    const y = $("#year");
    if (y) y.textContent = new Date().getFullYear();
    initNav();
    initCalculator();
    initPlanLinks();
    initLeadForm();
    initWhatsAppFloat();
    initReveal();
  });
})();
