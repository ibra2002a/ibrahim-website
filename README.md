# إبراهيم مهاوش — الموقع الشخصي (Dark Premium)

موقع شخصي عربي/إنكليزي لمسوّق رقمي متخصص بالإعلانات وPerformance Marketing:
واجهة داكنة بلون مميز واحد (`#C8F23C`)، RTL كامل، Mobile first، مدونة، دراسات حالة، حاسبة إعلانات، مساعد محادثة، ولوحة تحكم.
بدون أي مكتبات أو `npm install`: يحتاج بس **Node.js 18+**.

## التشغيل محليًا

```bash
node build.mjs                          # بناء الإنتاج → dist/ (مضغوط)
node build.mjs --no-minify              # بناء بدون ضغط (أسهل للقراءة)
node build.mjs --drafts                 # يُظهر المسودات للمراجعة
node build.mjs --preview                # روابط index.html للفتح بدون سيرفر
python3 -m http.server -d dist 8000     # معاينة على http://localhost:8000
```

## النشر (GitHub Pages — تلقائي)

1. أي تعديل يوصل لفرع **`website-v2`** (من الكود أو من لوحة التحكم) يشغّل `.github/workflows/deploy.yml`.
2. الـ workflow يبني الموقع وينشر `dist/` على فرع **`gh-pages`** خلال دقيقتين تقريبًا.
3. بإعدادات المستودع: **Settings ← Pages ← Source: Deploy from a branch ← `gh-pages` / root**.
4. الرابط الحالي: `https://ibra2002a.github.io/ibrahim-website/`.

**الدومين الخاص (ibrahimiq.tech):**
- **على GitHub Pages:** Settings ← Pages ← Custom domain ← اكتب الدومين، وبـ Namecheap ← Advanced DNS أضف سجلات `A` لـ `@` تشير إلى `185.199.108.153` و`185.199.109.153` و`185.199.110.153` و`185.199.111.153`، و`CNAME` لـ `www` يشير إلى `ibra2002a.github.io`. بعدها فعّل **Enforce HTTPS**.
- **أو على استضافة Namecheap:** أضف أسرار المستودع `FTP_SERVER` و`FTP_USERNAME` و`FTP_PASSWORD` (Settings ← Secrets and variables ← Actions)، والـ workflow يرفع الموقع لـ `public_html` تلقائيًا بعد كل تعديل.
- بالحالتين: خلّي "رابط الموقع" بلوحة التحكم ← الإعدادات = الدومين الفعلي (يُستخدم بالـ canonical وsitemap وOpen Graph).

## 🎛 لوحة التحكم

افتح **`/admin/`** ← سجّل دخول برمز GitHub (الخطوات داخل صفحة الدخول). من اللوحة تعدّل بدون كود:
الأرقام، دراسات الحالة، آراء العملاء، الباقات (لمن تناسب، الخدمات، عدد الحملات، التقارير، التحسين، الدعم)، المقالات (مع التصنيف)، الأسئلة الشائعة، صفحات الخدمات، والإعدادات (واتساب، إنستغرام، فيسبوك، تيك توك، لينكدإن، البريد، Pixels، Supabase، المساعد).
كل حفظ ← يتسجل بالمستودع ← GitHub Actions يبني وينشر تلقائيًا.

## الأماكن المؤقتة (Placeholders) — لا أرقام مخترعة

الموقع ما يعرض أي رقم أو عميل أو رأي غير حقيقي. لحد ما تضيف بياناتك، تظهر أماكن مؤقتة واضحة:

| العنصر | الملف | كيف تبدله |
|---|---|---|
| الأرقام (+XX حملة، X.Xx ROAS…) | `content/stats.json` | اكتب الرقم الحقيقي وطفي "مكان مؤقت" |
| دراسات الحالة | `content/case-studies.json` | عدّل البيانات وطفي "مكان مؤقت" |
| آراء العملاء | `content/testimonials.json` | أضف رأي حقيقي واحذف المثال |

- `"placeholder": true` ← يظهر بشارة "مكان مخصص…" إذا كان `showPlaceholders` مفعّل بالإعدادات.
- `"draft": true` ← مخفي تمامًا (يظهر فقط مع `--drafts`).
- لإخفاء كل الأماكن المؤقتة مرة وحدة: لوحة التحكم ← الإعدادات ← طفي "إظهار الأماكن المؤقتة".
- المساعد الذكي ما يتعلم من الأماكن المؤقتة ولا من المسودات.

## هيكل المشروع

```
├── build.mjs               ← مولّد الموقع (src + content → dist)
├── src/
│   ├── layouts/base.html   ← القالب العام (SEO, OG, Schema, الأزرار العائمة, المساعد)
│   ├── partials/           ← header, footer, وأيقونات i-*.html (SVG خطية)
│   ├── pages/              ← home.ar.html, home.en.html, 404
│   └── i18n/               ← ar.json, en.json (نصوص الواجهة)
├── content/                ← كل المحتوى القابل للتعديل من اللوحة
│   ├── blog/ar|en/*.md     ← المقالات ("أفكار من السوق")
│   ├── stats.json  case-studies.json  testimonials.json
│   ├── pricing.json  faq.json  services.json
│   └── settings.json       ← الإعدادات (يولّد assets/js/config.js)
├── public/                 ← يُنسخ كما هو
│   ├── assets/css          ← main.css (نظام التصميم), admin.css
│   ├── assets/js           ← main.js, assistant.js, tracking.js, admin.js
│   ├── assets/fonts        ← Readex Pro (مستضاف محليًا، رخصة OFL)
│   ├── assets/img          ← الصور (AVIF/WebP/JPG) والأيقونات وصورة المشاركة
│   └── admin/              ← لوحة التحكم
├── ai-worker/              ← المساعد بالذكاء الاصطناعي (اختياري)
├── supabase/schema.sql     ← قاعدة بيانات الطلبات + الحماية
└── dist/                   ← الناتج النهائي
```

## نظام التصميم

- كل الألوان والمسافات متغيرات بأول `main.css` (`:root`). لتغيير الهوية عدّل المتغيرات فقط.
- لون مميز واحد: `--accent: #C8F23C` على خلفية `--bg: #0A0B0E`.
- الخط: Readex Pro (عربي + لاتيني) مستضاف داخل الموقع، بدون طلبات لـ Google Fonts.
- الحركة: ظهور ناعم عند التمرير وhover فقط، بدون حركة مستمرة، وتتوقف مع `prefers-reduced-motion`.

## المدونة

```markdown
---
title: عنوان المقال
description: وصف قصير يظهر بنتائج Google (150 حرف تقريبًا)
date: 2026-11-20
category: Meta Ads            # يظهر بالبطاقة وبفلتر التصنيفات
translation: english-slug     # اختياري: يربط النسختين
draft: false
---
```

اسم الملف = رابط المقال. الروابط اللي تبدأ بـ `/` تتحول تلقائيًا لروابط صحيحة. آخر 3 مقالات تظهر بالرئيسية.

## الحاسبة

المدخلات: الميزانية، متوسط السعر، عدد العملاء المتوقع، هامش الربح.
- الإيرادات = متوسط السعر × عدد العملاء
- ROAS = الإيرادات ÷ الميزانية
- تكلفة العميل (CAC) = الميزانية ÷ عدد العملاء
- الربح التقديري = (الإيرادات × هامش الربح) − الميزانية، ونقطة التعادل = 1 ÷ الهامش

## قاعدة بيانات الطلبات (Supabase — اختياري ومجاني)

1. supabase.com ← New project ← SQL Editor ← الصق `supabase/schema.sql` ← Run.
2. Authentication ← Users ← Add user، ثم: `insert into public.admins (user_id) select id from auth.users where email = 'you@example.com';`
3. طفّي **Allow new users to sign up**.
4. انسخ `Project URL` و`anon public key` إلى لوحة التحكم ← الإعدادات. **لا تستخدم `service_role` أبدًا.**

بدون Supabase: النموذج يشتغل ويفتح الواتساب برسالة جاهزة.

## التتبع (Pixels + UTM)

| الحدث | Meta | TikTok | GA4 |
|---|---|---|---|
| إرسال نموذج الاستشارة | `Lead` | `SubmitForm` | `generate_lead` |
| ضغط رابط واتساب | `Contact` | `Contact` | `contact` |
| اختيار باقة | `SelectPlan` | `ClickButton` | `select_item` |
| استخدام الحاسبة | `UseCalculator` | `ClickButton` | `use_calculator` |
| فتح دراسة حالة | `ViewCaseStudy` | `ViewContent` | `view_case_study` |

بإعلانات Meta حط بـ URL parameters: `utm_source={{site_source_name}}&utm_campaign={{campaign.name}}&utm_content={{ad.name}}`

## الأمان والأداء

- CSP صارمة بدون سكربتات أو ستايلات inline، HSTS، nosniff، منع iframe (`public/_headers` و`.htaccess`).
- RLS بقاعدة البيانات + honeypot ضد البوتات + قيود طول على الحقول.
- HTML ثابت مضغوط، CSS وJS بدون مكتبات، صور AVIF/WebP، تحميل كسول للصور، خط محلي مع preload.
- Canonical، hreflang، Open Graph (1200×630)، Schema (Person, WebSite, Service, FAQPage, BreadcrumbList, Blog, BlogPosting)، sitemap باللغتين.
