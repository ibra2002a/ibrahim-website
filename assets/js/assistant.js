/**
 * assistant.js — مساعد المحادثة بالموقع
 *
 * وضعين:
 *  - موجّه (افتراضي، مجاني): يعرف الخدمات والباقات والأسئلة من assets/ai-knowledge.json،
 *    يختار الباقة المناسبة بثلاث أسئلة، ويحوّل للحجز أو الواتساب.
 *  - AI: إذا انضاف "رابط المساعد الذكي" بالإعدادات (Cloudflare Worker)، الأسئلة الحرة تروح للذكاء الاصطناعي.
 */
(function () {
  "use strict";
  const CFG = window.SITE_CONFIG || {};
  const LANG = document.documentElement.lang === "en" ? "en" : "ar";
  const AI_URL = (CFG.aiEndpoint || "").trim();
  const MAX_AI_TURNS = 15;

  const T = {
    ar: {
      title: "مساعد إبراهيم", statusGuided: "يرد فورًا", statusAI: "مساعد ذكي (AI) · يرد فورًا",
      hello: (n) => `هلا! 👋 أنا مساعد <b>${n}</b>.<br>أعرفك على الخدمات، أساعدك تختار الباقة المناسبة، أو أجاوب على أسئلتك.`,
      menu: { services: "شنو الخدمات؟", finder: "أي باقة تناسبني؟", prices: "الأسعار", about: "منو إبراهيم؟", book: "احجز استشارة مجانية" },
      placeholder: "اكتب سؤالك…", send: "إرسال", close: "إغلاق", open: "اسأل المساعد",
      servicesIntro: "هذي الخدمات اللي يقدمها إبراهيم:", pricesIntro: "الباقات والأسعار (بدون الميزانية الإعلانية):",
      once: "لمرة وحدة", more: "شنو تحب تعرف بعد؟",
      q1: "شنو نوع مشروعك؟", types: ["متجر إلكتروني", "مطعم أو كافيه", "عيادة أو خدمات", "براند ملابس", "أخرى"],
      q2: "وين وصلت بالإعلانات؟", stages: { new: "بعدني ما بديت", weak: "عندي إعلانات بس النتائج ضعيفة", grow: "أبيع وأريد أكبر" },
      q3: "شكد ميزانيتك الإعلانية الشهرية تقريبًا؟", budgets: ["أقل من 300$", "300$ – 1,000$", "1,000$ – 5,000$", "أكثر من 5,000$"],
      recIntro: "حسب أجوبتك، أنصحك بـ:", recAuditNote: "نبدي بفحص حسابك ونعرف وين المشكلة بالضبط، وبعدها Growth غالبًا هي الخطوة الجاية.",
      bookThis: "احجز هذي الباقة", askWa: "اسأل إبراهيم بالواتساب", restart: "ابدأ من جديد", backMenu: "القائمة",
      noAnswer: "سؤال حلو! 🙏 هذا الأفضل يجاوبك عليه إبراهيم بنفسه حتى يكون الجواب دقيق.", sendQ: "أرسل سؤالي لإبراهيم",
      booking: "تمام! نزلتك لنموذج الحجز ✍️ عبّي اسمك ورقمك وتوصلك الرسالة على الواتساب.",
      aiError: "صار خلل بالاتصال بالمساعد الذكي. جرب مرة ثانية، أو اسأل إبراهيم مباشرة.",
      aiLimit: "وصلنا لحد الأسئلة بهذي الجلسة 🙏 كمّل وية إبراهيم مباشرة على الواتساب.",
      typing: "يكتب…", waIntro: "هلا إبراهيم، عندي سؤال من الموقع:", waFinder: "هلا إبراهيم، استخدمت مساعد الموقع:",
      lblType: "نوع المشروع", lblStage: "المرحلة", lblBudget: "الميزانية", lblRec: "الباقة المقترحة",
      disclaimer: "المساعد يعطي معلومات عامة؛ التفاصيل النهائية مع إبراهيم.",
    },
    en: {
      title: "Ibrahim's assistant", statusGuided: "Replies instantly", statusAI: "AI assistant · replies instantly",
      hello: (n) => `Hi! 👋 I'm <b>${n}</b>'s assistant.<br>I can walk you through the services, help you pick a plan, or answer your questions.`,
      menu: { services: "What services?", finder: "Which plan fits me?", prices: "Pricing", about: "Who is Ibrahim?", book: "Book a free consultation" },
      placeholder: "Type your question…", send: "Send", close: "Close", open: "Ask the assistant",
      servicesIntro: "Here's what Ibrahim offers:", pricesIntro: "Plans and pricing (ad spend not included):",
      once: "one-time", more: "What else would you like to know?",
      q1: "What kind of business do you have?", types: ["E-commerce store", "Restaurant or café", "Clinic or services", "Clothing brand", "Other"],
      q2: "Where are you with ads?", stages: { new: "Haven't started yet", weak: "Running ads, weak results", grow: "Selling and want to scale" },
      q3: "Roughly what's your monthly ad budget?", budgets: ["Under $300", "$300 – $1,000", "$1,000 – $5,000", "Over $5,000"],
      recIntro: "Based on your answers, I'd suggest:", recAuditNote: "Let's audit your account first to find exactly what's wrong; Growth is usually the next step after that.",
      bookThis: "Book this plan", askWa: "Ask Ibrahim on WhatsApp", restart: "Start over", backMenu: "Menu",
      noAnswer: "Good question! 🙏 That's best answered by Ibrahim himself so you get an accurate answer.", sendQ: "Send my question to Ibrahim",
      booking: "Great! I've taken you to the booking form ✍️ Add your name and number and it'll open in WhatsApp.",
      aiError: "Couldn't reach the AI assistant. Try again, or ask Ibrahim directly.",
      aiLimit: "We've hit this session's question limit 🙏 Please continue with Ibrahim on WhatsApp.",
      typing: "Typing…", waIntro: "Hi Ibrahim, I have a question from your website:", waFinder: "Hi Ibrahim, I used your website assistant:",
      lblType: "Business", lblStage: "Stage", lblBudget: "Budget", lblRec: "Suggested plan",
      disclaimer: "General info only; final details with Ibrahim.",
    },
  }[LANG];

  const $ = (s, r = document) => r.querySelector(s);
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const track = (n, d) => { try { window.Track && window.Track.event(n, d); } catch (_) {} };
  const waUrl = (text) => `https://wa.me/${encodeURIComponent(CFG.whatsappNumber || "")}?text=${encodeURIComponent(text)}`;

  let K = null;          // المعرفة لهذي اللغة
  let KNOW = null;
  const history = [];    // لوضع AI
  let aiTurns = 0;
  let finder = {};
  let opened = false;

  /* ---------- تحميل المعرفة ---------- */
  async function loadKnowledge() {
    if (K) return;
    const base = (document.querySelector('script[src*="assistant.js"]') || {}).src || "";
    const url = base.replace(/js\/assistant\.js.*$/, "ai-knowledge.json");
    try { KNOW = await (await fetch(url)).json(); K = KNOW.langs[LANG]; }
    catch (_) { KNOW = { person: { ar: "إبراهيم المهاوش", en: "Ibrahim Al-Mahawish" } }; K = { services: [], plans: [], faq: [], about: [], why: [], stats: [], cases: [] }; }
  }
  const personName = () => (KNOW && KNOW.person && KNOW.person[LANG]) || (LANG === "ar" ? "إبراهيم المهاوش" : "Ibrahim Al-Mahawish");

  /* ---------- الواجهة ---------- */
  const panel = () => $("#aiPanel");
  const msgs = () => $("#aiMsgs");
  function scroll() { const m = msgs(); m.scrollTop = m.scrollHeight; }

  function say(html, chips) {
    const div = document.createElement("div");
    div.className = "ai-msg bot";
    div.innerHTML = html;
    msgs().appendChild(div);
    setChips(chips || []);
    scroll();
  }
  function userSay(text) {
    const div = document.createElement("div");
    div.className = "ai-msg me";
    div.textContent = text;
    msgs().appendChild(div);
    scroll();
  }
  function setChips(chips) {
    const box = $("#aiChips");
    box.innerHTML = "";
    chips.forEach((c) => {
      const el = c.href ? document.createElement("a") : document.createElement("button");
      el.className = "ai-chip" + (c.primary ? " primary" : "");
      el.textContent = c.label;
      if (c.href) { el.href = c.href; el.target = "_blank"; el.rel = "noopener"; el.addEventListener("click", () => track("Contact", { method: "whatsapp", location: "assistant" })); }
      else { el.type = "button"; el.addEventListener("click", () => { userSay(c.label); setChips([]); setTimeout(c.run, 250); }); }
      box.appendChild(el);
    });
  }
  function typing(on) {
    let t = $("#aiTyping");
    if (on && !t) { t = document.createElement("div"); t.id = "aiTyping"; t.className = "ai-msg bot typing"; t.innerHTML = "<span></span><span></span><span></span>"; msgs().appendChild(t); scroll(); }
    if (!on && t) t.remove();
  }

  const menuChips = () => [
    { label: T.menu.finder, run: startFinder, primary: true },
    { label: T.menu.services, run: showServices },
    { label: T.menu.prices, run: showPrices },
    { label: T.menu.about, run: showAbout },
    { label: T.menu.book, run: book },
  ];
  const endChips = (extraWa) => [
    { label: T.menu.book, run: book, primary: true },
    { label: T.askWa, href: waUrl(extraWa || T.waIntro) },
    { label: T.backMenu, run: () => say(T.more, menuChips()) },
  ];

  /* ---------- الأجوبة الموجّهة ---------- */
  function showServices() {
    const items = (K.services || []).map((s) => `<li><b>${esc(s.name)}</b><br><span>${esc(s.desc)}</span></li>`).join("");
    say(`${T.servicesIntro}<ul class="ai-list">${items}</ul>`, [{ label: T.menu.finder, run: startFinder, primary: true }, { label: T.menu.prices, run: showPrices }, { label: T.menu.book, run: book }]);
  }
  function planLine(p) {
    return `<div class="ai-plan${p.featured ? " hot" : ""}"><b>${esc(p.name)}</b> — <span class="ai-price">${esc(p.price)}</span> ${esc(p.period || "")}<br><small>${esc(p.for || "")}</small></div>`;
  }
  function showPrices() {
    say(`${T.pricesIntro}${(K.plans || []).map(planLine).join("")}`, [{ label: T.menu.finder, run: startFinder, primary: true }, ...endChips().slice(0, 2)]);
  }
  function showAbout() {
    const a = (K.about || []).map((x) => `<p>${esc(x)}</p>`).join("");
    const w = (K.why || []).slice(0, 4).map((x) => `<li>${esc(x)}</li>`).join("");
    say(`${a}${w ? `<ul class="ai-list compact">${w}</ul>` : ""}`, [{ label: T.menu.services, run: showServices }, ...endChips().slice(0, 2)]);
  }

  /* ---------- اختيار الباقة (3 أسئلة) ---------- */
  function startFinder() {
    finder = {};
    say(T.q1, T.types.map((t, i) => ({ label: t, run: () => { finder.type = i; askStage(); } })));
  }
  function askStage() {
    say(T.q2, Object.entries(T.stages).map(([k, v]) => ({ label: v, run: () => { finder.stage = k; askBudget(); } })));
  }
  function askBudget() {
    say(T.q3, T.budgets.map((b, i) => ({ label: b, run: () => { finder.budget = i; recommend(); } })));
  }
  function pickPlan() {
    const plans = K.plans || [];
    const regular = plans.filter((p) => !p.entry);
    const audit = plans.find((p) => p.entry);
    const starter = regular[0], growth = regular.find((p) => p.featured) || regular[1] || starter, scale = regular[regular.length - 1];
    const { stage, budget } = finder;
    if (budget >= 3) return { plan: scale };
    if (stage === "weak" && audit) return { plan: audit, note: T.recAuditNote };
    if (stage === "new") return { plan: budget >= 2 ? growth : starter };
    return { plan: budget === 0 ? starter : growth };
  }
  function recommend() {
    const { plan, note } = pickPlan();
    if (!plan) return say(T.noAnswer, endChips());
    finder.plan = plan.name;
    const feats = (plan.features || []).slice(0, 4).map((f) => `<li>${esc(f)}</li>`).join("");
    const summary = [T.waFinder, `${T.lblType}: ${T.types[finder.type]}`, `${T.lblStage}: ${T.stages[finder.stage]}`, `${T.lblBudget}: ${T.budgets[finder.budget]}`, `${T.lblRec}: ${plan.name}`].join("\n");
    say(`${T.recIntro}${planLine(plan)}<ul class="ai-list compact">${feats}</ul>${note ? `<p class="ai-note">${esc(note)}</p>` : ""}`, [
      { label: T.bookThis, run: () => book(plan.name), primary: true },
      { label: T.askWa, href: waUrl(summary) },
      { label: T.restart, run: startFinder },
    ]);
    track("SelectPlan", { content_name: plan.name, source: "assistant" });
  }

  /* ---------- الحجز ---------- */
  function book(planName) {
    const form = $("#leadForm");
    if (!form) { location.href = (document.querySelector('a[href$="#contact"]') || {}).href || "#contact"; return; }
    if (typeof planName === "string") {
      const sel = form.elements.plan; if (sel && [...sel.options].some((o) => o.text === planName)) sel.value = planName;
    }
    if (finder.type != null && form.elements.type && form.elements.type.options[finder.type]) form.elements.type.selectedIndex = finder.type;
    if (finder.budget != null && form.elements.budget && form.elements.budget.options[finder.budget]) form.elements.budget.selectedIndex = finder.budget;
    say(T.booking, []);
    setTimeout(() => { closePanel(); $("#contact").scrollIntoView({ behavior: "smooth" }); setTimeout(() => form.elements.name && form.elements.name.focus({ preventScroll: true }), 700); }, 900);
  }

  /* ---------- الأسئلة الحرة ---------- */
  const norm = (s) => String(s).toLowerCase().replace(/[ً-ْـ]/g, "").replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي").replace(/[^\p{L}\p{N}\s]/gu, " ");
  // أسماء المنصات والخدمات مثل ما يكتبها الناس بالعربي
  const ALIASES = [[/سناب( ?شات)?/g, " snapchat "], [/تيك ?توك|تك ?توك/g, " tiktok "], [/انستا(غرام|جرام|كرام)?|فيس( ?بوك)?|ميتا/g, " meta instagram facebook "],
    [/يو ?جي ?سي/g, " ugc "], [/بكسل|بيكسل/g, " pixel بكسل "], [/لاندنج|لاندينج|صفحه هبوط/g, " صفحات الهبوط "]];
  const expand = (s) => ALIASES.reduce((acc, [re, rep]) => acc.replace(re, rep), norm(s));
  const STOP = new Set(["شكد", "شنو", "شلون", "تسوون", "تسوي", "عندكم", "عندك", "هل", "من", "في", "على", "عن", "و", "او", "ما", "اني", "انت", "هاي", "هذا", "هذي", "يعني", "the", "a", "an", "is", "are", "do", "does", "you", "i", "my", "to", "of", "and", "or", "what", "how", "can", "ads", "ad", "run", "your", "about", "اعلانات", "اعلان"]);
  const words = (s) => norm(s).split(/\s+/).filter((w) => w.length > 1 && !STOP.has(w));
  const INTENTS = [
    { re: /(سعر|اسعار|كلفه|تكلف|بكم|price|cost|how much|pricing|باقات)/, run: showPrices, first: true },
    { re: /(خدمات|خدمه|تقدم|services?|what do you do)/, run: showServices },
    { re: /(تناسب|انسب|اختار|which plan|fit me|recommend)/, run: startFinder, first: true },
    { re: /(احجز|حجز|موعد|book|meeting)/, run: () => book(), first: true },
    { re: /(منو|من انت|ابراهيم|who|about)/, run: showAbout },
  ];
  function guidedAnswer(q) {
    const n = expand(q);
    const first = INTENTS.find((i) => i.first && i.re.test(n));
    if (first) return first.run();
    // سؤال عن خدمة معيّنة؟
    const svc = (K.services || []).find((s) => words(s.name).some((w) => w.length > 2 && !/^(اعلانات|ads|اداره|management)$/.test(w) && n.includes(w)));
    // أقرب سؤال من الأسئلة الشائعة
    const qw = new Set(words(n));
    let best = null, score = 0;
    (K.faq || []).forEach((f) => {
      const fw = words(f.q), aw = words(f.a);
      const s = fw.filter((w) => qw.has(w)).length * 2 + aw.filter((w) => qw.has(w)).length * 0.5;
      if (s > score) { score = s; best = f; }
    });
    if (svc && score < 4) return say(`<b>${esc(svc.name)}</b><br>${esc(svc.desc)}`, [{ label: T.menu.prices, run: showPrices }, ...endChips(`${T.waIntro}\n${q}`).slice(0, 2)]);
    if (best && score >= 2) return say(`<b>${esc(best.q)}</b><br>${esc(best.a)}`, endChips(`${T.waIntro}\n${q}`));
    if (svc) return say(`<b>${esc(svc.name)}</b><br>${esc(svc.desc)}`, [{ label: T.menu.prices, run: showPrices }, ...endChips(`${T.waIntro}\n${q}`).slice(0, 2)]);
    const intent = INTENTS.find((i) => !i.first && i.re.test(n));
    if (intent) return intent.run();
    say(T.noAnswer, [{ label: T.sendQ, href: waUrl(`${T.waIntro}\n${q}`), primary: true }, { label: T.menu.book, run: book }, { label: T.backMenu, run: () => say(T.more, menuChips()) }]);
  }

  async function aiAnswer(q) {
    if (aiTurns >= MAX_AI_TURNS) return say(T.aiLimit, [{ label: T.askWa, href: waUrl(`${T.waIntro}\n${q}`), primary: true }]);
    aiTurns++;
    history.push({ role: "user", content: q.slice(0, 800) });
    typing(true);
    try {
      const res = await fetch(AI_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ lang: LANG, messages: history.slice(-10) }) });
      const data = await res.json().catch(() => ({}));
      typing(false);
      if (!res.ok || !data.reply) throw new Error(data.error || "ai");
      history.push({ role: "assistant", content: String(data.reply).slice(0, 2000) });
      say(formatAI(data.reply), endChips(`${T.waIntro}\n${q}`));
    } catch (_) {
      typing(false);
      history.pop(); aiTurns--;
      say(`<span class="ai-note">${esc(T.aiError)}</span>`, []);
      guidedAnswer(q);
    }
  }
  const formatAI = (t) => esc(t).replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>").replace(/^[-•]\s+(.*)$/gm, "• $1").replace(/\n/g, "<br>");

  function onSubmit(e) {
    e.preventDefault();
    const input = $("#aiInput");
    const q = input.value.trim().slice(0, 800);
    if (!q) return;
    input.value = "";
    userSay(q);
    setChips([]);
    if (AI_URL) aiAnswer(q); else { typing(true); setTimeout(() => { typing(false); guidedAnswer(q); }, 450); }
  }

  /* ---------- فتح/إغلاق ---------- */
  async function openPanel() {
    panel().hidden = false;
    document.body.classList.add("ai-open");
    $("#aiLaunch").setAttribute("aria-expanded", "true");
    if (!opened) {
      opened = true;
      await loadKnowledge();
      $("#aiStatus").textContent = AI_URL ? T.statusAI : T.statusGuided;
      say(T.hello(personName()), menuChips());
      track("AssistantOpen", {});
    }
    if (window.innerWidth > 700) setTimeout(() => $("#aiInput").focus(), 50);
  }
  function closePanel() {
    panel().hidden = true;
    document.body.classList.remove("ai-open");
    $("#aiLaunch").setAttribute("aria-expanded", "false");
  }

  document.addEventListener("DOMContentLoaded", () => {
    if (!$("#aiPanel")) return;
    $("#aiTitle").textContent = T.title;
    $("#aiInput").placeholder = T.placeholder;
    $("#aiSend").setAttribute("aria-label", T.send);
    $("#aiClose").setAttribute("aria-label", T.close);
    $("#aiDisclaimer").textContent = T.disclaimer;
    $("#aiForm").addEventListener("submit", onSubmit);
    $("#aiClose").addEventListener("click", closePanel);
    document.querySelectorAll("[data-ai-open]").forEach((b) => b.addEventListener("click", (e) => { e.preventDefault(); panel().hidden ? openPanel() : closePanel(); }));
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !panel().hidden) closePanel(); });
  });
})();
