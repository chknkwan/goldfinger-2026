-- ============================================================
--  GOLDFINGER — Supabase Schema
--  วิธีใช้: เปิด Supabase Dashboard → SQL Editor → วางทั้งหมดนี้ → Run
-- ============================================================

-- 1. ตารางนักเรียน
create table if not exists players (
  id          serial primary key,
  number      integer not null,          -- หมายเลขนักกีฬา (นับแยกตามระดับ)
  name        text not null,
  level       text not null check (level in ('มต้น','มปลาย')),
  room        text not null default '',
  created_at  timestamptz default now(),
  unique (number, level)
);

-- 2. ตารางการจัดโต๊ะ
create table if not exists table_assignments (
  id          serial primary key,
  game        integer not null,
  level       text not null,
  table_num   integer not null,
  sub_table   text not null,             -- เช่น '1A', '1B'
  player1_id  integer references players(id),
  player2_id  integer references players(id),
  is_bye      boolean default false,
  note        text default '',
  created_at  timestamptz default now(),
  unique (game, level, sub_table)
);

-- 3. ตารางผลการแข่งขัน (รอบคัดเลือก)
create table if not exists games (
  id          serial primary key,
  game        integer not null,
  level       text not null,
  table_num   integer not null,
  sub_table   text not null,
  player1_id  integer references players(id),
  score1      integer,
  player2_id  integer references players(id),
  score2      integer,
  saved_at    timestamptz default now(),
  updated_at  timestamptz default now(),
  unique (game, level, sub_table)
);

-- 4. ตารางเพลย์ออฟ
create table if not exists playoffs (
  id          serial primary key,
  level       text not null,
  round       text not null,             -- 'รองชนะเลิศ' | 'ชิงชนะเลิศ'
  pair_no     integer not null,
  player1_id  integer references players(id),
  score1      integer,
  player2_id  integer references players(id),
  score2      integer,
  saved_at    timestamptz default now(),
  updated_at  timestamptz default now(),
  unique (level, round, pair_no)
);

-- 5. ตาราง broadcast (แจ้งเตือน realtime จาก admin)
create table if not exists broadcast (
  id          serial primary key,
  type        text not null,             -- 'current_game' | 'reset' | 'message'
  level       text,
  payload     jsonb default '{}',
  created_at  timestamptz default now()
);

-- ============================================================
--  Enable Realtime
-- ============================================================
alter publication supabase_realtime add table games;
alter publication supabase_realtime add table table_assignments;
alter publication supabase_realtime add table playoffs;
alter publication supabase_realtime add table broadcast;

-- ============================================================
--  Seed Data — นักเรียน ม.ต้น (26 คน)
-- ============================================================
insert into players (number, name, level, room) values
(1,  'เด็กหญิงธนัญชนก สิทธิวุฒิ',         'มต้น', 'ม.3/5'),
(2,  'เด็กหญิงธนัชชา กระจ่างถ้อย',         'มต้น', 'ม.3/5'),
(3,  'เด็กหญิงพรวิสา คำสุข',               'มต้น', 'ม.3/13'),
(4,  'เด็กหญิงภัทรนันท์ ภาจำปา',           'มต้น', 'ม.3/11'),
(5,  'เด็กหญิงณัฐชยา โพธิ์ศรี',            'มต้น', 'ม.3/13'),
(6,  'เด็กหญิงธิดากาญจน์ รัตนธนะเศรษฐ์',  'มต้น', 'ม.3/2'),
(7,  'เด็กหญิงกมลชนก อะนัน',              'มต้น', 'ม.3/2'),
(8,  'เด็กหญิงเมธาวี ศรีแก้ว',             'มต้น', 'ม.3/2'),
(9,  'เด็กชายธีรภัทร เพ็ชรัตน์',           'มต้น', 'ม.1/15'),
(10, 'เด็กชายปริญญา รื่นเริง',             'มต้น', 'ม.1/15'),
(11, 'เด็กชายจิราวัฒน์ ผุยพันธ์',          'มต้น', 'ม.3/5'),
(12, 'เด็กหญิงสุภานัน จินดาพร',            'มต้น', 'ม.3/5'),
(13, 'เด็กชายวโรดม โคตรสุรินทร์',          'มต้น', 'ม.3/5'),
(14, 'เด็กหญิงกิติณา จันทะเพชร',           'มต้น', 'ม.3/13'),
(15, 'เด็กหญิงเกวลิน สายสินธุ์',           'มต้น', 'ม.2/15'),
(16, 'เด็กหญิงณัชชา นาลาด',               'มต้น', 'ม.3/5'),
(17, 'เด็กหญิงอภิชญา จันโสดา',             'มต้น', 'ม.3/5'),
(18, 'เด็กหญิงวิภาดา ทรัพย์ประเสริฐ',      'มต้น', 'ม.2/3'),
(19, 'เด็กหญิงธัญญภัสร์ สงนอก',           'มต้น', 'ม.2/3'),
(20, 'เด็กหญิงกาญกัลยา สันติดสุข',         'มต้น', 'ม.1/9'),
(21, 'เด็กหญิงอริสา เดือนไธสง',            'มต้น', 'ม.1/9'),
(22, 'เด็กหญิงนิตยา อินทรีย์',             'มต้น', 'ม.1/9'),
(23, 'เด็กชายกฤติธี พรมสิงห์',             'มต้น', 'ม.3/7'),
(24, 'เด็กหญิงกนกกาญจน์ จันทร์หอม',        'มต้น', 'ม.3/7'),
(25, 'เด็กหญิงสุทธิดา ปิ่นศิริ',           'มต้น', 'ม.3/7'),
(26, 'เด็กชายธนดล ทองมี',                  'มต้น', 'ม.3/7')
on conflict (number, level) do nothing;

-- ============================================================
--  Seed Data — นักเรียน ม.ปลาย (26 คน)
-- ============================================================
insert into players (number, name, level, room) values
(1,  'นางสาวมณณัฐชา ไชยนา',          'มปลาย', 'ม.4/2'),
(2,  'นางสาวนภัสรา มาสิงห์',          'มปลาย', 'ม.4/2'),
(3,  'นางสาววรกมล ขันดี',             'มปลาย', 'ม.4/2'),
(4,  'นางสาวกมลพร ศรีเวช',            'มปลาย', 'ม.4/2'),
(5,  'นางสาวภิญญาดา สุขเจริญ',        'มปลาย', 'ม.4/2'),
(6,  'นางสาวกชกร แปลกหน้า',           'มปลาย', 'ม.4/2'),
(7,  'นางสาววริศรา พุ่งอุไร',          'มปลาย', 'ม.6/3'),
(8,  'นางสาวฐิติพร ศรีภาชัย',          'มปลาย', 'ม.5/5'),
(9,  'นางสาวสิริยากร กิจกล้า',         'มปลาย', 'ม.5/5'),
(10, 'นางสาววิญาดา เอี่ยมอ่อน',        'มปลาย', 'ม.5/5'),
(11, 'นางสาวอรพรรณ แสงตามี',          'มปลาย', 'ม.6/6'),
(12, 'นางสาวอนัญญา มั่งคั่ง',          'มปลาย', 'ม.6/7'),
(13, 'นายเอถวัฒน์ ออทอลาน',           'มปลาย', 'ม.6/8'),
(14, 'นายณัฐวุฒิ อนุสรณ์',            'มปลาย', 'ม.5/2'),
(15, 'นายจิรายุ สีสวย',               'มปลาย', 'ม.5/2'),
(16, 'นายลิขิต บุญต่อ',               'มปลาย', 'ม.5/2'),
(17, 'นายนันทวัฒน์ วารักดี',           'มปลาย', 'ม.5/2'),
(18, 'นางสาวณัฐกฤตา เหมือนศาสตร์',    'มปลาย', 'ม.5/7'),
(19, 'นางสาวนราภรณ์ สุขเกษม',         'มปลาย', 'ม.5/7'),
(20, 'นายหัสดินทร์ ละม้าย',            'มปลาย', 'ม.5/3'),
(21, 'นายพงศกร พระขัย',               'มปลาย', 'ม.5/3'),
(22, 'นายธนันชัย ปลื้มสวาสดิ์',        'มปลาย', 'ม.4/7'),
(23, 'นายธเนษฐ สามารถกูล',            'มปลาย', 'ม.4/7'),
(24, 'นางสาวพลอยชมภู เศษพิมพ์',       'มปลาย', 'ม.6/7'),
(25, 'นายฤทธิรงค์ หีบแก้ว',            'มปลาย', 'ม.6/3'),
(26, 'นายภูริทัติ อ้นลา',              'มปลาย', 'ม.4/6')
on conflict (number, level) do nothing;
