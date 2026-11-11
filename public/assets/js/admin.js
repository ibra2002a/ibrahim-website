/**
 * admin.js — لوحة إدارة الطلبات (Supabase REST، بدون مكتبات)
 * - إذا Supabase مو مربوط بـ config.js ← وضع تجريبي ببيانات وهمية واضحة
 * - الصلاحيات محمية بقاعدة البيانات (RLS): بس المسؤولين بجدول admins يشوفون الطلبات
 */
(function () {
  "use strict";
  const CFG = window.SITE_CONFIG || {};
  const API = (CFG.supabaseUrl || "").replace(/\/$/, "");
  const KEY = CFG.supabaseAnonKey || "";
  const DEMO = !API || !KEY;
  const SESSION_KEY = "admin_session";

  const STATUSES = [
    { id: "new", label: "جديد", color: "#7C6CFF" },
    { id: "contacted", label: "تم التواصل", color: "#3B9EFF" },
    { id: "qualified", label: "مؤهل", color: "#F5A524" },
    { id: "won", label: "تم البيع", color: "#22C55E" },
    { id: "lost", label: "خسارة", color: "#9AA0AA" },
  ];
  const S = Object.fromEntries(STATUSES.map((s) => [s.id, s]));

  const $ = (s) => document.querySelector(s);
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const state = { session: null, leads: [], status: "all", q: "", source: "" };

  /* ---------- جلسة الدخول ---------- */
  const store = {
    get() { try { return JSON.parse(localStorage.getItem(SESSION_KEY)); } catch (_) { return null; } },
    set(v) { try { v ? localStorage.setItem(SESSION_KEY, JSON.stringify(v)) : localStorage.removeItem(SESSION_KEY); } catch (_) {} },
  };

  async function auth(grant, body) {
    const res = await fetch(`${API}/auth/v1/token?grant_type=${grant}`, {
      method: "POST",
      headers: { apikey: KEY, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error_description || data.msg || "فشل تسجيل الدخول");
    return { access_token: data.access_token, refresh_token: data.refresh_token,
      expires_at: Date.now() + (data.expires_in - 60) * 1000, email: data.user && data.user.email };
  }

  async function token() {
    let s = state.session;
    if (!s) throw new Error("auth");
    if (Date.now() > s.expires_at) {
      s = await auth("refresh_token", { refresh_token: s.refresh_token });
      state.session = s; store.set(s);
    }
    return s.access_token;
  }

  async function api(path, opts = {}) {
    const res = await fetch(`${API}/rest/v1/${path}`, {
      ...opts,
      headers: { apikey: KEY, Authorization: `Bearer ${await token()}`, "Content-Type": "application/json", ...(opts.headers || {}) },
    });
    if (res.status === 401) { logout(); throw new Error("انتهت الجلسة، سجّل دخول مرة ثانية"); }
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message || "خطأ بالاتصال");
    return res.status === 204 ? null : res.json();
  }

  /* ---------- البيانات ---------- */
  async function loadLeads() {
    if (DEMO) { state.leads = demoLeads(); return; }
    state.leads = await api("leads?select=*&order=created_at.desc&limit=1000");
  }

  async function updateLead(id, patch) {
    const lead = state.leads.find((l) => l.id === id);
    const before = { ...lead };
    Object.assign(lead, patch);
    render();
    if (DEMO) { toast("وضع تجريبي: التعديل ما ينحفظ"); return; }
    try {
      await api(`leads?id=eq.${encodeURIComponent(id)}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify(patch) });
      toast("تم الحفظ ✓");
    } catch (e) {
      Object.assign(lead, before); render(); toast(e.message, true);
    }
  }

  /* ---------- العرض ---------- */
  const fmtDate = (d) => {
    const dt = new Date(d), diff = (Date.now() - dt) / 1000;
    if (diff < 3600) return `قبل ${Math.max(1, Math.round(diff / 60))} دقيقة`;
    if (diff < 86400) return `قبل ${Math.round(diff / 3600)} ساعة`;
    if (diff < 86400 * 7) return `قبل ${Math.round(diff / 86400)} يوم`;
    return dt.toLocaleDateString("ar-IQ-u-nu-latn", { day: "numeric", month: "short", year: "numeric" });
  };
  const waPhone = (p) => {
    let d = String(p).replace(/\D/g, "");
    if (d.startsWith("00")) d = d.slice(2);
    if (d.startsWith("0")) d = "964" + d.slice(1); // رقم عراقي محلي
    return d;
  };

  function filtered() {
    const q = state.q.trim().toLowerCase();
    return state.leads.filter((l) =>
      (state.status === "all" || l.status === state.status) &&
      (!state.source || (l.source || "direct") === state.source) &&
      (!q || [l.name, l.phone, l.business_type, l.campaign].some((v) => String(v || "").toLowerCase().includes(q)))
    );
  }

  // CSP تمنع style="" داخل HTML، فنطبّق الألوان والعرض عبر JS
  function applyStyles(root) {
    root.querySelectorAll("[data-w]").forEach((n) => { n.style.width = n.dataset.w + "%"; if (n.dataset.c) n.style.background = n.dataset.c; });
    root.querySelectorAll(".lead-card[data-c]").forEach((n) => n.style.setProperty("--st", n.dataset.c));
  }

  function bars(el, rows) {
    const max = Math.max(1, ...rows.map((r) => r.value));
    el.innerHTML = rows.length ? rows.map((r) => `
      <div class="bar-row">
        <span class="bar-label">${esc(r.label)}</span>
        <span class="bar-track"><span class="bar-fill" data-w="${(r.value / max) * 100}" data-c="${esc(r.color || "")}"></span></span>
        <span class="bar-val">${r.value}</span>
      </div>`).join("") : `<p class="muted">ماكو بيانات بعد</p>`;
    applyStyles(el);
  }

  function render() {
    const all = state.leads;
    const week = all.filter((l) => Date.now() - new Date(l.created_at) < 7 * 86400000).length;
    const won = all.filter((l) => l.status === "won").length;
    $("#kTotal").textContent = all.length;
    $("#kNew").textContent = all.filter((l) => l.status === "new").length;
    $("#kWeek").textContent = week;
    $("#kRate").textContent = all.length ? Math.round((won / all.length) * 100) + "%" : "0%";
    $("#kWon").textContent = `${won} عميل`;

    const bySrc = {};
    all.forEach((l) => { const k = l.source || "direct"; bySrc[k] = (bySrc[k] || 0) + 1; });
    bars($("#bySource"), Object.entries(bySrc).sort((a, b) => b[1] - a[1]).map(([label, value]) => ({ label, value })));
    bars($("#byStatus"), STATUSES.map((s) => ({ label: s.label, value: all.filter((l) => l.status === s.id).length, color: s.color })));

    // فلتر المصادر
    const sel = $("#sourceFilter");
    const cur = sel.value;
    sel.innerHTML = `<option value="">كل المصادر</option>` + Object.keys(bySrc).sort().map((s) => `<option${s === cur ? " selected" : ""}>${esc(s)}</option>`).join("");

    // chips
    $("#statusChips").innerHTML = [{ id: "all", label: "الكل" }, ...STATUSES].map((s) => {
      const n = s.id === "all" ? all.length : all.filter((l) => l.status === s.id).length;
      return `<button type="button" role="tab" class="chip${state.status === s.id ? " active" : ""}" data-status="${s.id}" aria-selected="${state.status === s.id}">${s.label} <b>${n}</b></button>`;
    }).join("");

    const list = filtered();
    $("#count").textContent = `${list.length} طلب`;
    $("#empty").hidden = list.length > 0;
    $("#leads").innerHTML = list.map((l) => {
      const st = S[l.status] || S.new;
      const wa = `https://wa.me/${waPhone(l.phone)}?text=${encodeURIComponent(`هلا ${l.name}، معك إبراهيم المهاوش بخصوص طلب الاستشارة 👋`)}`;
      return `
      <article class="lead-card" data-id="${esc(l.id)}" data-c="${st.color}">
        <div class="lead-top">
          <div>
            <h3>${esc(l.name)}</h3>
            <p class="lead-meta"><time datetime="${esc(l.created_at)}">${fmtDate(l.created_at)}</time>${l.lang === "en" ? " · EN" : ""}</p>
          </div>
          <select class="status-select" data-field="status" aria-label="الحالة">
            ${STATUSES.map((s) => `<option value="${s.id}"${s.id === l.status ? " selected" : ""}>${s.label}</option>`).join("")}
          </select>
        </div>
        <div class="lead-info">
          ${l.business_type ? `<span>${esc(l.business_type)}</span>` : ""}
          ${l.budget ? `<span>💰 ${esc(l.budget)}</span>` : ""}
          ${l.plan && !/غير محدد|Not sure/.test(l.plan) ? `<span>📦 ${esc(l.plan)}</span>` : ""}
          <span class="src">↗ ${esc(l.source || "direct")}${l.campaign ? " / " + esc(l.campaign) : ""}</span>
        </div>
        ${l.message ? `<p class="lead-msg">${esc(l.message)}</p>` : ""}
        <textarea class="lead-notes" data-field="notes" rows="2" placeholder="ملاحظاتك عن العميل…" aria-label="ملاحظات">${esc(l.notes || "")}</textarea>
        <div class="lead-actions">
          <a class="btn btn-wa btn-sm" href="${wa}" target="_blank" rel="noopener">واتساب</a>
          <span class="lead-phone" dir="ltr">${esc(l.phone)}</span>
        </div>
      </article>`;
    }).join("");
    applyStyles($("#leads"));
  }

  /* ---------- CSV ---------- */
  function toCSV() {
    const cols = ["created_at", "name", "phone", "business_type", "budget", "plan", "source", "campaign", "status", "message", "notes"];
    const q = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    return "﻿" + [cols.join(","), ...filtered().map((l) => cols.map((c) => q(l[c])).join(","))].join("\n");
  }
  function exportCSV() {
    const csv = toCSV();
    try {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
      a.download = `leads-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a); a.click(); a.remove();
      toast("تم تنزيل الملف ✓");
    } catch (_) {
      navigator.clipboard && navigator.clipboard.writeText(csv).then(() => toast("تم نسخ البيانات ✓"), () => toast("ما گدرت أصدّر الملف", true));
    }
  }

  /* ---------- واجهة ---------- */
  let toastTimer;
  function toast(msg, err) {
    const t = $("#toast");
    t.textContent = msg; t.classList.toggle("err", !!err); t.classList.add("show");
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove("show"), 2600);
  }

  function show(view) {
    $("#loginView").hidden = view !== "login";
    $("#appView").hidden = view !== "app";
  }

  async function enterApp() {
    show("app");
    $("#demoBanner").hidden = !DEMO;
    $("#userEmail").textContent = DEMO ? "عرض تجريبي" : (state.session.email || "");
    $("#logoutBtn").hidden = DEMO;
    $("#leads").innerHTML = `<p class="muted">جاري التحميل…</p>`;
    try { await loadLeads(); render(); }
    catch (e) { toast(e.message, true); }
  }

  function logout() {
    if (!DEMO && state.session) fetch(`${API}/auth/v1/logout`, { method: "POST", headers: { apikey: KEY, Authorization: `Bearer ${state.session.access_token}` } }).catch(() => {});
    state.session = null; store.set(null); show("login");
  }

  function bind() {
    $("#loginForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const f = e.target, btn = f.querySelector("button");
      $("#loginErr").textContent = "";
      btn.disabled = true;
      try {
        state.session = await auth("password", { email: f.email.value.trim(), password: f.password.value });
        store.set(state.session); f.reset(); enterApp();
      } catch (err) { $("#loginErr").textContent = err.message === "Invalid login credentials" ? "الإيميل أو كلمة المرور غلط" : err.message; }
      finally { btn.disabled = false; }
    });
    $("#logoutBtn").addEventListener("click", logout);
    $("#refreshBtn").addEventListener("click", enterApp);
    $("#exportBtn").addEventListener("click", exportCSV);
    $("#search").addEventListener("input", (e) => { state.q = e.target.value; render(); });
    $("#sourceFilter").addEventListener("change", (e) => { state.source = e.target.value; render(); });
    $("#statusChips").addEventListener("click", (e) => {
      const b = e.target.closest("[data-status]"); if (!b) return;
      state.status = b.dataset.status; render();
    });
    $("#leads").addEventListener("change", (e) => {
      const card = e.target.closest(".lead-card"); if (!card) return;
      const id = isNaN(card.dataset.id) ? card.dataset.id : Number(card.dataset.id);
      if (e.target.dataset.field === "status") updateLead(id, { status: e.target.value });
      if (e.target.dataset.field === "notes") updateLead(id, { notes: e.target.value.slice(0, 2000) || null });
    });
  }

  /* ---------- بيانات تجريبية (للعرض فقط) ---------- */
  function demoLeads() {
    const h = 3600000, now = Date.now();
    const rows = [
      ["مثال: علي حسن", "07701234567", "متجر إلكتروني", "300$ – 1,000$", "النمو", "instagram", "nov-offer", "new", "أريد أزيد طلبات المتجر", 2],
      ["مثال: سارة محمد", "07809876543", "عيادة أو خدمات", "أقل من 300$", "البداية", "facebook", "clinic-leads", "contacted", "", 20],
      ["مثال: مطعم البيت", "07501112233", "مطعم أو كافيه", "1,000$ – 5,000$", "التوسع", "tiktok", "food-video", "qualified", "نحتاج حملات توصيل", 50],
      ["مثال: Ahmed K.", "+971501234567", "Clothing brand", "$1,000 – $5,000", "Growth", "direct", null, "won", "Expand to Gulf market", 96],
      ["مثال: براند حيدر", "07712223344", "براند ملابس", "300$ – 1,000$", "غير محدد", "instagram", "nov-offer", "new", "", 5],
      ["مثال: نور العراق", "07723334455", "أخرى", "أقل من 300$", "البداية", "referral", null, "lost", "", 200],
    ];
    return rows.map((r, i) => ({ id: "demo-" + i, name: r[0], phone: r[1], business_type: r[2], budget: r[3], plan: r[4],
      source: r[5], campaign: r[6], status: r[7], message: r[8], notes: null, lang: /[a-z]/i.test(r[2]) ? "en" : "ar",
      created_at: new Date(now - r[9] * h).toISOString() }));
  }

  document.addEventListener("DOMContentLoaded", () => {
    bind();
    if (DEMO) return enterApp();
    state.session = store.get();
    state.session ? enterApp() : show("login");
  });
})();
