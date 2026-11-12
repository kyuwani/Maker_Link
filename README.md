# 춘천 꼬마 3D 메이커 (MVP)

초등학생이 학교 태블릿/스마트폰 브라우저에서 앱 설치 없이 3D 프린팅용 열쇠고리·이름표를 만드는 노코드 웹 플랫폼.

## 실행

```bash
npm install
npm run dev      # http://localhost:3000  (0.0.0.0으로 열려 같은 와이파이 기기에서 접속 가능)
```

| 경로 | 화면 |
| --- | --- |
| `/` (`/?code=1234`) | 학생 입장 (수업 코드 + 이름) |
| `/create` | 3D 만들기 (그림판 / 손그림 찍기: 종이 그림·동물·물건·사진 판) |
| `/complete` | 제출 완료 |
| `/teacher` | 교사 대시보드 (수업 코드·QR, 실시간 제출 현황, ZIP, 제작 의뢰서) |

## 구조

```
src/lib/services/      저장소 인터페이스(ClassroomService) + IndexedDB/BroadcastChannel 구현
src/lib/geometry/
  contours.ts          Marching Squares 윤곽 추적, 단순화, 구멍 판별, 팽창(dilate)
  raster.ts            Canvas 글자 마스크, 사진 → 흑백 이진화(조명 보정), 예시 그림
  templates.ts         (현재 화면에서 미사용) 별/하트/로켓/이름표/곰돌이 템플릿 + 이름 각인
  model.ts             돌출(베벨) + 이름 양각 + 고리 자동 배치 → 지오메트리(mm 단위)
src/components/        ModelViewer(R3F, frameloop="demand", STLExporter), 화면 컴포넌트
src/lib/export.ts      파일명 규칙, JSZip 일괄 다운로드, CSV
src/lib/drawpad.ts     그림판 획·AI 그림 레이어 저장/그리기/잉크 마스크 변환
src/app/api/design/    단어 → Google 이미지 AI 도안 (서버 전용, API 키 보관)
```

## 배포 (Vercel + Supabase)

자세한 순서는 [DEPLOY.md](DEPLOY.md). Supabase 환경 변수가 있으면 서버 저장 + 선생님 로그인(`/teacher/login`),
없으면 로컬 테스트 모드(브라우저 저장, 로그인 없음)로 동작합니다.

## (참고) 저장소 구조

`ClassroomService`(src/lib/services/types.ts)를 구현하는 `SupabaseClassroomService`를 만들고
`src/lib/services/index.ts`의 인스턴스만 바꾸면 됩니다. 권장 매핑:

- `rooms` 테이블, `submissions` 테이블(메타데이터) + Storage 버킷(STL/썸네일)
- `subscribeSubmissions` → Realtime `postgres_changes` 구독
- `strictRoomCheck = true` (서버 DB에서는 없는 수업 코드를 막음)

## 동물·물건 사진 모드 (AI 실루엣)

손그림 탭의 '🐶 동물·물건 사진'은 MediaPipe Interactive Segmenter(magic_touch 모델, Apache-2.0)를 브라우저에서 돌려
학생이 누른 물체의 실루엣을 오립니다. 실루엣 → 3mm 판, 물체 안의 어두운 부분(눈·코·무늬) → 1.2mm 양각, 맨 위에 고리.

- wasm 런타임: `npm install` 시 `public/mediapipe/wasm`으로 자동 복사(약 14.6MB, gzip 시 약 4~5MB, 처음 한 번만 받음)
- 모델: 기본은 Google 공식 저장소에서 로드. 학교망에서 막히면 `magic_touch.tflite`를 `public/models/`에 두고
  `NEXT_PUBLIC_SEGMENTER_MODEL_URL=/models/magic_touch.tflite`로 지정
- 몸체가 여러 조각으로 나뉘면(출력 시 떨어져 나감) 경고를 띄우고 제출을 막습니다.

## 사진 판 모드 (아무 이미지나)

손그림 탭의 '🖼️ 사진 판'은 AI 없이 어떤 사진이든 밝기 → 높이로 바꿔 둥근 네모 판에 새깁니다 (0.5mm 격자, 최대 200×200).
- 볼록 사진: 어두운 곳이 높게(2.0~3.6mm) — 어떤 색으로 뽑아도 입체로 보임
- 빛 사진(리소페인): 밝은 곳 0.8mm ~ 어두운 곳 3.2mm — 하얀색으로 뽑아 빛에 비추면 사진이 보임
- 사진 판은 닫힌(수밀) 높이맵 입체로 만들어 슬라이서에서 그대로 출력됩니다.

## 그림판 '단어로 도안 불러오기' (Google 이미지 AI)

학생이 단어를 쓰면 서버(`/api/design`)가 Google 이미지 AI에 굵은 선의 색칠공부 그림을 요청하고,
그 그림을 검은 선만 남긴 레이어로 그림판에 올립니다. 학생은 그 위에 지우개로 지우거나 덧그릴 수 있습니다.

1. `.env.example`을 `.env.local`로 복사하고 `GEMINI_API_KEY`를 넣습니다.
2. 서버를 다시 시작합니다.

- 외부로 나가는 정보는 학생이 쓴 단어뿐입니다(사진·이름은 보내지 않음).
- 같은 단어는 서버 메모리에 저장해 다시 요청하지 않습니다(서버를 재시작하면 비워짐). IP당 분당 6회 제한.
- 키가 없으면 학생 화면에 "AI 그림 기능이 아직 켜지지 않았어요"가 뜹니다.

## 알아둘 점

- 지금은 데이터가 **한 브라우저 안**에만 저장됩니다. 교사 탭과 학생 탭이 같은 브라우저일 때만 실시간 동기화되고,
  학생 폰 → 교사 PC 전송은 Supabase 등 서버 저장소로 교체해야 동작합니다.
- STL은 몸체·고리·양각을 겹친 여러 셸로 내보냅니다(불리언 합치기 없음). 일반 슬라이서(Cura, PrusaSlicer, Bambu Studio)는 자동으로 합쳐 출력합니다.
- 화면에서 이름 글자를 살짝 밝게 보이게 하지만, STL은 단색(선택 필라멘트 한 가지)입니다.
