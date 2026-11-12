-- 춘천 꼬마 3D 메이커 · Supabase 설정
-- Supabase 대시보드 → SQL Editor 에 이 파일 전체를 붙여 넣고 Run 하세요. (여러 번 실행해도 안전)

-- 1) 수업방: 선생님 계정 하나가 여러 수업방을 가짐
create table if not exists public.rooms (
  code        text primary key check (code ~ '^[0-9]{4}$'),
  school      text not null,
  class_name  text not null,
  teacher_id  uuid not null references auth.users (id) on delete cascade,
  created_at  timestamptz not null default now()
);

-- 2) 제출 작품 (파일은 Storage 'works' 버킷의 {수업코드}/{작품id}/ 아래)
create table if not exists public.submissions (
  id            uuid primary key default gen_random_uuid(),
  room_code     text not null references public.rooms (code) on delete cascade,
  student_name  text not null check (char_length(student_name) between 1 and 10),
  mode          text not null,
  color         text not null,
  purpose       text not null default 'keyring',
  size_mm       int  not null,
  paint_colors  text[] not null default '{}',
  has_3mf       boolean not null default false,
  ready         boolean not null default false, -- 파일 업로드가 끝나면 true
  created_at    timestamptz not null default now()
);
create index if not exists submissions_room_idx on public.submissions (room_code, created_at desc);

-- 2-1) 표 사용 허락 (프로젝트에서 'Automatically expose new tables'를 꺼 둔 경우에도 동작하도록 직접 지정)
--      anon(로그인 안 한 사용자)에게는 아무것도 열지 않음 → 학생은 서버(API)를 거쳐서만 제출
revoke all on public.rooms, public.submissions from anon;
grant usage on schema public to authenticated, service_role;
grant select, insert, update, delete on public.rooms to authenticated;
grant select, delete on public.submissions to authenticated;
grant all on public.rooms, public.submissions to service_role;

-- 3) 접근 규칙(RLS): 선생님은 자기 수업방과 그 반 작품만.
--    학생은 계정이 없고, 작품 등록은 서버(API, secret 키)만 할 수 있음.
alter table public.rooms enable row level security;
alter table public.submissions enable row level security;

drop policy if exists "선생님은 자기 수업방" on public.rooms;
create policy "선생님은 자기 수업방" on public.rooms
  for all to authenticated
  using (teacher_id = auth.uid())
  with check (teacher_id = auth.uid());

drop policy if exists "선생님은 자기 반 작품 보기" on public.submissions;
create policy "선생님은 자기 반 작품 보기" on public.submissions
  for select to authenticated
  using (exists (select 1 from public.rooms r where r.code = room_code and r.teacher_id = auth.uid()));

drop policy if exists "선생님은 자기 반 작품 지우기" on public.submissions;
create policy "선생님은 자기 반 작품 지우기" on public.submissions
  for delete to authenticated
  using (exists (select 1 from public.rooms r where r.code = room_code and r.teacher_id = auth.uid()));

-- 4) 작품 파일 저장소 (비공개)
insert into storage.buckets (id, name, public)
values ('works', 'works', false)
on conflict (id) do nothing;

drop policy if exists "선생님은 자기 반 파일 보기" on storage.objects;
create policy "선생님은 자기 반 파일 보기" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'works'
    and (storage.foldername(name))[1] in (select code from public.rooms where teacher_id = auth.uid())
  );

drop policy if exists "선생님은 자기 반 파일 지우기" on storage.objects;
create policy "선생님은 자기 반 파일 지우기" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'works'
    and (storage.foldername(name))[1] in (select code from public.rooms where teacher_id = auth.uid())
  );

-- 5) 선생님 화면 실시간 반영
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'submissions'
  ) then
    alter publication supabase_realtime add table public.submissions;
  end if;
end $$;
