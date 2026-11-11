/**
 * إعدادات الموقع — عدّل هنا بدون ما تلمس باقي الكود.
 * Site configuration — edit values here only.
 */
window.SITE_CONFIG = {
  brandName: "إبراهيم المهاوش",
  // رقم الواتساب بالصيغة الدولية بدون + (العراق: 964 + الرقم بدون الصفر)
  whatsappNumber: "9647711094000",
  instagramUrl: "https://www.instagram.com/ibrahim.media.iq",
  whatsappGreeting: "مرحبا، أريد استشارة بخصوص الحملات الإعلانية",
  whatsappGreetingEn: "Hi Ibrahim, I'd like a consultation about ad campaigns",
  currency: "$",

  // ===== قاعدة البيانات (Supabase) =====
  // Project Settings ← API. المفتاح anon آمن للنشر لأن الصلاحيات محمية بـ RLS.
  supabaseUrl: "",       // مثال: https://abcd1234.supabase.co
  supabaseAnonKey: "",

  // ===== التتبع (Pixels) =====
  // حط الـ ID وينشغل تلقائيًا. اتركه فارغ إذا ما تستخدمه.
  tracking: {
    metaPixelId: "",     // Events Manager ← Data Sources ← Pixel ID (أرقام فقط)
    tiktokPixelId: "",   // TikTok Ads Manager ← Assets ← Events ← Web Events
    ga4Id: "",           // Google Analytics ← Admin ← Data Streams (يبدأ بـ G-)
    debug: false         // true حتى تشوف الأحداث بالـ Console أثناء التجربة
  }
};
