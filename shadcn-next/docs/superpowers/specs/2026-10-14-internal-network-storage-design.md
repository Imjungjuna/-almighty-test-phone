# 테스트폰 앱 내부망 공유 저장소 전환 설계

- 작성일: 2026-10-14
- 대상: `almighty-test-phone/shadcn-next` (Next.js 16, React 19)
- 상태: 승인됨 (대화 중 구두 승인)

## 1. 목적

현재 앱은 대여자·기기 상태·배너 문구를 브라우저 `localStorage`에 저장하므로 iPad 한 대에서만 현황이 보인다. 이를 사내망의 서버 저장소로 옮겨 팀원 누구나 자기 폰·PC에서 같은 대여 현황을 보고 조작할 수 있게 한다.

성공 기준:
- iPad에서 대여 처리하면 5초 안에 다른 기기 브라우저에 반영된다.
- 두 기기에서 같은 테스트폰을 동시에 대여해도 한 건만 성공하고, 실패한 쪽은 안내를 받는다.
- 서버를 돌리는 맥을 재부팅해도 로그인 후 서버가 자동으로 올라오고 데이터가 보존된다.
- 기존 Vercel 배포(`main`)는 그대로 남아, iPad 북마크를 Vercel 주소로 되돌리면 옛 버전으로 즉시 복귀할 수 있다.

## 2. 범위

포함:
- API 라우트 추가, SQLite 저장소, 화면의 저장 계층 교체, 폴링, 연결 끊김 표시, pm2 자동 실행, 일일 백업, README 운영 절차(롤백 포함).

제외:
- 기기 목록 편집(코드 상수 유지), 인증/권한, HTTPS, 지문·얼굴 인식, 외부망 접근, 낙관적 갱신, 실시간 푸시(SSE/WebSocket).
- 기존 localStorage 데이터 이전. 옛 버전과 새 버전은 origin이 달라 localStorage를 공유하지 못하며, 데이터 규모가 작아 새 버전에서 대여자를 다시 등록한다.

## 3. 배포 경로와 되돌리기

- 현재 `main`은 Vercel Production(`https://almighty-test-phone-*.vercel.app`)에 배포돼 있고 localStorage 버전이다. **`main`은 건드리지 않는다.**
- 서버 버전은 `server` 브랜치에서 개발·운영한다. 서버 맥은 이 브랜치를 체크아웃해 실행한다.
- `server` 브랜치에는 `vercel.json`으로 해당 브랜치의 Vercel 자동 배포를 끈다(`git.deploymentEnabled.server = false`). 네이티브 모듈과 파일 DB가 Vercel에서 동작하지 않기 때문이다.
- 되돌리기: iPad 홈 화면 아이콘을 Vercel 주소로 다시 추가한다. 데이터는 옛 버전의 localStorage에 남아 있던 시점으로 돌아간다.
- 제약: Vercel 프로젝트는 개인 계정(`topeanuts-projects`) 소속이다. 계정 이관은 이번 범위 밖이다.

## 3-1. 운영 환경

- 서버: 사용자 본인 MacBook Pro(Mac16,8), Node 24. 전원 어댑터 연결 시 잠자기 안 함 설정은 이미 켜져 있음. 덮개 닫힘·전원 분리·재부팅 후 로그인 전에는 서비스가 멈추며, 이는 허용된 제약이다.
- 접속 주소: `http://ljhs-MacBook-Pro.local:3000`. Bonjour가 막힌 Wi-Fi이면 고정 IP(DHCP 예약)로 대체한다.
- 데이터 경로: `~/test-phone-data/test-phone.db`. 프로젝트 디렉터리 밖에 두어 `git pull`·재빌드와 분리한다. 경로는 환경변수 `TEST_PHONE_DB_PATH`로 바꿀 수 있고, 미설정 시 위 기본값을 쓴다.
- 프로세스: `pm2`로 `next start` 실행, `pm2 startup` + `pm2 save`로 로그인 시 자동 시작. 비정상 종료 시 pm2가 재시작한다.
- 백업: launchd 작업이 매일 04:00에 DB 파일을 `~/test-phone-data/backup/test-phone-YYYYMMDD.db`로 복사하고 7일보다 오래된 파일을 지운다.

## 4. 데이터 모델

SQLite, `better-sqlite3` 사용. 모든 쓰기는 트랜잭션 안에서 수행한다.

```sql
CREATE TABLE IF NOT EXISTS borrowers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  organization TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS phone_states (
  phone_id TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('available','borrowed')),
  loan_borrower_id TEXT,
  loan_at TEXT,
  return_borrower_id TEXT,
  return_at TEXT
);

CREATE TABLE IF NOT EXISTS banner_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);
```

- 기기 목록 `PHONES`는 코드 상수로 유지한다. `phone_states`에 행이 없는 기기는 `available`로 간주한다(현재 `ensurePhoneState`와 동일).
- 날짜는 모두 ISO 8601 문자열.
- 서버가 처음 뜰 때 테이블을 생성하고, `banner_messages`가 비어 있으면 현재 코드의 `MOTIVATION_MESSAGES` 2건을 넣는다.
- 대여자 삭제 시 `phone_states`의 `return_borrower_id`가 그 사람을 가리킬 수 있다. 현재 코드와 동일하게 참조를 남겨두고 화면에서 이름을 못 찾으면 "알 수 없음"으로 표시한다.

## 5. API

모든 응답은 JSON. 쓰기 요청은 성공 시 아래 `AppState` 전체를 반환해 화면이 즉시 맞춰지게 한다.

```ts
type AppState = {
  borrowers: Borrower[];        // 현재 타입 그대로
  phones: PhoneStateMap;        // 현재 타입 그대로, 모든 PHONES 키 포함
  bannerMessages: string[];
  serverTime: string;           // ISO
};
```

| 메서드 | 경로 | 요청 본문 | 성공 | 실패 |
|---|---|---|---|---|
| GET | `/api/state` | - | 200 AppState | - |
| POST | `/api/phones/[id]/borrow` | `{ borrowerId }` | 200 AppState | 404 기기/대여자 없음, 409 이미 대여 중 |
| POST | `/api/phones/[id]/transfer` | `{ borrowerId }` | 200 AppState | 404, 409 대여 중 아님 또는 같은 사람 |
| POST | `/api/phones/[id]/return` | `{}` | 200 AppState | 404, 409 대여 중 아님 |
| POST | `/api/borrowers` | `{ name, organization }` | 200 AppState | 400 빈 값 |
| DELETE | `/api/borrowers/[id]` | - | 200 AppState | 404, 409 대여 중인 사람 |
| POST | `/api/banner` | `{ message }` | 200 AppState | 400 빈 값 (중복은 무시하고 200) |

- 실패 응답 본문: `{ error: string }` (한국어 안내 문구).
- 모든 라우트는 Node 런타임(`export const runtime = "nodejs"`)에서 실행한다.
- 입력은 `sanitizePhoneStates`와 같은 수준으로 서버에서 검증한다. 알 수 없는 `phoneId`는 404.

## 6. 화면 변경 (`src/app/page.tsx`)

- 제거: localStorage 읽기 `useEffect` 1개, 쓰기 `useEffect` 3개, 저장 키 상수 3개.
- 추가: 마운트 시 `GET /api/state` 1회 → `hydrated = true`. 이후 5초 간격 폴링. 탭이 숨겨져 있으면(`document.hidden`) 폴링을 건너뛴다.
- 핸들러(`handleStartLoan`, `handleTransferLoan`, `handleReturnLoan`, `handleAddBorrower`, `handleDeleteBorrower`, `handleAddBannerMessage`)는 로컬 `setState` 대신 API를 호출하고, 응답 AppState로 세 상태를 한 번에 교체한다. 요청 중에는 해당 버튼을 비활성화한다.
- 409 응답: 다이얼로그를 닫고 상단에 토스트성 안내("방금 다른 기기에서 처리됐습니다")를 3초 표시한 뒤 최신 상태로 갱신한다. 토스트는 shadcn 추가 없이 간단한 고정 위치 `div`로 구현한다.
- 연결 실패(네트워크 오류 또는 5xx): 헤더에 "서버 연결 끊김" 배지를 띄우고 모든 조작 버튼을 비활성화한다. 다음 폴링이 성공하면 자동 해제.
- `currentTime` 1분 간격 갱신은 유지하되, 폴링 응답의 `serverTime`으로 보정하지 않는다(기기 시계 사용).
- UI 레이아웃·다이얼로그·배너 컴포넌트는 변경하지 않는다.

파일 구성:
- `src/lib/db.ts`: SQLite 연결(싱글턴), 스키마 생성, 시드, 읽기/쓰기 함수. 서버 전용.
- `src/lib/types.ts`: `Borrower`, `PhoneState`, `PhoneStateMap`, `AppState` 등 공용 타입. `page.tsx`에서 옮겨온다.
- `src/lib/phones.ts`: `PHONES`, `PHONE_BY_ID` 상수. `page.tsx`에서 옮겨온다.
- `src/lib/api.ts`: 브라우저용 fetch 래퍼. 실패 시 `ApiError { status, message }` throw.
- `src/app/api/**/route.ts`: 위 표의 라우트.

## 7. 초기 데이터

- 서버 DB는 비어 있는 상태로 시작한다. 배너는 기본 2건이 시드된다.
- 대여자는 새 버전에서 다시 등록한다. 옛 버전의 대여 이력은 옮기지 않는다.

## 8. 오류 처리 원칙

- 서버: 모든 라우트는 try/catch로 감싸 500 + `{ error }`를 반환하고 콘솔에 로그를 남긴다. DB 파일 경로가 없으면 디렉터리를 만든다.
- 클라이언트: 4xx는 사용자 안내, 네트워크 오류·5xx는 "연결 끊김" 상태로 전환. 요청 실패 시 로컬 상태를 바꾸지 않는다.

## 9. 테스트

- 단위(`db.ts`, 라우트 핸들러): 임시 디렉터리의 SQLite 파일을 사용. 대여→이관→반납 순서, 대여 중 대여자 삭제 거부, 동시 대여 2건 중 1건만 성공, 빈 입력 400.
- 테스트 러너는 프로젝트에 없으므로 `vitest`를 devDependency로 추가한다.
- 수동: `pm2`로 띄운 뒤 iPad Safari와 데스크톱 브라우저에서 대여·반납이 5초 안에 서로 반영되는지, 네트워크를 끊었을 때 배지가 뜨고 복구되는지 확인한다.

## 10. 운영 절차 (README에 기록)

0. `git checkout server`
1. `npm run build` → `pm2 start npm --name test-phone -- start`
2. `pm2 startup` 출력 명령 실행 → `pm2 save`
3. 백업 launchd plist 설치(`docs/ops/com.cashdoc.test-phone-backup.plist` 예시 제공)
4. iPad Safari에서 주소 열기 → 공유 → 홈 화면에 추가
5. 코드 갱신 시: `git pull` → `npm run build` → `pm2 restart test-phone`
6. 되돌리기: iPad에서 Vercel 주소를 홈 화면에 다시 추가. 서버는 `pm2 stop test-phone`

## 11. 알려진 제약

- 인증이 없어 사내망 누구나 조작 가능.
- 서버 맥이 덮개 닫힘·전원 분리·로그인 전 상태면 서비스 중단. 데이터는 보존.
- Wi-Fi 클라이언트 격리가 켜진 망에서는 접속 불가.
- `better-sqlite3`는 네이티브 모듈이라 Node 메이저 버전 변경 시 `npm rebuild` 필요.
