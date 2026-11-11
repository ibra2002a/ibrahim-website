/**
 * admin.js — لوحة التحكم الكاملة (بدون مكتبات)
 *
 * المحتوى  ← GitHub API: يقرأ ويكتب ملفات content/ بمستودع الموقع، و GitHub Actions يبني وينشر تلقائيًا.
 * الطلبات  ← Supabase REST (إذا مربوط من الإعدادات).
 * وضع تجريبي ← بيانات demo-data.js، والتعديلات ما تنحفظ.
 */
(function () {
  "use strict";

  /* =========================================================
     إعدادات وأدوات عامة
     ========================================================= */
  const CFG = window.SITE_CONFIG || {};
  const GH = Object.assign({ owner: "", repo: "", branch: "main" }, CFG.github || {});
  const DEMO_DATA = window.ADMIN_DEMO || {};
  const TOKEN_KEY = "panel_gh_token";
  const SB_KEY = "panel_sb_session";

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const LANGS = [{ id: "ar", label: "العربي" }, { id: "en", label: "English" }];

  const storage = {
    get(k) { try { return localStorage.getItem(k) ?? sessionStorage.getItem(k); } catch (_) { return null; } },
    set(k, v, remember = true) {
      try { (remember ? localStorage : sessionStorage).setItem(k, v); } catch (_) {}
    },
    del(k) { try { localStorage.removeItem(k); sessionStorage.removeItem(k); } catch (_) {} },
  };

  const state = {
    demo: false, token: null, repoInfo: null,
    view: "overview",
    files: {},            // path → { data, sha }
    leads: null, sb: null, leadFilter: { status: "all", q: "", source: "" },
    contentLang: "ar",
  };

  /* =========================================================
     GitHub API
     ========================================================= */
  const b64encode = (text) => {
    const bytes = new TextEncoder().encode(text);
    let bin = ""; bytes.forEach((b) => (bin += String.fromCharCode(b)));
    return btoa(bin);
  };
  const b64decode = (b64) => {
    const bin = atob(b64.replace(/\n/g, ""));
    return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
  };

  async function gh(path, opts = {}) {
    const res = await fetch(`https://api.github.com${path}`, {
      ...opts,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${state.token}`,
        "X-GitHub-Api-Version": "2022-11-28",
        ...(opts.body ? { "Content-Type": "application/json" } : {}),
        ...(opts.headers || {}),
      },
    });
    if (res.status === 401) throw new Error("رمز الدخول غير صالح أو منتهي");
    if (res.status === 404 && opts.allow404) return null;
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      if (res.status === 409 || res.status === 422) throw new Error("الملف تغيّر من مكان ثاني. حدّث الصفحة وجرب مرة ثانية.");
      if (res.status === 403) throw new Error("الرمز ما عنده صلاحية كافية (Contents: Read and write)");
      throw new Error(body.message || `خطأ GitHub (${res.status})`);
    }
    return res.status === 204 ? null : res.json();
  }
  const repoPath = (p) => `/repos/${GH.owner}/${GH.repo}/contents/${p.split("/").map(encodeURIComponent).join("/")}`;

  async function readFile(path, { json = true } = {}) {
    if (state.demo) {
      const d = DEMO_DATA.files && DEMO_DATA.files[path];
      return { data: json ? clone(d ?? null) : d ?? "", sha: "demo" };
    }
    const r = await gh(`${repoPath(path)}?ref=${encodeURIComponent(GH.branch)}`, { allow404: true });
    if (!r) return { data: null, sha: null };
    const text = b64decode(r.content);
    return { data: json ? JSON.parse(text) : text, sha: r.sha };
  }

  async function writeFile(path, data, message, { json = true } = {}) {
    const text = json ? JSON.stringify(data, null, 2) + "\n" : data;
    if (state.demo) { toast("وضع تجريبي: التعديل ما ينحفظ"); return; }
    const prev = state.files[path];
    const r = await gh(repoPath(path), {
      method: "PUT",
      body: JSON.stringify({ message, content: b64encode(text), branch: GH.branch, ...(prev && prev.sha ? { sha: prev.sha } : {}) }),
    });
    state.files[path] = { data: json ? clone(data) : text, sha: r.content.sha };
    toast("انحفظ ✓ الموقع يتحدث خلال دقيقتين");
    watchDeploy();
  }

  async function deleteFile(path, message) {
    if (state.demo) { toast("وضع تجريبي: الحذف ما ينحفظ"); return; }
    const prev = state.files[path] || (await readFile(path, { json: false }));
    await gh(repoPath(path), { method: "DELETE", body: JSON.stringify({ message, sha: prev.sha, branch: GH.branch }) });
    delete state.files[path];
    toast("انحذف ✓");
    watchDeploy();
  }

  async function listDir(path) {
    if (state.demo) return (DEMO_DATA.dirs && DEMO_DATA.dirs[path]) || [];
    const r = await gh(`${repoPath(path)}?ref=${encodeURIComponent(GH.branch)}`, { allow404: true });
    return (r || []).filter((f) => f.type === "file").map((f) => f.name);
  }

  async function load(path, opts) {
    if (!state.files[path]) state.files[path] = await readFile(path, opts);
    return state.files[path];
  }

  /* ---------- حالة النشر ---------- */
  let deployTimer = null;
  async function deployStatus() {
    if (state.demo) return { status: "completed", conclusion: "success", updated_at: new Date().toISOString() };
    try {
      const r = await gh(`/repos/${GH.owner}/${GH.repo}/actions/runs?branch=${encodeURIComponent(GH.branch)}&per_page=1`);
      return r.workflow_runs && r.workflow_runs[0];
    } catch (_) { return null; }
  }
  function paintDeploy(run) {
    const chip = $("#deployChip");
    if (!run) { chip.hidden = true; return; }
    chip.hidden = false;
    const busy = run.status !== "completed";
    const ok = run.conclusion === "success";
    chip.className = "deploy-chip " + (busy ? "busy" : ok ? "ok" : "fail");
    chip.textContent = busy ? "جاري النشر…" : ok ? "منشور ✓" : "فشل النشر";
    chip.title = new Date(run.updated_at).toLocaleString("ar-IQ-u-nu-latn");
    return busy;
  }
  async function watchDeploy() {
    clearTimeout(deployTimer);
    let tries = 0;
    const tick = async () => {
      const run = await deployStatus();
      const busy = paintDeploy(run);
      if ((busy || tries < 2) && tries++ < 40) deployTimer = setTimeout(tick, 8000);
    };
    deployTimer = setTimeout(tick, 4000);
  }

  /* =========================================================
     Supabase (الطلبات)
     ========================================================= */
  const SB_URL = (CFG.supabaseUrl || "").replace(/\/$/, "");
  const SB_ANON = CFG.supabaseAnonKey || "";
  const sbConfigured = () => Boolean(SB_URL && SB_ANON);

  async function sbAuth(grant, body) {
    const res = await fetch(`${SB_URL}/auth/v1/token?grant_type=${grant}`, {
      method: "POST", headers: { apikey: SB_ANON, "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(d.error_description === "Invalid login credentials" ? "الإيميل أو كلمة المرور غلط" : d.error_description || d.msg || "فشل الدخول");
    return { access_token: d.access_token, refresh_token: d.refresh_token, expires_at: Date.now() + (d.expires_in - 60) * 1000, email: d.user && d.user.email };
  }
  async function sbToken() {
    let s = state.sb;
    if (!s) throw new Error("sb-auth");
    if (Date.now() > s.expires_at) { s = await sbAuth("refresh_token", { refresh_token: s.refresh_token }); state.sb = s; storage.set(SB_KEY, JSON.stringify(s)); }
    return s.access_token;
  }
  async function sb(path, opts = {}) {
    const res = await fetch(`${SB_URL}/rest/v1/${path}`, {
      ...opts, headers: { apikey: SB_ANON, Authorization: `Bearer ${await sbToken()}`, "Content-Type": "application/json", ...(opts.headers || {}) },
    });
    if (res.status === 401) { state.sb = null; storage.del(SB_KEY); throw new Error("sb-auth"); }
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message || "خطأ بالاتصال بقاعدة البيانات");
    return res.status === 204 ? null : res.json();
  }

  async function loadLeads(force) {
    if (state.leads && !force) return state.leads;
    if (state.demo || !sbConfigured()) { state.leads = clone(DEMO_DATA.leads || []); return state.leads; }
    state.leads = await sb("leads?select=*&order=created_at.desc&limit=1000");
    return state.leads;
  }
  const leadsAreDemo = () => state.demo || !sbConfigured();

  /* =========================================================
     الواجهة العامة
     ========================================================= */
  const VIEWS = [
    { id: "overview", label: "نظرة عامة", icon: "◧" },
    { id: "leads", label: "الطلبات", icon: "☰" },
    { id: "pricing", label: "الباقات", icon: "◈" },
    { id: "cases", label: "دراسات الحالة", icon: "★" },
    { id: "blog", label: "المدونة", icon: "✎" },
    { id: "faq", label: "الأسئلة", icon: "?" },
    { id: "prefs", label: "الإعدادات", icon: "⚙" },
  ];
  const TAB_VIEWS = ["overview", "leads", "pricing", "blog", "prefs"];

  let toastTimer;
  function toast(msg, err) {
    const t = $("#toast");
    t.textContent = msg; t.classList.toggle("err", !!err); t.classList.add("show");
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove("show"), 3000);
  }
  const fail = (e) => { console.error(e); toast(e.message || "صار خطأ", true); };

  function renderNav() {
    const item = (v) => `<button type="button" class="nav-item${state.view === v.id ? " active" : ""}" data-view="${v.id}"><span class="nav-ic" aria-hidden="true">${v.icon}</span><span>${v.label}</span></button>`;
    $("#sideNav").innerHTML = VIEWS.map(item).join("");
    $("#tabBar").innerHTML = VIEWS.filter((v) => TAB_VIEWS.includes(v.id)).map(item).join("") +
      `<button type="button" class="nav-item${["cases", "faq"].includes(state.view) ? " active" : ""}" data-more><span class="nav-ic" aria-hidden="true">⋯</span><span>المزيد</span></button>`;
  }

  async function go(view) {
    state.view = view;
    renderNav();
    $("#viewTitle").textContent = VIEWS.find((v) => v.id === view).label;
    const el = $("#view");
    el._collect = null;
    el.innerHTML = `<div class="loading">جاري التحميل…</div>`;
    window.scrollTo(0, 0);
    try { await RENDER[view](el); } catch (e) { el.innerHTML = `<div class="panel"><p class="muted">${esc(e.message)}</p></div>`; fail(e); }
  }

  /* ---------- نافذة التحرير (sheet) ---------- */
  function openSheet(title, bodyHTML, actions) {
    $("#sheetTitle").textContent = title;
    $("#sheetBody").innerHTML = bodyHTML;
    $("#sheetFoot").innerHTML = actions.map((a, i) => `<button type="button" class="btn ${a.cls || "btn-outline"} btn-sm" data-act="${i}">${esc(a.label)}</button>`).join("");
    $$("#sheetFoot [data-act]").forEach((b) => b.addEventListener("click", () => actions[+b.dataset.act].run()));
    $("#sheet").hidden = false;
    document.body.classList.add("sheet-open");
    const first = $("#sheetBody input, #sheetBody textarea, #sheetBody select");
    if (first && window.innerWidth > 700) first.focus();
  }
  function closeSheet() { $("#sheet").hidden = true; document.body.classList.remove("sheet-open"); }

  const langTabs = (cur) => `<div class="seg" role="tablist">${LANGS.map((l) => `<button type="button" role="tab" class="seg-btn${cur === l.id ? " active" : ""}" data-lang="${l.id}" aria-selected="${cur === l.id}">${l.label}</button>`).join("")}</div>`;
  const field = (label, name, value, { type = "text", dir, rows, hint, placeholder } = {}) => `
    <div class="field">
      <label>${esc(label)}</label>
      ${type === "textarea"
        ? `<textarea name="${name}" rows="${rows || 3}"${dir ? ` dir="${dir}"` : ""}${placeholder ? ` placeholder="${esc(placeholder)}"` : ""}>${esc(value)}</textarea>`
        : `<input name="${name}" type="${type}" value="${esc(value)}"${dir ? ` dir="${dir}"` : ""}${placeholder ? ` placeholder="${esc(placeholder)}"` : ""}>`}
      ${hint ? `<small class="hint">${hint}</small>` : ""}
    </div>`;
  const toggle = (label, name, checked) => `<label class="switch"><input type="checkbox" name="${name}"${checked ? " checked" : ""}><span class="switch-ui"></span>${esc(label)}</label>`;
  const formData = (root) => {
    const o = {};
    $$("input, textarea, select", root).forEach((el) => { if (el.name) o[el.name] = el.type === "checkbox" ? el.checked : el.value.trim(); });
    return o;
  };

  /* =========================================================
     العروض (Views)
     ========================================================= */
  const RENDER = {};

  /* ---------- نظرة عامة ---------- */
  RENDER.overview = async (el) => {
    const [leads, posts, run] = await Promise.all([
      loadLeads().catch(() => []),
      Promise.all(LANGS.map((l) => listDir(`content/blog/${l.id}`))).then((a) => a.flat().filter((f) => f.endsWith(".md"))),
      deployStatus(),
    ]);
    paintDeploy(run);
    const week = leads.filter((l) => Date.now() - new Date(l.created_at) < 7 * 864e5).length;
    const fresh = leads.filter((l) => l.status === "new");
    const won = leads.filter((l) => l.status === "won").length;
    el.innerHTML = `
      ${leadsAreDemo() ? `<p class="note-inline">أرقام الطلبات تجريبية لحد ما تربط Supabase من <button type="button" class="link" data-goto="prefs">الإعدادات</button>.</p>` : ""}
      <section class="kpis">
        <div class="kpi"><small>طلبات جديدة</small><strong>${fresh.length}</strong><span class="kpi-sub">تحتاج تواصل</span></div>
        <div class="kpi"><small>آخر 7 أيام</small><strong>${week}</strong></div>
        <div class="kpi"><small>إجمالي الطلبات</small><strong>${leads.length}</strong></div>
        <div class="kpi kpi-accent"><small>نسبة الإغلاق</small><strong>${leads.length ? Math.round((won / leads.length) * 100) : 0}%</strong><span class="kpi-sub">${won} عميل</span></div>
      </section>

      <section class="quick">
        <button type="button" class="quick-btn" data-goto="blog" data-new-post><span>✎</span>مقال جديد</button>
        <button type="button" class="quick-btn" data-goto="pricing"><span>◈</span>تعديل الأسعار</button>
        <button type="button" class="quick-btn" data-goto="cases"><span>★</span>دراسة حالة</button>
        <a class="quick-btn" href="../" target="_blank" rel="noopener"><span>↗</span>عرض الموقع</a>
      </section>

      <section class="panels">
        <div class="panel">
          <div class="panel-head"><h2>آخر الطلبات الجديدة</h2><button type="button" class="link" data-goto="leads">الكل ←</button></div>
          ${fresh.length ? `<ul class="mini-list">${fresh.slice(0, 5).map((l) => `<li><b>${esc(l.name)}</b><span>${esc(l.business_type || "")}</span><time>${relTime(l.created_at)}</time></li>`).join("")}</ul>` : `<p class="muted">ماكو طلبات جديدة 👌</p>`}
        </div>
        <div class="panel">
          <div class="panel-head"><h2>حالة الموقع</h2></div>
          <ul class="mini-list">
            <li><b>النشر</b><span>${run ? (run.status !== "completed" ? "جاري…" : run.conclusion === "success" ? "منشور ✓" : "فشل ✕") : "—"}</span><time>${run ? relTime(run.updated_at) : ""}</time></li>
            <li><b>المقالات</b><span>${posts.length} مقال</span><time></time></li>
            <li><b>قاعدة البيانات</b><span>${sbConfigured() ? "مربوطة ✓" : "غير مربوطة"}</span><time></time></li>
            <li><b>Meta Pixel</b><span>${CFG.tracking && CFG.tracking.metaPixelId ? "مفعّل ✓" : "غير مفعّل"}</span><time></time></li>
          </ul>
        </div>
      </section>`;
  };

  /* ---------- الطلبات ---------- */
  const STATUSES = [
    { id: "new", label: "جديد", color: "#7C6CFF" },
    { id: "contacted", label: "تم التواصل", color: "#3B9EFF" },
    { id: "qualified", label: "مؤهل", color: "#F5A524" },
    { id: "won", label: "تم البيع", color: "#22C55E" },
    { id: "lost", label: "خسارة", color: "#9AA0AA" },
  ];
  const ST = Object.fromEntries(STATUSES.map((s) => [s.id, s]));
  function relTime(d) {
    const s = (Date.now() - new Date(d)) / 1000;
    if (s < 3600) return `قبل ${Math.max(1, Math.round(s / 60))} د`;
    if (s < 86400) return `قبل ${Math.round(s / 3600)} س`;
    if (s < 86400 * 7) return `قبل ${Math.round(s / 86400)} يوم`;
    return new Date(d).toLocaleDateString("ar-IQ-u-nu-latn", { day: "numeric", month: "short" });
  }
  const waPhone = (p) => { let d = String(p).replace(/\D/g, ""); if (d.startsWith("00")) d = d.slice(2); if (d.startsWith("0")) d = "964" + d.slice(1); return d; };

  RENDER.leads = async (el) => {
    if (!state.demo && sbConfigured() && !state.sb) {
      el.innerHTML = `
        <form class="panel narrow-panel" id="sbLogin">
          <h2>دخول قاعدة البيانات</h2>
          <p class="muted">سجّل بحساب Supabase اللي سويته للوحة.</p>
          ${field("الإيميل", "email", "", { type: "email", dir: "ltr" })}
          ${field("كلمة المرور", "password", "", { type: "password", dir: "ltr" })}
          <p class="login-err" id="sbErr"></p>
          <button class="btn btn-accent btn-block" type="submit">دخول</button>
        </form>`;
      $("#sbLogin").addEventListener("submit", async (e) => {
        e.preventDefault();
        const f = formData(e.target);
        try { state.sb = await sbAuth("password", f); storage.set(SB_KEY, JSON.stringify(state.sb)); go("leads"); }
        catch (err) { $("#sbErr").textContent = err.message; }
      });
      return;
    }
    try { await loadLeads(); }
    catch (e) { if (e.message === "sb-auth") return go("leads"); throw e; }
    paintLeads(el);
  };

  function paintLeads(el) {
    const all = state.leads, F = state.leadFilter;
    const bySrc = {};
    all.forEach((l) => { const k = l.source || "direct"; bySrc[k] = (bySrc[k] || 0) + 1; });
    const q = F.q.trim().toLowerCase();
    const list = all.filter((l) => (F.status === "all" || l.status === F.status) && (!F.source || (l.source || "direct") === F.source) &&
      (!q || [l.name, l.phone, l.business_type, l.campaign].some((v) => String(v || "").toLowerCase().includes(q))));
    const max = Math.max(1, ...Object.values(bySrc));

    el.innerHTML = `
      ${leadsAreDemo() ? `<p class="note-inline">بيانات تجريبية للعرض. اربط Supabase من <button type="button" class="link" data-goto="prefs">الإعدادات</button> حتى تشوف طلباتك الحقيقية.</p>` : ""}
      <section class="panels">
        <div class="panel"><h2>حسب المصدر</h2><div class="bars">${Object.entries(bySrc).sort((a, b) => b[1] - a[1]).map(([k, v]) => `
          <div class="bar-row"><span class="bar-label">${esc(k)}</span><span class="bar-track"><span class="bar-fill" data-w="${(v / max) * 100}"></span></span><span class="bar-val">${v}</span></div>`).join("") || `<p class="muted">ماكو بيانات</p>`}</div></div>
        <div class="panel"><h2>مراحل البيع</h2><div class="bars">${STATUSES.map((s) => { const v = all.filter((l) => l.status === s.id).length; return `
          <div class="bar-row"><span class="bar-label">${s.label}</span><span class="bar-track"><span class="bar-fill" data-w="${(v / Math.max(1, all.length)) * 100}" data-c="${s.color}"></span></span><span class="bar-val">${v}</span></div>`; }).join("")}</div></div>
      </section>
      <section class="panel">
        <div class="filters">
          <div class="chips">${[{ id: "all", label: "الكل" }, ...STATUSES].map((s) => `<button type="button" class="chip${F.status === s.id ? " active" : ""}" data-status="${s.id}">${s.label} <b>${s.id === "all" ? all.length : all.filter((l) => l.status === s.id).length}</b></button>`).join("")}</div>
          <div class="filter-row">
            <input type="search" id="leadSearch" placeholder="ابحث بالاسم أو الرقم…" value="${esc(F.q)}" aria-label="بحث">
            <select id="leadSource" aria-label="المصدر"><option value="">كل المصادر</option>${Object.keys(bySrc).sort().map((s) => `<option${s === F.source ? " selected" : ""}>${esc(s)}</option>`).join("")}</select>
          </div>
          <div class="row-actions"><span class="count">${list.length} طلب</span><button type="button" class="btn btn-outline btn-sm" id="csvBtn">تصدير CSV</button><button type="button" class="btn btn-outline btn-sm" id="reloadLeads">↻ تحديث</button></div>
        </div>
        <div class="leads">${list.map(leadCard).join("") || `<p class="empty">ماكو طلبات تطابق الفلتر.</p>`}</div>
      </section>`;

    $$(".bar-fill", el).forEach((n) => { n.style.width = n.dataset.w + "%"; if (n.dataset.c) n.style.background = n.dataset.c; });
    $$(".lead-card", el).forEach((n) => n.style.setProperty("--st", (ST[n.dataset.status] || ST.new).color));
    $$("[data-status]", el).forEach((b) => b.addEventListener("click", () => { F.status = b.dataset.status; paintLeads(el); }));
    $("#leadSearch").addEventListener("input", (e) => { F.q = e.target.value; const pos = e.target.selectionStart; paintLeads(el); const s = $("#leadSearch"); s.focus(); s.setSelectionRange(pos, pos); });
    $("#leadSource").addEventListener("change", (e) => { F.source = e.target.value; paintLeads(el); });
    $("#csvBtn").addEventListener("click", () => exportCSV(list));
    $("#reloadLeads").addEventListener("click", async () => { await loadLeads(true).catch(fail); paintLeads(el); });
    $$(".lead-card", el).forEach((card) => card.addEventListener("change", (e) => {
      const f = e.target.dataset.field; if (!f) return;
      updateLead(card.dataset.id, { [f]: f === "notes" ? e.target.value.slice(0, 2000) || null : e.target.value }, el);
    }));
  }

  function leadCard(l) {
    const wa = `https://wa.me/${waPhone(l.phone)}?text=${encodeURIComponent(`هلا ${l.name}، معك إبراهيم المهاوش بخصوص طلب الاستشارة 👋`)}`;
    return `
      <article class="lead-card" data-id="${esc(l.id)}" data-status="${esc(l.status)}">
        <div class="lead-top">
          <div><h3>${esc(l.name)}</h3><p class="lead-meta"><time>${relTime(l.created_at)}</time>${l.lang === "en" ? " · EN" : ""}</p></div>
          <select class="status-select" data-field="status" aria-label="الحالة">${STATUSES.map((s) => `<option value="${s.id}"${s.id === l.status ? " selected" : ""}>${s.label}</option>`).join("")}</select>
        </div>
        <div class="lead-info">
          ${l.business_type ? `<span>${esc(l.business_type)}</span>` : ""}
          ${l.budget ? `<span>💰 ${esc(l.budget)}</span>` : ""}
          ${l.plan && !/غير محدد|Not sure/.test(l.plan) ? `<span>📦 ${esc(l.plan)}</span>` : ""}
          <span class="src">↗ ${esc(l.source || "direct")}${l.campaign ? " / " + esc(l.campaign) : ""}</span>
        </div>
        ${l.message ? `<p class="lead-msg">${esc(l.message)}</p>` : ""}
        <textarea class="lead-notes" data-field="notes" rows="2" placeholder="ملاحظاتك عن العميل…" aria-label="ملاحظات">${esc(l.notes || "")}</textarea>
        <div class="lead-actions"><a class="btn btn-wa btn-sm" href="${wa}" target="_blank" rel="noopener">واتساب</a><span class="lead-phone" dir="ltr">${esc(l.phone)}</span></div>
      </article>`;
  }

  async function updateLead(id, patch, el) {
    const lead = state.leads.find((l) => String(l.id) === String(id));
    const before = { ...lead };
    Object.assign(lead, patch);
    if ("status" in patch) paintLeads(el);
    if (leadsAreDemo()) return toast("وضع تجريبي: التعديل ما ينحفظ");
    try { await sb(`leads?id=eq.${encodeURIComponent(id)}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify(patch) }); toast("انحفظ ✓"); }
    catch (e) { Object.assign(lead, before); paintLeads(el); fail(e); }
  }

  function exportCSV(rows) {
    const cols = ["created_at", "name", "phone", "business_type", "budget", "plan", "source", "campaign", "status", "message", "notes"];
    const q = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const csv = "﻿" + [cols.join(","), ...rows.map((l) => cols.map((c) => q(l[c])).join(","))].join("\n");
    try {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
      a.download = `leads-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a); a.click(); a.remove();
    } catch (_) { navigator.clipboard && navigator.clipboard.writeText(csv).then(() => toast("انتسخت البيانات ✓")); }
  }

  /* ---------- الباقات ---------- */
  RENDER.pricing = async (el) => {
    const file = await load("content/pricing.json");
    const plans = clone(file.data || []);
    const L = state.contentLang;
    const paint = () => {
      el.innerHTML = `
        <div class="toolbar">${langTabs(L)}<button type="button" class="btn btn-outline btn-sm" id="addPlan">+ باقة</button><button type="button" class="btn btn-accent btn-sm" id="savePlans">حفظ ونشر</button></div>
        <p class="muted small">التعديل هنا للغة: <b>${L === "ar" ? "العربي" : "English"}</b>. "مميزة" تنطبق على اللغتين.</p>
        <div class="edit-grid">${plans.map((p, i) => {
          const d = p[L] || {};
          return `
          <form class="panel plan-edit${p.featured ? " is-featured" : ""}" data-i="${i}">
            <div class="panel-head"><h2>${esc(d.name || "باقة جديدة")}</h2>
              <div class="mini-actions"><button type="button" data-move="-1" aria-label="تقديم">↑</button><button type="button" data-move="1" aria-label="تأخير">↓</button><button type="button" data-del aria-label="حذف">🗑</button></div></div>
            ${field("الاسم", "name", d.name)}
            ${field("لمن؟", "for", d.for)}
            <div class="field-row">${field("السعر", "price", d.price, { hint: "مثال: $250 أو حسب الطلب" })}${field("الفترة", "period", d.period, { hint: "مثال: / شهريًا" })}</div>
            ${field("المزايا (كل سطر ميزة)", "features", (d.features || []).join("\n"), { type: "textarea", rows: 5 })}
            <div class="field-row">${field("نص الزر", "cta", d.cta)}${field("شارة (للمميزة)", "badge", d.badge)}</div>
            ${toggle("باقة مميزة (تظهر بلون مختلف)", "featured", p.featured)}
          </form>`;
        }).join("")}</div>`;
      bindLang(el, paint);
      const collect = () => $$(".plan-edit", el).forEach((f) => {
        const i = +f.dataset.i, v = formData(f);
        plans[i].featured = v.featured;
        plans[i][L] = { ...(plans[i][L] || {}), name: v.name, for: v.for, price: v.price, period: v.period, cta: v.cta, badge: v.badge,
          features: v.features.split("\n").map((s) => s.trim()).filter(Boolean) };
      });
      $$(".plan-edit", el).forEach((f) => {
        const i = +f.dataset.i;
        $$("[data-move]", f).forEach((b) => b.addEventListener("click", () => { collect(); const j = i + +b.dataset.move; if (j < 0 || j >= plans.length) return; [plans[i], plans[j]] = [plans[j], plans[i]]; paint(); }));
        $("[data-del]", f).addEventListener("click", () => { if (!confirmInline(f, "تحذف هذي الباقة؟")) return; collect(); plans.splice(i, 1); paint(); });
      });
      $("#addPlan").addEventListener("click", () => { collect(); plans.push({ featured: false, ar: { name: "باقة جديدة", features: [] }, en: { name: "New plan", features: [] } }); paint(); });
      $("#savePlans").addEventListener("click", async () => { collect(); await writeFile("content/pricing.json", plans, "Update pricing from control panel").catch(fail); });
      el._collect = collect;
    };
    paint();
  };

  function bindLang(el, repaint) {
    $$("[data-lang]", el).forEach((b) => b.addEventListener("click", () => {
      if (el._collect) el._collect();
      state.contentLang = b.dataset.lang; repaint();
    }));
  }
  // تأكيد بنقرتين بدل confirm() (ممنوع ببعض المتصفحات المدمجة)
  function confirmInline(scope, msg) {
    if (scope.dataset.armed === "1") { scope.dataset.armed = ""; return true; }
    scope.dataset.armed = "1"; toast(msg + " اضغط مرة ثانية للتأكيد");
    setTimeout(() => (scope.dataset.armed = ""), 3500);
    return false;
  }

  /* ---------- دراسات الحالة ---------- */
  RENDER.cases = async (el) => {
    const file = await load("content/case-studies.json");
    const items = clone(file.data || []);
    const paint = () => {
      el.innerHTML = `
        <div class="toolbar"><span class="muted small">${items.length} دراسة · المسودات ما تظهر بالموقع</span><button type="button" class="btn btn-accent btn-sm" id="addCase">+ دراسة حالة</button></div>
        <div class="list">${items.map((c, i) => `
          <button type="button" class="list-item" data-i="${i}">
            <span class="li-main"><b>${esc((c.ar && c.ar.client) || (c.en && c.en.client) || "بدون اسم")}</b><small>${esc((c.platforms || []).join(" · "))} · ${esc((c.ar && c.ar.period) || "")}</small></span>
            <span class="badge-st ${c.draft ? "draft" : "live"}">${c.draft ? "مسودة" : "منشورة"}</span>
          </button>`).join("") || `<p class="empty">ماكو دراسات حالة بعد. أضف أول وحدة بنتائجك الحقيقية.</p>`}</div>`;
      $$(".list-item", el).forEach((b) => b.addEventListener("click", () => editCase(+b.dataset.i)));
      $("#addCase").addEventListener("click", () => editCase(-1));
    };
    const blank = () => ({ draft: true, platforms: ["Meta"], ar: { results: [{}, {}, {}] }, en: { results: [{}, {}, {}] } });
    const editCase = (i) => {
      const c = i < 0 ? blank() : clone(items[i]);
      let L = "ar";
      const body = () => {
        const d = c[L] || { results: [] };
        const res = [0, 1, 2].map((k) => (d.results || [])[k] || {});
        return `
          ${toggle("مسودة (ما تظهر بالموقع)", "draft", c.draft)}
          ${field("المنصات (افصل بفاصلة)", "platforms", (c.platforms || []).join(", "), { dir: "ltr", placeholder: "Meta, Instagram, TikTok" })}
          <hr>${langTabs(L)}
          ${field("اسم العميل / المشروع", "client", d.client)}
          <div class="field-row">${field("المجال", "industry", d.industry)}${field("المدة", "period", d.period)}</div>
          ${field("التحدي", "challenge", d.challenge, { type: "textarea" })}
          ${field("الحل (شنو سويت)", "solution", d.solution, { type: "textarea" })}
          <p class="label-strong">النتائج</p>
          ${res.map((r, k) => `<div class="field-row">${field(`القيمة ${k + 1}`, `rv${k}`, r.value, { dir: "ltr", placeholder: "3.1x" })}${field("الوصف", `rl${k}`, r.label, { placeholder: "ROAS" })}</div>`).join("")}`;
      };
      const collect = () => {
        const v = formData($("#sheetBody"));
        c.draft = v.draft; c.platforms = v.platforms.split(",").map((s) => s.trim()).filter(Boolean);
        c[L] = { client: v.client, industry: v.industry, period: v.period, challenge: v.challenge, solution: v.solution,
          results: [0, 1, 2].map((k) => ({ value: v[`rv${k}`], label: v[`rl${k}`] })).filter((r) => r.value || r.label) };
      };
      const repaint = () => { $("#sheetBody").innerHTML = body(); $$("#sheetBody [data-lang]").forEach((b) => b.addEventListener("click", () => { collect(); L = b.dataset.lang; repaint(); })); };
      openSheet(i < 0 ? "دراسة حالة جديدة" : "تعديل دراسة الحالة", "", [
        ...(i >= 0 ? [{ label: "حذف", cls: "btn-danger", run: async () => { if (!confirmInline($("#sheetFoot"), "تحذف الدراسة؟")) return; items.splice(i, 1); await writeFile("content/case-studies.json", items, "Delete case study from control panel").catch(fail); closeSheet(); paint(); } }] : []),
        { label: "إلغاء", run: closeSheet },
        { label: "حفظ ونشر", cls: "btn-accent", run: async () => {
          collect();
          if (!(c.ar && c.ar.client) && !(c.en && c.en.client)) return toast("اكتب اسم العميل", true);
          if (i < 0) items.push(c); else items[i] = c;
          await writeFile("content/case-studies.json", items, "Update case studies from control panel").catch(fail);
          closeSheet(); paint();
        } },
      ]);
      repaint();
    };
    paint();
  };

  /* ---------- المدونة ---------- */
  const fm = {
    parse(src) {
      const m = src.match(/^---\n([\s\S]*?)\n---\n?/);
      const data = {};
      if (m) m[1].split("\n").forEach((l) => { const i = l.indexOf(":"); if (i > 0) { let v = l.slice(i + 1).trim().replace(/^["']|["']$/g, ""); data[l.slice(0, i).trim()] = v === "true" ? true : v === "false" ? false : v; } });
      return { data, body: m ? src.slice(m[0].length) : src };
    },
    stringify(d, body) {
      const clean = (v) => String(v ?? "").replace(/\n/g, " ").trim();
      const lines = ["title", "description", "date", "translation"].filter((k) => d[k]).map((k) => `${k}: ${clean(d[k])}`);
      if (d.draft) lines.push("draft: true");
      return `---\n${lines.join("\n")}\n---\n\n${body.trim()}\n`;
    },
  };
  function md(src) {
    const e = (s) => esc(s).replace(/`([^`]+)`/g, "<code>$1</code>").replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>").replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="#">$1</a>');
    const out = []; let list = null, para = [];
    const fp = () => { if (para.length) { out.push(`<p>${e(para.join(" "))}</p>`); para = []; } };
    const fl = () => { if (list) { out.push(`<${list.t}>${list.i.map((x) => `<li>${e(x)}</li>`).join("")}</${list.t}>`); list = null; } };
    src.split("\n").forEach((raw) => {
      const l = raw.trimEnd(); let m;
      if (!l.trim()) { fp(); fl(); return; }
      if ((m = l.match(/^(#{2,4})\s+(.*)/))) { fp(); fl(); out.push(`<h${m[1].length}>${e(m[2])}</h${m[1].length}>`); return; }
      if ((m = l.match(/^>\s?(.*)/))) { fp(); fl(); out.push(`<blockquote>${e(m[1])}</blockquote>`); return; }
      if ((m = l.match(/^[-*]\s+(.*)/))) { fp(); if (!list || list.t !== "ul") { fl(); list = { t: "ul", i: [] }; } list.i.push(m[1]); return; }
      if ((m = l.match(/^\d+[.)]\s+(.*)/))) { fp(); if (!list || list.t !== "ol") { fl(); list = { t: "ol", i: [] }; } list.i.push(m[1]); return; }
      fl(); para.push(l.trim());
    });
    fp(); fl(); return out.join("");
  }
  const slugify = (s) => String(s).toLowerCase().normalize("NFKD").replace(/[^\w\s-]/g, "").trim().replace(/[\s_]+/g, "-").replace(/-+/g, "-").slice(0, 60);

  RENDER.blog = async (el) => {
    const L = state.contentLang;
    const names = (await listDir(`content/blog/${L}`)).filter((f) => f.endsWith(".md"));
    const posts = await Promise.all(names.map(async (n) => {
      const path = `content/blog/${L}/${n}`;
      const f = await load(path, { json: false });
      return { path, slug: n.replace(/\.md$/, ""), ...fm.parse(f.data || "") };
    }));
    posts.sort((a, b) => String(b.data.date).localeCompare(String(a.data.date)));
    el.innerHTML = `
      <div class="toolbar">${langTabs(L)}<button type="button" class="btn btn-accent btn-sm" id="newPost">+ مقال جديد</button></div>
      <div class="list">${posts.map((p, i) => `
        <button type="button" class="list-item" data-i="${i}">
          <span class="li-main"><b>${esc(p.data.title || p.slug)}</b><small>${esc(p.data.date || "")} · /${esc(p.slug)}</small></span>
          <span class="badge-st ${p.data.draft ? "draft" : "live"}">${p.data.draft ? "مسودة" : "منشور"}</span>
        </button>`).join("") || `<p class="empty">ماكو مقالات بهذي اللغة.</p>`}</div>`;
    bindLang(el, () => go("blog"));
    $$(".list-item", el).forEach((b) => b.addEventListener("click", () => editPost(posts[+b.dataset.i], L)));
    $("#newPost").addEventListener("click", () => editPost(null, L));
    if (state.pendingNewPost) { state.pendingNewPost = false; editPost(null, L); }
  };

  async function editPost(post, L) {
    const isNew = !post;
    const other = L === "ar" ? "en" : "ar";
    const otherSlugs = (await listDir(`content/blog/${other}`).catch(() => [])).filter((f) => f.endsWith(".md")).map((f) => f.replace(/\.md$/, ""));
    const d = post ? post.data : { date: new Date().toISOString().slice(0, 10), draft: true };
    const body = post ? post.body : "## عنوان فرعي\n\nاكتب مقدمة المقال هنا.\n\n- نقطة أولى\n- نقطة ثانية\n";
    openSheet(isNew ? "مقال جديد" : "تعديل المقال", `
      ${field("العنوان", "title", d.title)}
      ${field("الوصف (يظهر بـ Google)", "description", d.description, { type: "textarea", rows: 2, hint: "حوالي 150 حرف" })}
      <div class="field-row">
        ${field("رابط المقال (slug)", "slug", post ? post.slug : "", { dir: "ltr", placeholder: "my-article", hint: isNew ? "حروف إنكليزية وشرطات فقط" : "ما يتغير بعد النشر" })}
        ${field("التاريخ", "date", d.date, { type: "date", dir: "ltr" })}
      </div>
      <div class="field"><label>النسخة ${other === "en" ? "الإنكليزية" : "العربية"} (اختياري)</label>
        <select name="translation" dir="ltr"><option value="">—</option>${otherSlugs.map((s) => `<option${s === d.translation ? " selected" : ""}>${esc(s)}</option>`).join("")}</select></div>
      ${toggle("مسودة (ما ينشر لحد ما تطفيها)", "draft", d.draft)}
      <div class="md-tools" role="toolbar" aria-label="تنسيق">
        <button type="button" data-md="## ">عنوان</button><button type="button" data-md="### ">فرعي</button>
        <button type="button" data-wrap="**">عريض</button><button type="button" data-md="- ">قائمة</button>
        <button type="button" data-md="> ">اقتباس</button><button type="button" data-link>رابط</button>
        <button type="button" data-preview class="push">معاينة</button>
      </div>
      <textarea name="body" class="md-editor" rows="14" ${L === "en" ? 'dir="ltr"' : ""}>${esc(body)}</textarea>
      <div class="md-preview prose" hidden ${L === "en" ? 'dir="ltr"' : ""}></div>
    `, [
      ...(!isNew ? [{ label: "حذف", cls: "btn-danger", run: async () => { if (!confirmInline($("#sheetFoot"), "تحذف المقال؟")) return; await deleteFile(post.path, `Delete post ${post.slug} from control panel`).catch(fail); closeSheet(); go("blog"); } }] : []),
      { label: "إلغاء", run: closeSheet },
      { label: "حفظ ونشر", cls: "btn-accent", run: async () => {
        const v = formData($("#sheetBody"));
        if (!v.title) return toast("اكتب عنوان المقال", true);
        let slug = post ? post.slug : slugify(v.slug || v.title) || `post-${Date.now().toString(36)}`;
        const path = `content/blog/${L}/${slug}.md`;
        if (isNew && !state.demo) { const exists = await readFile(path, { json: false }).catch(() => ({})); if (exists && exists.sha) return toast("هذا الرابط مستخدم، غيّر الـ slug", true); }
        const text = fm.stringify({ title: v.title, description: v.description, date: v.date, translation: v.translation, draft: v.draft }, v.body);
        await writeFile(path, text, `${isNew ? "Add" : "Update"} post ${slug} from control panel`, { json: false }).catch(fail);
        closeSheet(); go("blog");
      } },
    ]);
    const ta = $("#sheetBody .md-editor");
    const insert = (pre, wrap) => {
      const s = ta.selectionStart, e = ta.selectionEnd, v = ta.value;
      if (wrap) ta.value = v.slice(0, s) + wrap + (v.slice(s, e) || "نص") + wrap + v.slice(e);
      else { const ls = v.lastIndexOf("\n", s - 1) + 1; ta.value = v.slice(0, ls) + pre + v.slice(ls); }
      ta.focus();
    };
    $$("[data-md]", $("#sheetBody")).forEach((b) => b.addEventListener("click", () => insert(b.dataset.md)));
    $$("[data-wrap]", $("#sheetBody")).forEach((b) => b.addEventListener("click", () => insert(null, b.dataset.wrap)));
    $("[data-link]", $("#sheetBody")).addEventListener("click", () => { const s = ta.selectionStart, e = ta.selectionEnd; const t = ta.value.slice(s, e) || "نص الرابط"; ta.value = ta.value.slice(0, s) + `[${t}](https://)` + ta.value.slice(e); ta.focus(); });
    $("[data-preview]", $("#sheetBody")).addEventListener("click", (ev) => {
      const pv = $("#sheetBody .md-preview"), on = pv.hidden;
      pv.hidden = !on; ta.hidden = on; ev.target.textContent = on ? "تحرير" : "معاينة";
      if (on) pv.innerHTML = md(ta.value);
    });
  }

  /* ---------- الأسئلة الشائعة ---------- */
  RENDER.faq = async (el) => {
    const file = await load("content/faq.json");
    const data = clone(file.data || { ar: [], en: [] });
    const paint = () => {
      const L = state.contentLang, items = data[L] = data[L] || [];
      el.innerHTML = `
        <div class="toolbar">${langTabs(L)}<button type="button" class="btn btn-outline btn-sm" id="addQ">+ سؤال</button><button type="button" class="btn btn-accent btn-sm" id="saveFaq">حفظ ونشر</button></div>
        <div class="edit-stack">${items.map((f, i) => `
          <form class="panel faq-edit" data-i="${i}">
            <div class="panel-head"><span class="muted small">سؤال ${i + 1}</span><div class="mini-actions"><button type="button" data-move="-1" aria-label="تقديم">↑</button><button type="button" data-move="1" aria-label="تأخير">↓</button><button type="button" data-del aria-label="حذف">🗑</button></div></div>
            ${field("السؤال", "q", f.q)}
            ${field("الجواب", "a", f.a, { type: "textarea", rows: 3 })}
          </form>`).join("")}</div>`;
      const collect = () => $$(".faq-edit", el).forEach((f) => { const v = formData(f); items[+f.dataset.i] = { q: v.q, a: v.a }; });
      el._collect = collect;
      bindLang(el, paint);
      $$(".faq-edit", el).forEach((f) => {
        const i = +f.dataset.i;
        $$("[data-move]", f).forEach((b) => b.addEventListener("click", () => { collect(); const j = i + +b.dataset.move; if (j < 0 || j >= items.length) return; [items[i], items[j]] = [items[j], items[i]]; paint(); }));
        $("[data-del]", f).addEventListener("click", () => { if (!confirmInline(f, "تحذف السؤال؟")) return; collect(); items.splice(i, 1); paint(); });
      });
      $("#addQ").addEventListener("click", () => { collect(); items.push({ q: "", a: "" }); paint(); });
      $("#saveFaq").addEventListener("click", async () => { collect(); data[L] = items.filter((f) => f.q); await writeFile("content/faq.json", data, "Update FAQ from control panel").catch(fail); paint(); });
    };
    paint();
  };

  /* ---------- الإعدادات ---------- */
  RENDER.prefs = async (el) => {
    const file = await load("content/settings.json");
    const s = clone(file.data || {});
    s.tracking = s.tracking || {};
    el.innerHTML = `
      <form class="edit-stack" id="prefsForm">
        <section class="panel">
          <h2>التواصل</h2>
          ${field("رقم الواتساب (دولي بدون +)", "whatsapp", s.whatsapp, { dir: "ltr", hint: "مثال: 9647711094000" })}
          ${field("رابط الإنستغرام", "instagram", s.instagram, { dir: "ltr" })}
          ${field("رسالة الواتساب الترحيبية (عربي)", "whatsappGreeting", s.whatsappGreeting)}
          ${field("رسالة الواتساب الترحيبية (English)", "whatsappGreetingEn", s.whatsappGreetingEn, { dir: "ltr" })}
        </section>
        <section class="panel">
          <h2>التتبع الإعلاني</h2>
          ${field("Meta Pixel ID", "metaPixelId", s.tracking.metaPixelId, { dir: "ltr", hint: "Events Manager ← Data Sources (أرقام فقط)" })}
          ${field("TikTok Pixel ID", "tiktokPixelId", s.tracking.tiktokPixelId, { dir: "ltr" })}
          ${field("Google Analytics 4 ID", "ga4Id", s.tracking.ga4Id, { dir: "ltr", placeholder: "G-XXXXXXX" })}
        </section>
        <section class="panel">
          <h2>قاعدة بيانات الطلبات (Supabase)</h2>
          <p class="muted small">الخطوات بملف README بالمستودع. المفتاح المطلوب هو <b>anon public</b> فقط، لا تحط service_role.</p>
          ${field("Project URL", "supabaseUrl", s.supabaseUrl, { dir: "ltr", placeholder: "https://xxxx.supabase.co" })}
          ${field("anon public key", "supabaseAnonKey", s.supabaseAnonKey, { dir: "ltr", type: "textarea", rows: 3 })}
        </section>
        <section class="panel">
          <h2>الموقع</h2>
          ${field("رابط الموقع", "siteUrl", s.siteUrl, { dir: "ltr", hint: "غيّره إذا ربطت دومين خاص" })}
        </section>
        <button class="btn btn-accent btn-block" type="submit">حفظ ونشر</button>
      </form>`;
    $("#prefsForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const v = formData(e.target);
      if (/service_role/.test(atobSafe(v.supabaseAnonKey))) return toast("هذا مفتاح service_role! استخدم anon public بس", true);
      const next = { ...s, whatsapp: v.whatsapp.replace(/\D/g, ""), instagram: v.instagram, whatsappGreeting: v.whatsappGreeting, whatsappGreetingEn: v.whatsappGreetingEn,
        supabaseUrl: v.supabaseUrl.replace(/\/$/, ""), supabaseAnonKey: v.supabaseAnonKey.replace(/\s/g, ""), siteUrl: v.siteUrl.replace(/\/$/, ""),
        tracking: { ...s.tracking, metaPixelId: v.metaPixelId.replace(/\D/g, ""), tiktokPixelId: v.tiktokPixelId.trim(), ga4Id: v.ga4Id.trim() } };
      await writeFile("content/settings.json", next, "Update settings from control panel").catch(fail);
    });
  };
  const atobSafe = (jwt) => { try { return atob(String(jwt).split(".")[1].replace(/-/g, "+").replace(/_/g, "/")); } catch (_) { return ""; } };

  /* =========================================================
     الدخول والتشغيل
     ========================================================= */
  async function verifyToken(token) {
    state.token = token;
    const info = await gh(`/repos/${GH.owner}/${GH.repo}`);
    if (!info.permissions || !info.permissions.push) throw new Error("الرمز ما عنده صلاحية كتابة على مستودع الموقع");
    return info;
  }

  function enter() {
    $("#loginView").hidden = true;
    $("#appView").hidden = false;
    $("#modeLabel").textContent = state.demo ? "عرض تجريبي" : `${GH.owner}/${GH.repo}`;
    $("#demoBanner").hidden = !state.demo;
    $("#demoBanner").innerHTML = `<strong>عرض تجريبي:</strong> تكدر تتصفح وتجرب كل شي، بس التعديلات ما تنحفظ. <button type="button" class="link" id="exitDemo">سجّل دخول</button>`;
    const x = $("#exitDemo"); if (x) x.addEventListener("click", logout);
    if (!state.demo && sbConfigured()) { try { state.sb = JSON.parse(storage.get(SB_KEY)); } catch (_) {} }
    go("overview");
    deployStatus().then(paintDeploy);
  }

  function logout() {
    storage.del(TOKEN_KEY); storage.del(SB_KEY);
    Object.assign(state, { demo: false, token: null, files: {}, leads: null, sb: null });
    $("#appView").hidden = true; $("#loginView").hidden = false;
  }

  function bind() {
    $("#loginForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const f = e.target, btn = f.querySelector("[type=submit]"), token = f.token.value.trim();
      $("#loginErr").textContent = "";
      if (!token) return ($("#loginErr").textContent = "الصق رمز الدخول");
      btn.disabled = true; btn.textContent = "جاري التحقق…";
      try {
        state.repoInfo = await verifyToken(token);
        storage.set(TOKEN_KEY, token, f.remember.checked);
        f.reset(); enter();
      } catch (err) {
        state.token = null;
        $("#loginErr").textContent = /Failed to fetch|NetworkError|Load failed/.test(err.message) ? "ما گدرت أتصل بـ GitHub. تأكد من الإنترنت." : err.message;
      } finally { btn.disabled = false; btn.textContent = "دخول"; }
    });
    $("#demoBtn").addEventListener("click", () => { state.demo = true; enter(); });
    $("#logoutBtn").addEventListener("click", logout);

    document.addEventListener("click", (e) => {
      const nav = e.target.closest("[data-view]");
      if (nav) return go(nav.dataset.view);
      const more = e.target.closest("[data-more]");
      if (more) return openSheet("المزيد", `<div class="list">${VIEWS.filter((v) => !TAB_VIEWS.includes(v.id)).map((v) => `<button type="button" class="list-item" data-sheet-view="${v.id}"><span class="li-main"><b>${v.icon} ${v.label}</b></span></button>`).join("")}<a class="list-item" href="../" target="_blank" rel="noopener"><span class="li-main"><b>↗ عرض الموقع</b></span></a><button type="button" class="list-item" data-logout><span class="li-main"><b>⎋ خروج</b></span></button></div>`, [{ label: "إغلاق", run: closeSheet }]);
      const sv = e.target.closest("[data-sheet-view]");
      if (sv) { closeSheet(); return go(sv.dataset.sheetView); }
      if (e.target.closest("[data-logout]")) { closeSheet(); return logout(); }
      const g = e.target.closest("[data-goto]");
      if (g) { if (g.hasAttribute("data-new-post")) state.pendingNewPost = true; return go(g.dataset.goto); }
      if (e.target.closest("[data-close]")) closeSheet();
    });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("#sheet").hidden) closeSheet(); });
  }

  document.addEventListener("DOMContentLoaded", async () => {
    bind();
    const saved = storage.get(TOKEN_KEY);
    if (saved) {
      try { state.repoInfo = await verifyToken(saved); return enter(); }
      catch (_) { storage.del(TOKEN_KEY); state.token = null; }
    }
    $("#loginView").hidden = false;
  });
})();
