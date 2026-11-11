# إبراهيم المهاوش — الموقع الشخصي (v2)

## 🎛 لوحة التحكم

افتح **`/admin/`** على موقعك ← سجّل دخول برمز GitHub (الخطوات داخل صفحة الدخول).
من اللوحة تعدّل بدون كود: **الباقات والأسعار، دراسات الحالة، المقالات، الأسئلة الشائعة، الإعدادات** (واتساب، Pixels، Supabase)، وتتابع **الطلبات**.
كل حفظ ← يتسجل بالمستودع ← GitHub Actions يبني وينشر تلقائيًا خلال دقيقتين (`.github/workflows/deploy.yml`).


موقع تسويقي عربي/إنكليزي لخدمات إدارة حملات Meta وTikTok، مع مدونة، دراسات حالة، تتبع إعلاني، ولوحة تحكم لإدارة الطلبات.
بدون أي مكتبات أو `npm install`: يحتاج بس **Node.js 18+**.

## هيكل المشروع

```
site/
├── build.mjs               ← مولّد الموقع (يقرأ src + content ← يطلّع dist)
├── src/
│   ├── layouts/base.html   ← القالب العام (head, SEO, hreflang)
│   ├── partials/           ← header.html, footer.html (مشتركة لكل الصفحات)
│   ├── pages/              ← home.ar.html, home.en.html, 404
│   └── i18n/               ← ar.json, en.json (نصوص الواجهة)
├── content/
│   ├── blog/ar/*.md        ← مقالات عربي
│   ├── blog/en/*.md        ← مقالات إنكليزي
│   ├── case-studies.json   ← دراسات الحالة
│   ├── pricing.json        ← الباقات والأسعار
│   ├── faq.json            ← الأسئلة الشائعة
│   └── settings.json       ← الإعدادات (يولّد assets/js/config.js)
├── public/                 ← يُنسخ كما هو
│   ├── assets/css          ← main.css, admin.css
│   ├── assets/js           ← main.js, tracking.js, admin.js
│   ├── assets/img
│   ├── admin/              ← لوحة التحكم
│   └── _headers            ← هيدرز الأمان
├── supabase/schema.sql     ← قاعدة البيانات + الحماية
└── dist/                   ← الناتج النهائي (هذا اللي ينرفع)
```

## الأوامر

```bash
node build.mjs              # بناء الإنتاج → dist/
node build.mjs --drafts     # يُظهر المسودات (للمراجعة)
node build.mjs --preview    # روابط index.html للفتح بدون سيرفر
python3 -m http.server -d dist 8000   # معاينة على http://localhost:8000
```

## النشر على Netlify

**الطريقة الأفضل (تحديث تلقائي):** ارفع المجلد على GitHub ← في Netlify اختار Import from Git. الإعدادات جاهزة بـ `netlify.toml` (يشغّل `node build.mjs` وينشر `dist`). كل ما تعدّل وترفع، الموقع يتحدث وحده.

**الطريقة السريعة:** شغّل `node build.mjs` واسحب مجلد `dist` إلى app.netlify.com/drop.

بعد ما تاخذ الدومين: غيّر "رابط الموقع" من لوحة التحكم ← الإعدادات.

---

## 1) لوحة تحكم الطلبات (Supabase — مجاني)

1. سوّي حساب على supabase.com ← **New project**.
2. **SQL Editor** ← New query ← الصق محتوى `supabase/schema.sql` ← **Run**.
3. **Authentication ← Users ← Add user**: سوّي حسابك (إيميل + كلمة مرور).
4. ارجع لـ SQL Editor وشغّل (بإيميلك):
   ```sql
   insert into public.admins (user_id) select id from auth.users where email = 'you@example.com';
   ```
5. **Authentication ← Sign In / Providers**: طفّي **Allow new users to sign up** (حتى محد غيرك يسوي حساب).
6. **Project Settings ← API**: انسخ `Project URL` و`anon public key` وحطهم في **لوحة التحكم ← الإعدادات** ← حفظ ونشر.
7. بعد دقيقتين افتح **الطلبات** باللوحة وسجّل بحساب Supabase.

**ليش آمن؟** المفتاح `anon` عام بطبيعته. الحماية بقاعدة البيانات (Row Level Security): الزائر يكدر **يضيف** طلب بس، وما يكدر يقرأ أو يعدّل أي شي. القراءة والتعديل فقط للحسابات الموجودة بجدول `admins`.

**مزايا اللوحة:** إحصائيات (الإجمالي، الجديد، آخر 7 أيام، نسبة الإغلاق)، توزيع حسب المصدر ومرحلة البيع، فلترة وبحث، تغيير حالة العميل (جديد ← تم التواصل ← مؤهل ← تم البيع / خسارة)، ملاحظات، زر واتساب مباشر برسالة جاهزة، وتصدير CSV.

قبل الربط، اللوحة تشتغل **بوضع تجريبي** ببيانات وهمية واضحة حتى تشوف شكلها.

## 2) دراسات الحالة

عدّل `content/case-studies.json`. كل دراسة فيها نسخة `ar` و`en`:

```json
{
  "draft": false,
  "platforms": ["Meta", "Instagram"],
  "ar": { "client": "...", "industry": "...", "period": "60 يوم",
          "challenge": "...", "solution": "...",
          "results": [{ "value": "3.1x", "label": "ROAS" }] },
  "en": { ... }
}
```

- `"draft": true` ← تظهر فقط بالمعاينة (`--drafts`) بعلامة "مثال توضيحي"، وما تنشر.
- الأمثلة الموجودة حاليًا كلها `draft` — بدّلها بنتائجك الحقيقية وخلّي `draft: false`.
- إذا ماكو أي دراسة منشورة، القسم يختفي من الموقع تلقائيًا.

## 3) المدونة

سوّي ملف `.md` جديد في `content/blog/ar/` أو `content/blog/en/`:

```markdown
---
title: عنوان المقال
description: وصف قصير يظهر بنتائج Google (150 حرف تقريبًا)
date: 2026-11-15
translation: slug-of-english-version   # اختياري: يربط النسختين
draft: false
---

## عنوان فرعي

نص عادي، **عريض**، [رابط](/#contact)، قوائم بـ - أو 1.

> اقتباس أو معادلة مهمة
```

اسم الملف = رابط المقال (`content/blog/ar/my-post.md` ← `/blog/my-post/`). الروابط اللي تبدأ بـ `/` تتحول تلقائيًا لروابط صحيحة.
كل مقال ياخذ تلقائيًا: صفحة خاصة، Schema (BlogPosting)، وقت القراءة، زر حجز استشارة، ويندرج بـ sitemap.

## 4) اللغات

- العربي على `/` والإنكليزي على `/en/`، مع `hreflang` وزر تبديل اللغة.
- نصوص الهيدر والفوتر والمدونة: `src/i18n/*.json`.
- محتوى الصفحة الرئيسية: `src/pages/home.ar.html` و`home.en.html`.
- رسائل النموذج والحاسبة بالـ JS تتبدل حسب اللغة تلقائيًا.

## 5) التتبع (Pixels + UTM)

ضع الـ IDs من **لوحة التحكم ← الإعدادات** (أو `content/settings.json`):

| الحدث بالموقع | Meta | TikTok | GA4 |
|---|---|---|---|
| إرسال نموذج الاستشارة | `Lead` | `SubmitForm` | `generate_lead` |
| ضغط أي رابط واتساب | `Contact` | `Contact` | `contact` |
| اختيار باقة | `SelectPlan` | `ClickButton` | `select_item` |
| استخدام الحاسبة | `UseCalculator` | `ClickButton` | `use_calculator` |

**مصدر العميل:** روابط فيها UTM (مثل `?utm_source=instagram&utm_campaign=nov-offer`) يُحفظ مصدرها ويظهر برسالة الواتساب، ويتسجل بقاعدة البيانات، وتشوفه باللوحة.
بإعلانات Meta حط بـ URL parameters:
`utm_source={{site_source_name}}&utm_campaign={{campaign.name}}&utm_content={{ad.name}}`

## الأمان

- CSP صارمة بدون سكربتات inline، HSTS، منع iframe، nosniff (`public/_headers`).
- RLS بقاعدة البيانات + قيود طول على كل الحقول + honeypot ضد البوتات.
- `/admin/` مستثنى من محركات البحث (robots + X-Robots-Tag) وبدون كاش.

## الأداء وSEO

- HTML ثابت جاهز (بدون framework)، CSS وJS خفيفين، صور WebP بأحجام متعددة، خط واحد.
- Canonical، hreflang، Open Graph، Schema (Person, Blog, BlogPosting)، sitemap مع اللغات.
