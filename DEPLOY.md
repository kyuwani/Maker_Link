# 배포 안내 (Vercel + Supabase)

학생은 휴대폰·태블릿으로, 선생님은 PC로 접속하는 실제 수업용 배포 순서예요.
계정 가입·로그인·결제 정보 입력은 직접 해 주셔야 해요.

## 1. Supabase 만들기 (데이터베이스 · 작품 파일 · 선생님 계정)

1. https://supabase.com 가입 → **New project**
   - Region: **Northeast Asia (Seoul)** 추천
   - Database password는 따로 잘 보관 (앱에는 안 씀)
2. 왼쪽 **SQL Editor** → 이 저장소의 `supabase/schema.sql` 내용을 전부 붙여 넣고 **Run**
   - 수업방·작품 표, 작품 파일 저장소(works), "선생님은 자기 반 것만" 접근 규칙, 실시간 반영이 만들어져요.
3. **Project Settings → API Keys / Data API** 에서 세 값을 복사
   - Project URL → `NEXT_PUBLIC_SUPABASE_URL`
   - Publishable key(예전 이름 anon) → `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
   - Secret key(예전 이름 service_role) → `SUPABASE_SECRET_KEY`  ⚠️ 비밀, 공개 금지

## 2. 내 PC에서 먼저 확인 (선택이지만 추천)

1. `.env.example` → `.env.local` 로 복사하고 위 세 값 + (원하면) `TEACHER_SIGNUP_CODE` 입력
2. `npm run dev` → http://localhost:3000/teacher → **선생님 가입** → 수업 코드 만들기
3. 휴대폰(같은 와이파이)으로 QR 접속 → 제출 → PC 대시보드에 바로 뜨는지 확인

## 3. Vercel에 배포

1. 코드를 GitHub 저장소에 올리기 (또는 `npx vercel` 명령으로 바로 올리기)
2. https://vercel.com → **Add New → Project** → 저장소 선택 (Framework: Next.js 자동)
3. **Environment Variables** 에 `.env.example` 의 항목을 입력
   - `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`
   - `GEMINI_API_KEY` (AI 그림), `TEACHER_SIGNUP_CODE` (선택)
4. **Deploy** → `https://<이름>.vercel.app` 주소가 생겨요.
5. 배포 주소의 `/teacher` 에서 가입·로그인 → 수업 코드 → 칠판에 QR

## 알아 두기

- 학생 이름과 작품은 Supabase(외부 서비스)에 저장돼요. 학교 개인정보 동의 절차를 확인해 주세요.
  (학생은 계정이 없고, 이름은 실명 대신 번호·별명을 써도 돼요.)
- 무료 요금제 기준: Supabase는 오래 안 쓰면 프로젝트가 일시 정지될 수 있어요(대시보드에서 다시 켜기).
- AI 그림은 Google 결제 계정에 비용이 나가요. 수업 코드가 있는 학생만 요청할 수 있게 막혀 있어요.
- 교사 대시보드는 로그인한 선생님만, 자기 수업방의 작품만 볼 수 있어요.
