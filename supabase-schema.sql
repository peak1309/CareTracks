-- ==============================================================================
-- CareTrack Edu - ฐานข้อมูลระบบติดตามนักศึกษาขาดเรียนบ่อย (Supabase SQL Schema)
-- สำหรับ: วิทยาลัยการอาชีพเวียงสระ
-- เวอร์ชันนี้: ไม่มีข้อมูลตัวอย่าง (ตารางว่างเปล่า พร้อมใช้งานจริง)
-- คำแนะนำ: คัดลอกโค้ดทั้งหมดนี้ไปวางในเมนู SQL Editor ในหน้า Dashboard ของ Supabase แล้วกด "Run"
-- ==============================================================================

-- 1. ตารางข้อมูลนักศึกษา (students)
create table if not exists public.students (
  id uuid primary key default gen_random_uuid(),
  student_code text not null unique,                  -- รหัสนักศึกษา เช่น 662090101
  prefix text not null default 'นาย',                 -- คำนำหน้า
  first_name text not null,                           -- ชื่อ
  last_name text not null,                            -- นามสกุล
  classroom text not null,                            -- ห้องเรียน เช่น ปวช.2/1 ช่างยนต์
  class_id text not null,                             -- รหัสห้องเรียน เช่น auto_v1
  advisor_id text not null,                           -- รหัสครูที่ปรึกษา เช่น ADV01
  advisor_name text not null,                         -- ชื่อครูที่ปรึกษา
  phone text default '',                              -- เบอร์โทรนักศึกษา
  parent_name text default '',                        -- ชื่อผู้ปกครอง
  parent_phone text default '',                       -- เบอร์โทรผู้ปกครอง
  avatar_bg text default 'bg-blue-500',               -- สีประจำตัว
  total_classes integer not null default 15,          -- จำนวนคาบเรียนทั้งหมด
  attended integer not null default 0,                -- จำนวนคาบที่มาเรียน
  late integer not null default 0,                    -- จำนวนคาบที่มาสาย
  leave integer not null default 0,                   -- จำนวนคาบที่ลา
  absent integer not null default 0,                  -- จำนวนคาบที่ขาด
  consecutive_absent integer not null default 0,      -- ขาดติดต่อกันกี่วัน
  risk_level text not null default 'safe',            -- ระดับความเสี่ยง: danger, warning, safe, resolved
  case_status text not null default 'none',           -- สถานะการดูแล: unassigned, in_progress, resolved, escalated, none
  primary_risk_reason text default '',                -- สาเหตุความเสี่ยงหลัก
  last_absent_date text default '',                   -- วันที่ขาดเรียนล่าสุด
  last_intervention_date text default '',             -- วันที่ได้รับการดูแลล่าสุด
  notes text default '',                              -- หมายเหตุเพิ่มเติม
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 2. ตารางบันทึกการเช็คชื่อรายคาบ (attendance_records)
create table if not exists public.attendance_records (
  id uuid primary key default gen_random_uuid(),
  student_id uuid references public.students(id) on delete cascade,
  student_code text not null,
  student_name text not null,
  course_code text not null,                          -- รหัสวิชา เช่น ENG201
  course_name text not null,                          -- ชื่อวิชา
  class_id text not null,
  date date not null default current_date,            -- วันที่เช็คชื่อ
  status text not null,                               -- มา: present, สาย: late, ลา: leave, ขาด: absent
  recorded_by text default '',                        -- ผู้บันทึก (อาจารย์ผู้สอน)
  created_at timestamptz not null default now()
);

-- 3. ตารางบันทึกการดูแลและช่วยเหลือรายกรณี (care_logs)
create table if not exists public.care_logs (
  id uuid primary key default gen_random_uuid(),
  student_id uuid references public.students(id) on delete cascade,
  student_code text not null,
  student_name text not null,
  date date not null default current_date,            -- วันที่ติดตาม
  time text default '',                               -- เวลา
  advisor_name text not null,                         -- ครูที่ปรึกษาผู้ติดตาม
  contact_channel text not null,                      -- ช่องทาง: phone_parent, phone_student, in_person, visit_home, line
  channel_label text not null,                        -- ป้ายข้อความช่องทาง
  details text not null,                              -- รายละเอียดปัญหาที่พบ
  action_taken text not null,                         -- แนวทางช่วยเหลือและมาตรการที่ดำเนินการ
  next_follow_up_date text default '-',               -- วันที่นัดติดตามผลรอบต่อไป
  status text not null default 'in_progress',         -- in_progress, resolved, escalated
  status_label text not null,                         -- กำลังติดตาม, แก้ไขสำเร็จ, ส่งต่อ
  created_at timestamptz not null default now()
);

-- 4. ตารางประวัติการแจ้งเตือน (alerts)
create table if not exists public.alerts (
  id uuid primary key default gen_random_uuid(),
  student_id uuid references public.students(id) on delete cascade,
  student_code text not null,
  student_name text not null,
  course_code text default '',
  course_name text default '',
  advisor_id text default '',
  advisor_name text default '',
  level text not null default 'warning',              -- danger, warning, info
  type text not null default 'absence',
  title text not null,
  message text not null,
  is_read boolean not null default false,
  line_sent boolean not null default true,
  timestamp text default '',
  created_at timestamptz not null default now()
);

-- Indexes สำหรับการค้นหาอย่างรวดเร็ว
create index if not exists idx_students_code on public.students(student_code);
create index if not exists idx_students_risk on public.students(risk_level);
create index if not exists idx_students_classroom on public.students(class_id);
create index if not exists idx_attendance_date on public.attendance_records(date);
create index if not exists idx_carelogs_student on public.care_logs(student_id);
create index if not exists idx_alerts_advisor on public.alerts(advisor_id);

-- เปิดใช้งาน Row Level Security (RLS)
alter table public.students enable row level security;
alter table public.attendance_records enable row level security;
alter table public.care_logs enable row level security;
alter table public.alerts enable row level security;

-- Policies เพื่อให้ Frontend สามารถ อ่าน/เขียน ข้อมูลได้ผ่าน anon public key
drop policy if exists "Allow all on students" on public.students;
create policy "Allow all on students" on public.students for all using (true) with check (true);

drop policy if exists "Allow all on attendance_records" on public.attendance_records;
create policy "Allow all on attendance_records" on public.attendance_records for all using (true) with check (true);

drop policy if exists "Allow all on care_logs" on public.care_logs;
create policy "Allow all on care_logs" on public.care_logs for all using (true) with check (true);

drop policy if exists "Allow all on alerts" on public.alerts;
create policy "Allow all on alerts" on public.alerts for all using (true) with check (true);

-- ==============================================================================
-- (ไม่บังคับ) ล้างข้อมูลตัวอย่างเดิม
-- ใช้เฉพาะกรณีที่เคยรันสคริปต์เวอร์ชันเก่าที่มีข้อมูลตัวอย่างไปแล้ว
-- วิธีใช้: ลบเครื่องหมาย -- หน้าบรรทัดด้านล่าง แล้วรันเฉพาะส่วนนี้
-- หมายเหตุ: care_logs ตัวอย่างไม่ได้ผูก student_id จึงต้องลบตาม student_code ก่อน
-- ==============================================================================
-- delete from public.care_logs where student_code in ('662090101', '662090119');
-- delete from public.students where student_code in ('662090101', '663020104', '663090205', '662090112', '662090119', '663020118');