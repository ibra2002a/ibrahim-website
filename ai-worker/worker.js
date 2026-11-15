/**
 * ai-worker/worker.js — وسيط آمن للمساعد الذكي (Cloudflare Worker)
 *
 * يحمي مفتاح الـ AI: الموقع يرسل الأسئلة لهذا الـ Worker، والـ Worker يضيف المعرفة والتعليمات
 * ويسأل الذكاء الاصطناعي، ويرجّع الجواب. المفتاح ما يطلع للمتصفح أبدًا.
 *
 * المتغيرات (Settings ← Variables and Secrets):
 *   SITE_URL          رابط الموقع، مثل https://ibra2002a.github.io/ibrahim-website
 *   ALLOWED_ORIGIN    أصل الموقع فقط، مثل https://ibra2002a.github.io   (للحماية من الاستخدام من مواقع ثانية)
 *   وحدة من هذي (كـ Secret):
 *   ANTHROPIC_API_KEY مفتاح Claude من console.anthropic.com      (اختياري: MODEL، الافتراضي claude-haiku-5-5)
 *   GEMINI_API_KEY    مفتاح Gemini من aistudio.google.com        (اختياري: GEMINI_MODEL، الافتراضي gemini-2.5-flash)
 */

const LIMITS = { maxMessages: 10, maxChars: 800, maxTokens: 450 };
let cache = { at: 0, data: null };

async function knowledge(env) {
  if (cache.data && Date.now() - cache.at < 5 * 60 * 1000) return cache.data;
  const res = await fetch(`${env.SITE_URL.replace(/\/$/, "")}/assets/ai-knowledge.json`, { cf: { cacheTtl: 300 } });
  if (!res.ok) throw new Error("knowledge");
  cache = { at: Date.now(), data: await res.json() };
  return cache.data;
}

function systemPrompt(k, lang) {
  const L = k.langs[lang] || k.langs.ar;
  const name = k.person[lang] || k.person.ar;
  const plans = L.plans.map((p) => `- ${p.name}${p.entry ? " (عرض دخول)" : ""}: ${p.price} ${p.period} — ${p.for}. يشمل: ${p.features.join("؛ ")}`).join("\n");
  const ar = lang !== "en";
  return [
    ar
      ? `أنت المساعد الرسمي بموقع ${name}، ${k.person.role.ar}. تحجي باللهجة العراقية البسيطة والمهذبة (أو بالفصحى إذا الزائر كتب بالفصحى).`
      : `You are the official assistant on ${name}'s website, a ${k.person.role.en}. Reply in clear, friendly English.`,
    ar
      ? "مهمتك: تجاوب على أسئلة الزوار عن الخدمات والباقات والتسويق الرقمي بشكل مختصر (3–6 أسطر)، تساعدهم يختارون الباقة المناسبة، وتشجعهم يحجزون استشارة مجانية أو يتواصلون على الواتساب."
      : "Your job: answer visitor questions about the services, plans and digital marketing briefly (3–6 lines), help them pick the right plan, and encourage them to book a free consultation or message on WhatsApp.",
    ar
      ? "قواعد مهمة: لا تخترع أسعار أو نتائج أو أرقام أو عملاء أو خدمات غير موجودة بالمعلومات تحت. إذا ما تعرف الجواب أو السؤال يحتاج تفاصيل خاصة، كول بصراحة إن إبراهيم يجاوبه بنفسه واقترح الواتساب. لا تعطي وعود بنتائج مضمونة. إذا السؤال خارج التسويق والموقع، اعتذر بلطف ورجّع الحجي للخدمات. لا تطلب معلومات حساسة مثل كلمات المرور أو بيانات البطاقات."
      : "Rules: never invent prices, results, numbers, clients or services not in the info below. If you don't know or it needs specifics, say honestly that Ibrahim will answer personally and suggest WhatsApp. Never promise guaranteed results. If off-topic, politely steer back. Never ask for sensitive info like passwords or card details.",
    `\n## ${ar ? "الخدمات" : "Services"}\n${L.services.map((s) => `- ${s.name}: ${s.desc}`).join("\n")}`,
    `\n## ${ar ? "الباقات" : "Plans"}\n${plans}`,
    `\n## ${ar ? "عن إبراهيم" : "About"}\n${L.about.join("\n")}\n${L.why.map((w) => `- ${w}`).join("\n")}`,
    L.stats.length ? `\n## ${ar ? "نتائج حقيقية" : "Real results"}\n${L.stats.join("\n")}` : "",
    L.cases.length ? `\n## ${ar ? "دراسات حالة" : "Case studies"}\n${L.cases.map((c) => `- ${c.client} (${c.industry}): ${c.results.join("، ")}`).join("\n")}` : "",
    `\n## ${ar ? "أسئلة شائعة" : "FAQ"}\n${L.faq.map((f) => `س: ${f.q}\nج: ${f.a}`).join("\n")}`,
    `\n## ${ar ? "التواصل" : "Contact"}\nWhatsApp: +${k.contact.whatsapp} · Instagram: ${k.contact.instagram} · ${ar ? "الحجز من نموذج الاستشارة بالموقع" : "Booking via the consultation form on the site"}`,
  ].filter(Boolean).join("\n");
}

async function askClaude(env, system, messages) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: env.MODEL || "claude-haiku-5-5", max_tokens: LIMITS.maxTokens, system, messages }),
  });
  const d = await res.json();
  if (!res.ok) throw new Error(d.error && d.error.message || "claude");
  return (d.content || []).filter((c) => c.type === "text").map((c) => c.text).join("\n").trim();
}

async function askGemini(env, system, messages) {
  const model = env.GEMINI_MODEL || "gemini-2.5-flash";
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: messages.map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] })),
      generationConfig: { maxOutputTokens: LIMITS.maxTokens, temperature: 0.5 },
    }),
  });
  const d = await res.json();
  if (!res.ok) throw new Error(d.error && d.error.message || "gemini");
  return ((d.candidates || [])[0]?.content?.parts || []).map((p) => p.text || "").join("").trim();
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const allowed = (env.ALLOWED_ORIGIN || "").split(",").map((s) => s.trim()).filter(Boolean);
    const okOrigin = allowed.length === 0 || allowed.includes(origin);
    const cors = {
      "Access-Control-Allow-Origin": okOrigin ? origin || "*" : "null",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Vary": "Origin",
    };
    const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "content-type": "application/json; charset=utf-8" } });

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (request.method === "GET") return json({ ok: true, provider: env.ANTHROPIC_API_KEY ? "claude" : env.GEMINI_API_KEY ? "gemini" : "none" });
    if (request.method !== "POST") return json({ error: "method" }, 405);
    if (!okOrigin) return json({ error: "origin" }, 403);

    let body;
    try { body = await request.json(); } catch { return json({ error: "bad json" }, 400); }
    const lang = body.lang === "en" ? "en" : "ar";
    const messages = (Array.isArray(body.messages) ? body.messages : [])
      .slice(-LIMITS.maxMessages)
      .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
      .map((m) => ({ role: m.role, content: m.content.slice(0, m.role === "user" ? LIMITS.maxChars : 2000) }));
    while (messages.length && messages[0].role !== "user") messages.shift();
    if (!messages.length || messages[messages.length - 1].role !== "user") return json({ error: "no question" }, 400);

    try {
      const system = systemPrompt(await knowledge(env), lang);
      const reply = env.ANTHROPIC_API_KEY ? await askClaude(env, system, messages)
        : env.GEMINI_API_KEY ? await askGemini(env, system, messages)
        : null;
      if (!reply) return json({ error: "no AI key configured" }, 500);
      return json({ reply });
    } catch (e) {
      return json({ error: "ai_failed" }, 502);
    }
  },
};
