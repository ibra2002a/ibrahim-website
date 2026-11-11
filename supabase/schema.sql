-- =========================================================
-- قاعدة بيانات الطلبات (Leads) — شغّل هذا الملف مرة وحدة في:
-- Supabase ← SQL Editor ← New query ← الصق ← Run
-- =========================================================

create table if not exists public.leads (
  id            bigint generated always as identity primary key,
  created_at    timestamptz not null default now(),
  name          text not null check (char_length(name) between 2 and 80),
  phone         text not null check (char_length(phone) between 6 and 20),
  business_type text check (char_length(business_type) <= 60),
  budget        text check (char_length(budget) <= 40),
  plan          text check (char_length(plan) <= 40),
  message       text check (char_length(message) <= 600),
  lang          text check (lang in ('ar', 'en')),
  source        text check (char_length(source) <= 120),
  campaign      text check (char_length(campaign) <= 120),
  attribution   jsonb,
  status        text not null default 'new'
                check (status in ('new', 'contacted', 'qualified', 'won', 'lost')),
  notes         text check (char_length(notes) <= 2000),
  updated_at    timestamptz not null default now()
);

create index if not exists leads_created_at_idx on public.leads (created_at desc);
create index if not exists leads_status_idx on public.leads (status);

-- تحديث updated_at تلقائيًا
create or replace function public.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
drop trigger if exists leads_touch on public.leads;
create trigger leads_touch before update on public.leads
  for each row execute function public.touch_updated_at();

-- =========================================================
-- المسؤولين: فقط المستخدمين بهذا الجدول يشوفون ويعدلون الطلبات
-- =========================================================
create table if not exists public.admins (
  user_id uuid primary key references auth.users (id) on delete cascade
);
alter table public.admins enable row level security;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;

-- =========================================================
-- الحماية (Row Level Security)
-- =========================================================
alter table public.leads enable row level security;

-- الزوار: يكدرون يضيفون طلب جديد فقط (ما يكدرون يقرون أو يعدلون أي شي)
drop policy if exists "public can submit leads" on public.leads;
create policy "public can submit leads" on public.leads
  for insert to anon, authenticated
  with check (status = 'new' and notes is null);

-- المسؤول: قراءة وتعديل وحذف
drop policy if exists "admins read leads" on public.leads;
create policy "admins read leads" on public.leads
  for select to authenticated using (public.is_admin());

drop policy if exists "admins update leads" on public.leads;
create policy "admins update leads" on public.leads
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "admins delete leads" on public.leads;
create policy "admins delete leads" on public.leads
  for delete to authenticated using (public.is_admin());

-- الزوار ما يكدرون يغيرون id أو التواريخ
revoke all on public.leads from anon;
grant insert (name, phone, business_type, budget, plan, message, lang, source, campaign, attribution)
  on public.leads to anon;

-- =========================================================
-- بعد إنشاء حسابك من Authentication ← Users ← Add user
-- شغّل هذا السطر وبدّل الإيميل بإيميلك:
-- insert into public.admins (user_id)
--   select id from auth.users where email = 'YOUR_EMAIL_HERE';
-- =========================================================
