# 테스트폰 앱 내부망 저장소 전환 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 브라우저 localStorage에 저장되던 대여자·기기 상태·배너를 Next.js API + SQLite로 옮겨, 사내망의 모든 기기가 같은 대여 현황을 보고 조작하게 한다.

**Architecture:** 같은 Next.js 프로젝트에 Node 런타임 API 라우트를 추가하고 `better-sqlite3`로 단일 DB 파일에 저장한다. 화면은 5초 폴링으로 `/api/state`를 읽고, 모든 쓰기는 API를 호출한 뒤 응답으로 받은 전체 상태(`AppState`)로 교체한다. 낙관적 갱신은 하지 않는다.

**Tech Stack:** Next.js 16 (App Router, route handlers), React 19, TypeScript, better-sqlite3, vitest, pm2.

**Spec:** `docs/superpowers/specs/2026-10-14-internal-network-storage-design.md`

## Global Constraints

- Node 24 (현재 서버 맥). `better-sqlite3`는 네이티브 모듈이므로 설치 후 로드가 되는지 Task 1에서 확인한다.
- 모든 API 라우트는 `export const runtime = "nodejs"`.
- DB 경로: 환경변수 `TEST_PHONE_DB_PATH`, 미설정 시 `~/test-phone-data/test-phone.db`.
- 날짜는 ISO 8601 문자열. 응답 에러 본문은 `{ error: string }` 한국어.
- 기기 목록 `PHONES` 7대는 코드 상수 유지. 기기 추가 기능 없음.
- UI 레이아웃·다이얼로그·배너 컴포넌트는 변경하지 않는다. 추가 UI는 연결 끊김 배지, 토스트뿐.
- 파일 수정 후 `npm run lint`가 깨끗해야 한다(사용자 규칙).
- 모든 작업은 `server` 브랜치에서 한다. `main`은 Vercel 배포(옛 localStorage 버전)이므로 건드리지 않는다.
- 커밋 단계는 플랜에 포함하되, 실행 시 사용자가 커밋 여부를 확인한다(사용자 규칙: 요청 시에만 커밋).

## Review Focus

1. 대여 중인 기기를 두 클라이언트가 동시에 대여 요청 → 한 건만 200, 나머지는 409이고 DB는 첫 번째 대여자만 기록. (Task 4 테스트)
2. 알 수 없는 `phoneId`(`/api/phones/zzz/borrow`) → 404이며 DB에 행이 생기지 않는다. (Task 4·5 테스트)
3. 이름이 공백만인 대여자 추가 → 400이고 DB 변화 없음. (Task 4 테스트)
4. 본문이 JSON이 아니거나 `borrowerId`가 빠진 요청 → 400이고 DB 변화 없음. (Task 5 테스트)
5. 서버가 꺼진 상태에서 대여 버튼 클릭 → 화면은 "서버 연결 끊김" 배지를 띄우고 로컬 상태를 바꾸지 않으며, 서버 복구 후 다음 폴링에서 배지가 사라진다. (Task 7 수동 검증 + `api.ts` 단위 테스트)

---

## 파일 구조

| 파일 | 책임 |
|---|---|
| `src/lib/phones.ts` | `PHONES` 상수, `PHONE_BY_ID`, `PhoneDefinition`/`PhoneId`/`Platform` 타입 (page.tsx에서 이동) |
| `src/lib/types.ts` | `Borrower`, `LoanInfo`, `ReturnInfo`, `PhoneState`, `PhoneStateMap`, `AppState` |
| `src/lib/phone-state.ts` | `createDefaultPhoneStates`, `sanitizePhoneStates`, `ensurePhoneState` 순수 함수 (page.tsx에서 이동) |
| `src/lib/db.ts` | `Store` 클래스(SQLite 연결·스키마·시드·읽기/쓰기), `StoreError`, `getStore()` 싱글턴 |
| `src/lib/api-server.ts` | 라우트 공통: JSON 파싱, `StoreError`→HTTP 변환, 500 처리 |
| `src/lib/api.ts` | 브라우저용 fetch 래퍼, `ApiError` |
| `src/app/api/state/route.ts` | GET 전체 상태 |
| `src/app/api/phones/[id]/borrow/route.ts` 외 transfer, return | 기기 쓰기 |
| `src/app/api/borrowers/route.ts`, `src/app/api/borrowers/[id]/route.ts` | 대여자 추가·삭제 |
| `src/app/api/banner/route.ts` | 배너 추가 |
| `src/app/page.tsx` | 저장 계층 교체, 폴링, 배지·토스트 |
| `vitest.config.ts`, `src/lib/*.test.ts`, `src/app/api/**/*.test.ts` | 테스트 |
| `vercel.json` | `server` 브랜치의 Vercel 자동 배포 비활성화 |
| `scripts/backup-db.sh`, `docs/ops/com.cashdoc.test-phone-backup.plist`, `README.md` | 운영·롤백 절차 |

---

### Task 0: `server` 브랜치 생성과 Vercel 배포 차단

**Files:**
- Create: `vercel.json`

- [ ] **Step 1: 브랜치 생성**

```bash
git checkout -b server main
```

- [ ] **Step 2: `vercel.json` 작성**

```json
{
  "git": {
    "deploymentEnabled": {
      "server": false
    }
  }
}
```

- [ ] **Step 3: 커밋**

```bash
git add vercel.json docs/superpowers
git commit -m "chore: start server branch; disable Vercel deploys for it"
```

이후 모든 태스크는 이 브랜치에서 진행한다. `main`으로 `git push`하지 않는다.

---

### Task 1: 의존성과 테스트 러너 설치

**Files:**
- Modify: `package.json`
- Create: `vitest.config.ts`
- Create: `src/lib/smoke.test.ts`

**Interfaces:**
- Produces: `npm test` 명령, `@/` 경로 별칭이 vitest에서 동작.

- [ ] **Step 1: 패키지 설치**

```bash
npm install better-sqlite3
npm install -D @types/better-sqlite3 vitest
```

- [ ] **Step 2: 네이티브 모듈 로드 확인**

```bash
node -e "const D=require('better-sqlite3'); const db=new D(':memory:'); console.log(db.prepare('select sqlite_version() v').get())"
```

Expected: `{ v: '3.x.x' }` 출력. 빌드 오류가 나면 `npm rebuild better-sqlite3` 후 재시도.

- [ ] **Step 3: vitest 설정 작성**

`vitest.config.ts`:

```ts
import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
});
```

`package.json` scripts에 추가:

```json
"test": "vitest run"
```

- [ ] **Step 4: 스모크 테스트 작성**

`src/lib/smoke.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { cn } from "@/lib/utils";

describe("vitest 설정", () => {
  it("경로 별칭이 동작한다", () => {
    expect(cn("a", "b")).toBe("a b");
  });
});
```

- [ ] **Step 5: 실행**

Run: `npm test`
Expected: 1 passed.

- [ ] **Step 6: lint**

Run: `npm run lint`
Expected: 오류 없음.

- [ ] **Step 7: 커밋**

```bash
git add package.json package-lock.json vitest.config.ts src/lib/smoke.test.ts
git commit -m "chore: add better-sqlite3 and vitest"
```

---

### Task 2: 타입·기기 상수·순수 함수를 `src/lib`로 분리

**Files:**
- Create: `src/lib/phones.ts`
- Create: `src/lib/types.ts`
- Create: `src/lib/phone-state.ts`
- Create: `src/lib/phone-state.test.ts`
- Modify: `src/app/page.tsx:27-146` (PHONES, 타입, 상수), `:171-213` (createDefaultPhoneStates, sanitizePhoneStates), `:225-226` (ensurePhoneState)

**Interfaces:**
- Produces:
  - `PHONES`, `PHONE_BY_ID`, `type PhoneDefinition`, `type PhoneId`, `type Platform` from `@/lib/phones`
  - `type Borrower = { id: string; name: string; organization: string; createdAt: string }`
  - `type LoanInfo = { borrowerId: string; borrowedAt: string }`
  - `type ReturnInfo = { borrowerId: string; returnedAt: string }`
  - `type PhoneState = { id: PhoneId; status: "available" | "borrowed"; currentLoan?: LoanInfo; lastReturn?: ReturnInfo }`
  - `type PhoneStateMap = Record<PhoneId, PhoneState>`
  - `type AppState = { borrowers: Borrower[]; phones: PhoneStateMap; bannerMessages: string[]; serverTime: string }`
  - `createDefaultPhoneStates(): PhoneStateMap`, `sanitizePhoneStates(raw: unknown): PhoneStateMap`, `ensurePhoneState(map, id): PhoneState` from `@/lib/phone-state`

- [ ] **Step 1: 실패하는 테스트 작성**

`src/lib/phone-state.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { PHONES } from "@/lib/phones";
import {
  createDefaultPhoneStates,
  ensurePhoneState,
  sanitizePhoneStates,
} from "@/lib/phone-state";

describe("phone-state", () => {
  it("기본 상태는 모든 기기가 available", () => {
    const map = createDefaultPhoneStates();
    expect(Object.keys(map).sort()).toEqual(PHONES.map((p) => p.id).sort());
    expect(map.a01.status).toBe("available");
  });

  it("sanitize는 알 수 없는 기기를 버리고 깨진 날짜를 보정한다", () => {
    const map = sanitizePhoneStates({
      a01: { status: "borrowed", currentLoan: { borrowerId: "u1" } },
      zzz: { status: "borrowed" },
    });
    expect(map.a01.status).toBe("borrowed");
    expect(typeof map.a01.currentLoan?.borrowedAt).toBe("string");
    expect((map as Record<string, unknown>).zzz).toBeUndefined();
  });

  it("sanitize는 객체가 아니면 기본 상태", () => {
    expect(sanitizePhoneStates(null).i01.status).toBe("available");
  });

  it("ensurePhoneState는 없는 키에 available을 돌려준다", () => {
    const map = {} as ReturnType<typeof createDefaultPhoneStates>;
    expect(ensurePhoneState(map, "a02")).toEqual({ id: "a02", status: "available" });
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npm test -- phone-state`
Expected: FAIL, `@/lib/phones` 모듈 없음.

- [ ] **Step 3: `src/lib/phones.ts` 작성**

`page.tsx:27-91`의 `PHONES` 배열(`as const` 포함)을 그대로 옮기고, 아래를 추가한다. page.tsx의 `GRID_LAYOUT`은 UI 전용이므로 page.tsx에 남긴다.

```ts
export const PHONES = [
  // page.tsx 27-91행 내용 그대로 (7개 기기)
] as const;

export type PhoneDefinition = (typeof PHONES)[number];
export type PhoneId = PhoneDefinition["id"];
export type Platform = PhoneDefinition["platform"];

export const PHONE_BY_ID: Record<PhoneId, PhoneDefinition> = PHONES.reduce(
  (acc, phone) => {
    acc[phone.id] = phone;
    return acc;
  },
  {} as Record<PhoneId, PhoneDefinition>
);

export const PHONE_IDS: PhoneId[] = PHONES.map((p) => p.id);

export const isPhoneId = (value: string): value is PhoneId =>
  (PHONE_IDS as string[]).includes(value);
```

- [ ] **Step 4: `src/lib/types.ts` 작성**

```ts
import type { PhoneId } from "@/lib/phones";

export type Borrower = {
  id: string;
  name: string;
  organization: string;
  createdAt: string;
};

export type LoanInfo = { borrowerId: string; borrowedAt: string };
export type ReturnInfo = { borrowerId: string; returnedAt: string };

export type PhoneState = {
  id: PhoneId;
  status: "available" | "borrowed";
  currentLoan?: LoanInfo;
  lastReturn?: ReturnInfo;
};

export type PhoneStateMap = Record<PhoneId, PhoneState>;

export type AppState = {
  borrowers: Borrower[];
  phones: PhoneStateMap;
  bannerMessages: string[];
  serverTime: string;
};
```

- [ ] **Step 5: `src/lib/phone-state.ts` 작성**

`page.tsx:171-213`의 `createDefaultPhoneStates`, `sanitizePhoneStates`와 `:225-226`의 `ensurePhoneState`를 그대로 옮기고 `export`를 붙인다. import는 `PHONES` from `@/lib/phones`, 타입은 `@/lib/types`.

- [ ] **Step 6: page.tsx에서 제거하고 import로 교체**

- `page.tsx:27-91` `PHONES` 삭제, `:93-95` 타입 3개 삭제, `:110-116` `PHONE_BY_ID` 삭제, `:118-144` `Borrower`~`PhoneStateMap` 타입 삭제, `:171-213`, `:225-226` 함수 삭제.
- 상단에 추가:

```ts
import { PHONES, PHONE_BY_ID, type PhoneId, type Platform } from "@/lib/phones";
import type { Borrower, PhoneState, PhoneStateMap } from "@/lib/types";
import {
  createDefaultPhoneStates,
  ensurePhoneState,
  sanitizePhoneStates,
} from "@/lib/phone-state";
```

`GridItem`, `BorrowerOrgOption`, `BORROWER_ORG_OPTIONS`, `MOTIVATION_MESSAGES`, `PLATFORM_LABELS`, `formatDateTime`, `formatClock`은 page.tsx에 남긴다. 사용하지 않게 된 import(`Platform` 등)는 lint가 알려주면 제거한다.

- [ ] **Step 7: 테스트·lint·빌드**

Run: `npm test && npm run lint && npx tsc --noEmit`
Expected: 모두 통과. 동작은 바뀌지 않았으므로 `npm run dev`로 열어 화면이 그대로인지 1회 확인.

- [ ] **Step 8: 커밋**

```bash
git add src/lib/phones.ts src/lib/types.ts src/lib/phone-state.ts src/lib/phone-state.test.ts src/app/page.tsx
git commit -m "refactor: move phone constants, types and pure state helpers to src/lib"
```

---

### Task 3: `Store` 읽기 경로 (연결·스키마·시드·getState)

**Files:**
- Create: `src/lib/db.ts`
- Create: `src/lib/db.test.ts`

**Interfaces:**
- Produces:
  - `class StoreError extends Error { status: 400 | 404 | 409 }`
  - `class Store { constructor(filePath: string); getState(): AppState; close(): void }`
  - `DEFAULT_BANNER_MESSAGES: string[]`
  - `getStore(): Store` (환경변수/기본 경로 싱글턴), `resetStoreForTests(): void`

- [ ] **Step 1: 실패하는 테스트 작성**

`src/lib/db.test.ts`:

```ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_BANNER_MESSAGES, Store } from "@/lib/db";
import { PHONES } from "@/lib/phones";

let dir: string;
let store: Store;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "test-phone-"));
  store = new Store(path.join(dir, "nested", "db.sqlite"));
});

afterEach(() => {
  store.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("Store 읽기", () => {
  it("없는 디렉터리를 만들고 초기 상태를 돌려준다", () => {
    const state = store.getState();
    expect(state.borrowers).toEqual([]);
    expect(Object.keys(state.phones).sort()).toEqual(PHONES.map((p) => p.id).sort());
    expect(state.phones.a01).toEqual({ id: "a01", status: "available" });
    expect(state.bannerMessages).toEqual(DEFAULT_BANNER_MESSAGES);
    expect(Number.isNaN(Date.parse(state.serverTime))).toBe(false);
  });

  it("같은 파일을 다시 열어도 시드가 중복되지 않는다", () => {
    const file = path.join(dir, "again.sqlite");
    const a = new Store(file);
    a.close();
    const b = new Store(file);
    expect(b.getState().bannerMessages).toEqual(DEFAULT_BANNER_MESSAGES);
    b.close();
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npm test -- db.test`
Expected: FAIL, `@/lib/db` 없음.

- [ ] **Step 3: `src/lib/db.ts` 작성 (읽기 부분)**

```ts
import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { PHONES, isPhoneId, type PhoneId } from "@/lib/phones";
import { createDefaultPhoneStates } from "@/lib/phone-state";
import type { AppState, Borrower, PhoneState, PhoneStateMap } from "@/lib/types";

export const DEFAULT_BANNER_MESSAGES = [
  "상태 초기화 버그 수정 완료",
  "롤링 배너 구매 문의",
];

export class StoreError extends Error {
  status: 400 | 404 | 409;
  constructor(status: 400 | 404 | 409, message: string) {
    super(message);
    this.name = "StoreError";
    this.status = status;
  }
}

type BorrowerRow = {
  id: string;
  name: string;
  organization: string;
  created_at: string;
};

type PhoneRow = {
  phone_id: string;
  status: "available" | "borrowed";
  loan_borrower_id: string | null;
  loan_at: string | null;
  return_borrower_id: string | null;
  return_at: string | null;
};

const SCHEMA = `
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
`;

const rowToPhoneState = (row: PhoneRow): PhoneState => {
  const id = row.phone_id as PhoneId;
  const state: PhoneState = { id, status: row.status };
  if (row.status === "borrowed" && row.loan_borrower_id && row.loan_at) {
    state.currentLoan = { borrowerId: row.loan_borrower_id, borrowedAt: row.loan_at };
  }
  if (row.return_borrower_id && row.return_at) {
    state.lastReturn = { borrowerId: row.return_borrower_id, returnedAt: row.return_at };
  }
  return state;
};

const rowToBorrower = (row: BorrowerRow): Borrower => ({
  id: row.id,
  name: row.name,
  organization: row.organization,
  createdAt: row.created_at,
});

export class Store {
  private db: Database.Database;

  constructor(filePath: string) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    this.db = new Database(filePath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("busy_timeout = 3000");
    this.db.exec(SCHEMA);
    this.seed();
  }

  private seed() {
    const count = this.db
      .prepare("SELECT COUNT(*) AS c FROM banner_messages")
      .get() as { c: number };
    if (count.c > 0) return;
    const insert = this.db.prepare(
      "INSERT OR IGNORE INTO banner_messages (message, created_at) VALUES (?, ?)"
    );
    const now = new Date().toISOString();
    for (const message of DEFAULT_BANNER_MESSAGES) insert.run(message, now);
  }

  getState(): AppState {
    const borrowers = (
      this.db.prepare("SELECT * FROM borrowers ORDER BY created_at, id").all() as BorrowerRow[]
    ).map(rowToBorrower);

    const phones: PhoneStateMap = createDefaultPhoneStates();
    const rows = this.db.prepare("SELECT * FROM phone_states").all() as PhoneRow[];
    for (const row of rows) {
      if (isPhoneId(row.phone_id)) phones[row.phone_id] = rowToPhoneState(row);
    }

    const bannerMessages = (
      this.db.prepare("SELECT message FROM banner_messages ORDER BY id").all() as {
        message: string;
      }[]
    ).map((r) => r.message);

    return { borrowers, phones, bannerMessages, serverTime: new Date().toISOString() };
  }

  close() {
    this.db.close();
  }
}

const DEFAULT_DB_PATH = path.join(os.homedir(), "test-phone-data", "test-phone.db");

type GlobalWithStore = typeof globalThis & { __testPhoneStore?: Store };

export function getStore(): Store {
  const g = globalThis as GlobalWithStore;
  if (!g.__testPhoneStore) {
    g.__testPhoneStore = new Store(process.env.TEST_PHONE_DB_PATH ?? DEFAULT_DB_PATH);
  }
  return g.__testPhoneStore;
}

export function resetStoreForTests() {
  const g = globalThis as GlobalWithStore;
  g.__testPhoneStore?.close();
  g.__testPhoneStore = undefined;
}
```

`PHONES` import는 Task 4에서 쓰므로 지금 lint가 미사용 경고를 내면 `PHONE_IDS`로 바꾸거나 잠시 제거한다.

- [ ] **Step 4: 테스트 통과 확인**

Run: `npm test -- db.test`
Expected: 2 passed.

- [ ] **Step 5: lint**

Run: `npm run lint`

- [ ] **Step 6: 커밋**

```bash
git add src/lib/db.ts src/lib/db.test.ts
git commit -m "feat(db): add SQLite store with schema, seed and getState"
```

---

### Task 4: `Store` 쓰기 경로 (대여·이관·반납·대여자·배너)

**Files:**
- Modify: `src/lib/db.ts`
- Modify: `src/lib/db.test.ts`

**Interfaces:**
- Produces (모두 `AppState` 반환, 실패 시 `StoreError` throw):
  - `borrow(phoneId: string, borrowerId: string): AppState`
  - `transfer(phoneId: string, borrowerId: string): AppState`
  - `returnPhone(phoneId: string): AppState`
  - `addBorrower(name: string, organization: string): AppState`
  - `deleteBorrower(borrowerId: string): AppState`
  - `addBanner(message: string): AppState`

- [ ] **Step 1: 실패하는 테스트 추가**

`src/lib/db.test.ts`에 추가:

```ts
import { StoreError } from "@/lib/db";

const addUser = (name = "홍길동", org = "QA") => {
  const state = store.addBorrower(name, org);
  return state.borrowers[state.borrowers.length - 1].id;
};

describe("Store 쓰기", () => {
  it("대여 → 이관 → 반납 흐름", () => {
    const u1 = addUser("A");
    const u2 = addUser("B");

    let s = store.borrow("a01", u1);
    expect(s.phones.a01.status).toBe("borrowed");
    expect(s.phones.a01.currentLoan?.borrowerId).toBe(u1);

    s = store.transfer("a01", u2);
    expect(s.phones.a01.currentLoan?.borrowerId).toBe(u2);

    s = store.returnPhone("a01");
    expect(s.phones.a01.status).toBe("available");
    expect(s.phones.a01.currentLoan).toBeUndefined();
    expect(s.phones.a01.lastReturn?.borrowerId).toBe(u2);
  });

  it("이미 대여 중이면 두 번째 대여는 409이고 첫 대여자가 유지된다", () => {
    const u1 = addUser("A");
    const u2 = addUser("B");
    store.borrow("a01", u1);
    expect(() => store.borrow("a01", u2)).toThrowError(StoreError);
    try {
      store.borrow("a01", u2);
    } catch (e) {
      expect((e as StoreError).status).toBe(409);
    }
    expect(store.getState().phones.a01.currentLoan?.borrowerId).toBe(u1);
  });

  it("알 수 없는 기기는 404이고 행이 생기지 않는다", () => {
    const u1 = addUser();
    expect(() => store.borrow("zzz", u1)).toThrowError(/기기/);
    expect(Object.keys(store.getState().phones)).not.toContain("zzz");
  });

  it("없는 대여자로 대여하면 404", () => {
    try {
      store.borrow("a01", "nope");
      throw new Error("should throw");
    } catch (e) {
      expect((e as StoreError).status).toBe(404);
    }
  });

  it("대여 중이 아닌 기기 이관·반납은 409", () => {
    const u1 = addUser();
    expect(() => store.transfer("a01", u1)).toThrowError(StoreError);
    expect(() => store.returnPhone("a01")).toThrowError(StoreError);
  });

  it("같은 사람에게 이관은 409", () => {
    const u1 = addUser();
    store.borrow("a01", u1);
    expect(() => store.transfer("a01", u1)).toThrowError(StoreError);
  });

  it("공백 이름 대여자 추가는 400이고 DB 변화 없음", () => {
    expect(() => store.addBorrower("   ", "QA")).toThrowError(StoreError);
    expect(store.getState().borrowers).toHaveLength(0);
  });

  it("대여 중인 대여자 삭제는 409, 아니면 삭제", () => {
    const u1 = addUser();
    store.borrow("a01", u1);
    expect(() => store.deleteBorrower(u1)).toThrowError(/대여 중/);
    store.returnPhone("a01");
    const s = store.deleteBorrower(u1);
    expect(s.borrowers).toHaveLength(0);
    expect(s.phones.a01.lastReturn?.borrowerId).toBe(u1);
  });

  it("없는 대여자 삭제는 404", () => {
    expect(() => store.deleteBorrower("nope")).toThrowError(StoreError);
  });

  it("배너 추가는 중복을 무시하고 빈 값은 400", () => {
    const s1 = store.addBanner("새 문구");
    expect(s1.bannerMessages).toContain("새 문구");
    const s2 = store.addBanner("새 문구");
    expect(s2.bannerMessages.filter((m) => m === "새 문구")).toHaveLength(1);
    expect(() => store.addBanner("  ")).toThrowError(StoreError);
  });

});
```

- [ ] **Step 2: 실패 확인**

Run: `npm test -- db.test`
Expected: 새 테스트들이 `store.addBorrower is not a function`으로 FAIL.

- [ ] **Step 3: 쓰기 메서드 구현**

`src/lib/db.ts`의 `Store` 클래스에 추가 (`getState` 아래).

```ts
  private requirePhoneId(phoneId: string): PhoneId {
    if (!isPhoneId(phoneId)) throw new StoreError(404, "존재하지 않는 기기입니다.");
    return phoneId;
  }

  private requireBorrower(borrowerId: string): BorrowerRow {
    const row = this.db
      .prepare("SELECT * FROM borrowers WHERE id = ?")
      .get(borrowerId) as BorrowerRow | undefined;
    if (!row) throw new StoreError(404, "존재하지 않는 대여자입니다.");
    return row;
  }

  private getPhoneRow(phoneId: PhoneId): PhoneRow | undefined {
    return this.db
      .prepare("SELECT * FROM phone_states WHERE phone_id = ?")
      .get(phoneId) as PhoneRow | undefined;
  }

  borrow(phoneIdRaw: string, borrowerId: string): AppState {
    const phoneId = this.requirePhoneId(phoneIdRaw);
    return this.db.transaction(() => {
      this.requireBorrower(borrowerId);
      const row = this.getPhoneRow(phoneId);
      if (row?.status === "borrowed") {
        throw new StoreError(409, "이미 대여 중인 기기입니다.");
      }
      this.db
        .prepare(
          `INSERT INTO phone_states (phone_id, status, loan_borrower_id, loan_at, return_borrower_id, return_at)
           VALUES (@phone_id, 'borrowed', @borrower, @now, @rb, @ra)
           ON CONFLICT(phone_id) DO UPDATE SET
             status = 'borrowed', loan_borrower_id = @borrower, loan_at = @now`
        )
        .run({
          phone_id: phoneId,
          borrower: borrowerId,
          now: new Date().toISOString(),
          rb: row?.return_borrower_id ?? null,
          ra: row?.return_at ?? null,
        });
      return this.getState();
    })();
  }

  transfer(phoneIdRaw: string, borrowerId: string): AppState {
    const phoneId = this.requirePhoneId(phoneIdRaw);
    return this.db.transaction(() => {
      this.requireBorrower(borrowerId);
      const row = this.getPhoneRow(phoneId);
      if (!row || row.status !== "borrowed") {
        throw new StoreError(409, "대여 중인 기기가 아닙니다.");
      }
      if (row.loan_borrower_id === borrowerId) {
        throw new StoreError(409, "이미 같은 대여자입니다.");
      }
      this.db
        .prepare(
          "UPDATE phone_states SET loan_borrower_id = ?, loan_at = ? WHERE phone_id = ?"
        )
        .run(borrowerId, new Date().toISOString(), phoneId);
      return this.getState();
    })();
  }

  returnPhone(phoneIdRaw: string): AppState {
    const phoneId = this.requirePhoneId(phoneIdRaw);
    return this.db.transaction(() => {
      const row = this.getPhoneRow(phoneId);
      if (!row || row.status !== "borrowed" || !row.loan_borrower_id) {
        throw new StoreError(409, "대여 중인 기기가 아닙니다.");
      }
      this.db
        .prepare(
          `UPDATE phone_states
           SET status = 'available', return_borrower_id = loan_borrower_id, return_at = ?,
               loan_borrower_id = NULL, loan_at = NULL
           WHERE phone_id = ?`
        )
        .run(new Date().toISOString(), phoneId);
      return this.getState();
    })();
  }

  addBorrower(nameRaw: string, organizationRaw: string): AppState {
    const name = nameRaw.trim();
    const organization = organizationRaw.trim();
    if (!name || !organization) {
      throw new StoreError(400, "이름과 소속을 모두 입력해 주세요.");
    }
    this.db
      .prepare(
        "INSERT INTO borrowers (id, name, organization, created_at) VALUES (?, ?, ?, ?)"
      )
      .run(crypto.randomUUID(), name, organization, new Date().toISOString());
    return this.getState();
  }

  deleteBorrower(borrowerId: string): AppState {
    return this.db.transaction(() => {
      this.requireBorrower(borrowerId);
      const inUse = this.db
        .prepare(
          "SELECT 1 FROM phone_states WHERE status = 'borrowed' AND loan_borrower_id = ?"
        )
        .get(borrowerId);
      if (inUse) throw new StoreError(409, "대여 중인 대여자는 삭제할 수 없습니다.");
      this.db.prepare("DELETE FROM borrowers WHERE id = ?").run(borrowerId);
      return this.getState();
    })();
  }

  addBanner(messageRaw: string): AppState {
    const message = messageRaw.trim();
    if (!message) throw new StoreError(400, "배너 문구를 입력해 주세요.");
    this.db
      .prepare("INSERT OR IGNORE INTO banner_messages (message, created_at) VALUES (?, ?)")
      .run(message, new Date().toISOString());
    return this.getState();
  }

```

`crypto.randomUUID()`는 Node 20+ 전역이다. tsconfig `lib`에 dom이 있어 타입도 잡힌다.

- [ ] **Step 4: 테스트 통과 확인**

Run: `npm test -- db.test`
Expected: 모두 PASS.

- [ ] **Step 5: lint**

Run: `npm run lint`

- [ ] **Step 6: 커밋**

```bash
git add src/lib/db.ts src/lib/db.test.ts
git commit -m "feat(db): add borrow/transfer/return, borrower and banner operations"
```

---

### Task 5: API 라우트

**Files:**
- Create: `src/lib/api-server.ts`
- Create: `src/app/api/state/route.ts`
- Create: `src/app/api/phones/[id]/borrow/route.ts`
- Create: `src/app/api/phones/[id]/transfer/route.ts`
- Create: `src/app/api/phones/[id]/return/route.ts`
- Create: `src/app/api/borrowers/route.ts`
- Create: `src/app/api/borrowers/[id]/route.ts`
- Create: `src/app/api/banner/route.ts`
- Create: `src/app/api/routes.test.ts`

**Interfaces:**
- Consumes: `getStore()`, `resetStoreForTests()`, `StoreError` from `@/lib/db`
- Produces: 스펙 5장의 HTTP 계약. 성공 200 `AppState`, 실패 `{ error }`.

- [ ] **Step 1: 실패하는 테스트 작성**

`src/app/api/routes.test.ts`:

```ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resetStoreForTests } from "@/lib/db";
import { GET as getState } from "@/app/api/state/route";
import { POST as borrow } from "@/app/api/phones/[id]/borrow/route";
import { POST as transfer } from "@/app/api/phones/[id]/transfer/route";
import { POST as returnPhone } from "@/app/api/phones/[id]/return/route";
import { POST as addBorrower } from "@/app/api/borrowers/route";
import { DELETE as deleteBorrower } from "@/app/api/borrowers/[id]/route";
import { POST as addBanner } from "@/app/api/banner/route";

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "test-phone-api-"));
  process.env.TEST_PHONE_DB_PATH = path.join(dir, "db.sqlite");
  resetStoreForTests();
});

afterEach(() => {
  resetStoreForTests();
  delete process.env.TEST_PHONE_DB_PATH;
  fs.rmSync(dir, { recursive: true, force: true });
});

const json = (body: unknown) =>
  new Request("http://local/x", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
const params = (id: string) => ({ params: Promise.resolve({ id }) });

describe("API 라우트", () => {
  it("GET /api/state", async () => {
    const res = await getState();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.phones.a01.status).toBe("available");
  });

  it("대여 → 이관 → 반납 → 대여자 삭제", async () => {
    let res = await addBorrower(json({ name: "A", organization: "QA" }));
    expect(res.status).toBe(200);
    const u1 = (await res.json()).borrowers[0].id;
    res = await addBorrower(json({ name: "B", organization: "QA" }));
    const u2 = (await res.json()).borrowers[1].id;

    res = await borrow(json({ borrowerId: u1 }), params("a01"));
    expect(res.status).toBe(200);

    res = await borrow(json({ borrowerId: u2 }), params("a01"));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/대여 중/);

    res = await transfer(json({ borrowerId: u2 }), params("a01"));
    expect(res.status).toBe(200);

    res = await deleteBorrower(new Request("http://local/x", { method: "DELETE" }), params(u2));
    expect(res.status).toBe(409);

    res = await returnPhone(json({}), params("a01"));
    expect(res.status).toBe(200);
    expect((await res.json()).phones.a01.status).toBe("available");

    res = await deleteBorrower(new Request("http://local/x", { method: "DELETE" }), params(u2));
    expect(res.status).toBe(200);
  });

  it("알 수 없는 기기는 404", async () => {
    const res = await borrow(json({ borrowerId: "x" }), params("zzz"));
    expect(res.status).toBe(404);
  });

  it("본문이 JSON이 아니면 400", async () => {
    const res = await addBorrower(
      new Request("http://local/x", { method: "POST", body: "not json" })
    );
    expect(res.status).toBe(400);
  });

  it("borrowerId가 없으면 400", async () => {
    const res = await borrow(json({}), params("a01"));
    expect(res.status).toBe(400);
  });

  it("배너 추가와 빈 값", async () => {
    let res = await addBanner(json({ message: "hi" }));
    expect((await res.json()).bannerMessages).toContain("hi");
    res = await addBanner(json({ message: " " }));
    expect(res.status).toBe(400);
  });

});
```

- [ ] **Step 2: 실패 확인**

Run: `npm test -- routes`
Expected: FAIL, 라우트 모듈 없음.

- [ ] **Step 3: `src/lib/api-server.ts` 작성**

```ts
import { NextResponse } from "next/server";
import { StoreError } from "@/lib/db";
import type { AppState } from "@/lib/types";

export class BadRequest extends Error {}

export async function readJson<T extends object>(req: Request): Promise<Partial<T>> {
  try {
    const body = (await req.json()) as unknown;
    if (!body || typeof body !== "object") throw new Error();
    return body as Partial<T>;
  } catch {
    throw new BadRequest("요청 본문이 올바르지 않습니다.");
  }
}

export function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new BadRequest(`${label}을(를) 입력해 주세요.`);
  }
  return value;
}

export async function handle(fn: () => AppState | Promise<AppState>): Promise<NextResponse> {
  try {
    const state = await fn();
    return NextResponse.json(state, { status: 200 });
  } catch (error) {
    if (error instanceof StoreError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof BadRequest) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error("[api] unexpected error", error);
    return NextResponse.json({ error: "서버 오류가 발생했습니다." }, { status: 500 });
  }
}
```

- [ ] **Step 4: 라우트 작성**

`src/app/api/state/route.ts`:

```ts
import { getStore } from "@/lib/db";
import { handle } from "@/lib/api-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return handle(() => getStore().getState());
}
```

`src/app/api/phones/[id]/borrow/route.ts`:

```ts
import { getStore } from "@/lib/db";
import { handle, readJson, requireString } from "@/lib/api-server";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, { params }: Ctx) {
  return handle(async () => {
    const { id } = await params;
    const body = await readJson<{ borrowerId: string }>(req);
    const borrowerId = requireString(body.borrowerId, "대여자");
    return getStore().borrow(id, borrowerId);
  });
}
```

`src/app/api/phones/[id]/transfer/route.ts`:

```ts
import { getStore } from "@/lib/db";
import { handle, readJson, requireString } from "@/lib/api-server";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, { params }: Ctx) {
  return handle(async () => {
    const { id } = await params;
    const body = await readJson<{ borrowerId: string }>(req);
    const borrowerId = requireString(body.borrowerId, "대여자");
    return getStore().transfer(id, borrowerId);
  });
}
```

`src/app/api/phones/[id]/return/route.ts`:

```ts
import { getStore } from "@/lib/db";
import { handle } from "@/lib/api-server";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(_req: Request, { params }: Ctx) {
  return handle(async () => {
    const { id } = await params;
    return getStore().returnPhone(id);
  });
}
```

`src/app/api/borrowers/route.ts`:

```ts
import { getStore } from "@/lib/db";
import { handle, readJson } from "@/lib/api-server";

export const runtime = "nodejs";

export async function POST(req: Request) {
  return handle(async () => {
    const body = await readJson<{ name: string; organization: string }>(req);
    return getStore().addBorrower(String(body.name ?? ""), String(body.organization ?? ""));
  });
}
```

(빈 값 검증은 `Store.addBorrower`가 400으로 처리한다.)

`src/app/api/borrowers/[id]/route.ts`:

```ts
import { getStore } from "@/lib/db";
import { handle } from "@/lib/api-server";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function DELETE(_req: Request, { params }: Ctx) {
  return handle(async () => {
    const { id } = await params;
    return getStore().deleteBorrower(id);
  });
}
```

`src/app/api/banner/route.ts`:

```ts
import { getStore } from "@/lib/db";
import { handle, readJson } from "@/lib/api-server";

export const runtime = "nodejs";

export async function POST(req: Request) {
  return handle(async () => {
    const body = await readJson<{ message: string }>(req);
    return getStore().addBanner(String(body.message ?? ""));
  });
}
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `npm test`
Expected: 모두 PASS.

- [ ] **Step 6: 실제 서버로 확인**

```bash
TEST_PHONE_DB_PATH=/tmp/tp-dev.db npm run dev
```

다른 터미널에서:

```bash
curl -s localhost:3000/api/state | head -c 300
curl -s -X POST localhost:3000/api/borrowers -H 'Content-Type: application/json' -d '{"name":"A","organization":"QA"}' | head -c 300
```

Expected: 둘 다 JSON `AppState`.

- [ ] **Step 7: lint 후 커밋**

```bash
npm run lint
git add src/lib/api-server.ts src/app/api
git commit -m "feat(api): add state, phone, borrower and banner routes"
```

---

### Task 6: 브라우저용 API 클라이언트

**Files:**
- Create: `src/lib/api.ts`
- Create: `src/lib/api.test.ts`

**Interfaces:**
- Produces:
  - `class ApiError extends Error { status: number }` (`status === 0`은 네트워크 실패)
  - `isOfflineError(e: unknown): boolean` (status 0 또는 >= 500)
  - `api.getState(): Promise<AppState>`, `api.borrow(phoneId, borrowerId)`, `api.transfer(phoneId, borrowerId)`, `api.returnPhone(phoneId)`, `api.addBorrower(name, organization)`, `api.deleteBorrower(id)`, `api.addBanner(message)` — 모두 `Promise<AppState>`

- [ ] **Step 1: 실패하는 테스트 작성**

`src/lib/api.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, api, isOfflineError } from "@/lib/api";

const okState = { borrowers: [], phones: {}, bannerMessages: [], serverTime: "x" };

afterEach(() => vi.unstubAllGlobals());

describe("api client", () => {
  it("성공 시 AppState를 돌려준다", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(okState), { status: 200 })));
    await expect(api.getState()).resolves.toEqual(okState);
  });

  it("4xx는 서버 메시지를 담은 ApiError", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "이미 대여 중" }), { status: 409 })));
    await expect(api.borrow("a01", "u1")).rejects.toMatchObject({ status: 409, message: "이미 대여 중" });
  });

  it("네트워크 실패는 status 0이고 offline으로 판정", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
    const err = await api.getState().catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(0);
    expect(isOfflineError(err)).toBe(true);
    expect(isOfflineError(new ApiError(409, "x"))).toBe(false);
    expect(isOfflineError(new ApiError(503, "x"))).toBe(true);
  });

  it("요청 경로와 메서드가 맞다", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(okState), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await api.deleteBorrower("u1");
    await api.returnPhone("i02");
    const calls = fetchMock.mock.calls as unknown as [string, RequestInit][];
    expect(calls[0][0]).toBe("/api/borrowers/u1");
    expect(calls[0][1].method).toBe("DELETE");
    expect(calls[1][0]).toBe("/api/phones/i02/return");
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npm test -- api.test`
Expected: FAIL, 모듈 없음.

- [ ] **Step 3: `src/lib/api.ts` 작성**

```ts
import type { AppState } from "@/lib/types";

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export const isOfflineError = (error: unknown) =>
  error instanceof ApiError && (error.status === 0 || error.status >= 500);

async function request(path: string, init?: RequestInit): Promise<AppState> {
  let res: Response;
  try {
    res = await fetch(path, {
      ...init,
      headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
      cache: "no-store",
    });
  } catch {
    throw new ApiError(0, "서버에 연결할 수 없습니다.");
  }
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) {
    throw new ApiError(res.status, body.error ?? "요청에 실패했습니다.");
  }
  return body as AppState;
}

const post = (path: string, body: unknown) =>
  request(path, { method: "POST", body: JSON.stringify(body ?? {}) });

export const api = {
  getState: () => request("/api/state"),
  borrow: (phoneId: string, borrowerId: string) =>
    post(`/api/phones/${phoneId}/borrow`, { borrowerId }),
  transfer: (phoneId: string, borrowerId: string) =>
    post(`/api/phones/${phoneId}/transfer`, { borrowerId }),
  returnPhone: (phoneId: string) => post(`/api/phones/${phoneId}/return`, {}),
  addBorrower: (name: string, organization: string) =>
    post("/api/borrowers", { name, organization }),
  deleteBorrower: (id: string) => request(`/api/borrowers/${id}`, { method: "DELETE" }),
  addBanner: (message: string) => post("/api/banner", { message }),
};
```

- [ ] **Step 4: 테스트·lint**

Run: `npm test -- api.test && npm run lint`
Expected: PASS.

- [ ] **Step 5: 커밋**

```bash
git add src/lib/api.ts src/lib/api.test.ts
git commit -m "feat(api): add browser API client"
```

---

### Task 7: `page.tsx` 저장 계층 교체, 폴링, 연결 끊김 배지, 토스트

**Files:**
- Modify: `src/app/page.tsx` (Task 2 이후 줄 번호가 달라지므로 식별자 기준으로 적는다)

**Interfaces:**
- Consumes: `api`, `ApiError`, `isOfflineError` from `@/lib/api`; `AppState` from `@/lib/types`.

- [ ] **Step 1: import와 상수 정리**

- `MOTIVATION_MESSAGES` 상수 삭제 (서버 시드로 이동). `bannerMessages` 초기값은 `[]`.
- `BORROWERS_STORAGE_KEY`, `PHONE_STORAGE_KEY`, `BANNER_STORAGE_KEY` 삭제.
- import 추가: `import { api, ApiError, isOfflineError } from "@/lib/api";` `import type { AppState } from "@/lib/types";`
- `sanitizePhoneStates` import는 더 이상 쓰지 않으므로 제거한다.

- [ ] **Step 2: 상태 추가와 공통 함수**

`Home` 컴포넌트 상단 `useState` 블록 뒤에 추가:

```ts
  const [offline, setOffline] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [toast, setToast] = React.useState<string | null>(null);

  const applyState = React.useCallback((state: AppState) => {
    setBorrowers(state.borrowers);
    setPhones(state.phones);
    setBannerMessages(state.bannerMessages);
    setOffline(false);
  }, []);

  const showToast = React.useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(null), 3000);
  }, []);

  const refresh = React.useCallback(async () => {
    try {
      applyState(await api.getState());
    } catch (error) {
      if (isOfflineError(error)) setOffline(true);
    }
  }, [applyState]);

  const runAction = React.useCallback(
    async (
      action: () => Promise<AppState>,
      onClientError?: (message: string) => void
    ) => {
      setBusy(true);
      try {
        applyState(await action());
        return true;
      } catch (error) {
        if (isOfflineError(error)) {
          setOffline(true);
          showToast("서버에 연결할 수 없습니다.");
        } else if (error instanceof ApiError && error.status === 409) {
          showToast("방금 다른 기기에서 처리됐습니다.");
          await refresh();
        } else if (error instanceof ApiError) {
          (onClientError ?? showToast)(error.message);
        } else {
          showToast("알 수 없는 오류가 발생했습니다.");
        }
        return false;
      } finally {
        setBusy(false);
      }
    },
    [applyState, refresh, showToast]
  );
```

- [ ] **Step 3: localStorage effect 4개를 초기 로드 + 폴링으로 교체**

기존 `React.useEffect(() => { if (typeof window === "undefined") return; try { const storedBorrowers = ... setHydrated(true); setCurrentTime(new Date()); }, []);`와 `BORROWERS_STORAGE_KEY`/`PHONE_STORAGE_KEY`/`BANNER_STORAGE_KEY`에 쓰는 effect 3개를 삭제하고 아래로 교체:

```ts
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const state = await api.getState();
        if (!cancelled) applyState(state);
      } catch (error) {
        if (!cancelled && isOfflineError(error)) setOffline(true);
      } finally {
        if (!cancelled) {
          setHydrated(true);
          setCurrentTime(new Date());
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [applyState]);

  React.useEffect(() => {
    if (!hydrated) return;
    const id = window.setInterval(() => {
      if (document.hidden) return;
      void refresh();
    }, 5_000);
    return () => window.clearInterval(id);
  }, [hydrated, refresh]);
```

`currentTime` 1분 갱신 effect와 다이얼로그 선택 effect는 그대로 둔다.

- [ ] **Step 4: 핸들러를 API 호출로 교체**

```ts
  const handleStartLoan = async () => {
    if (!selectedPhoneId || !selectedBorrowerId) return;
    const phoneId = selectedPhoneId;
    const borrowerId = selectedBorrowerId;
    closePhoneDialog();
    await runAction(() => api.borrow(phoneId, borrowerId));
  };

  const handleTransferLoan = async () => {
    if (!selectedPhoneId || !selectedBorrowerId) return;
    const phoneId = selectedPhoneId;
    const borrowerId = selectedBorrowerId;
    closePhoneDialog();
    await runAction(() => api.transfer(phoneId, borrowerId));
  };

  const handleManualReturn = () => {
    if (!selectedPhoneId) return;
    const targetPhoneId = selectedPhoneId;
    closePhoneDialog();
    setReturnConfirmPhoneId(targetPhoneId);
  };

  const finalizeReturn = async () => {
    if (!returnConfirmPhoneId) return;
    const phoneId = returnConfirmPhoneId;
    setReturnConfirmPhoneId(null);
    await runAction(() => api.returnPhone(phoneId));
  };

  const handleAddBannerMessage = async () => {
    const message = bannerInput.trim();
    if (!message) return;
    const ok = await runAction(() => api.addBanner(message));
    if (ok) {
      setBannerInput("");
      setBannerDialogOpen(false);
    }
  };

  const handleAddBorrower = async () => {
    const name = borrowerName.trim();
    const organization =
      borrowerOrgOption === "기타" ? borrowerOrgCustom.trim() : borrowerOrgOption;
    if (!name || !organization) {
      setBorrowerError("이름과 소속을 모두 입력해 주세요.");
      return;
    }
    const ok = await runAction(() => api.addBorrower(name, organization), setBorrowerError);
    if (ok) {
      setBorrowerName("");
      setBorrowerOrgOption("프론트엔드팀");
      setBorrowerOrgCustom("");
      setBorrowerError(null);
    }
  };

  const handleDeleteBorrower = async (borrowerId: string) => {
    if (isBorrowerInUse(borrowerId)) {
      setBorrowerError("대여 중인 대여자는 삭제할 수 없습니다.");
      return;
    }
    const ok = await runAction(() => api.deleteBorrower(borrowerId), setBorrowerError);
    if (ok) setBorrowerError(null);
  };
```

기존 `handleReturnLoan(phoneId, returnedAt?)`는 호출처가 `finalizeReturn`뿐이므로 삭제한다. `isBorrowerInUse`는 `handleDeleteBorrower`보다 위에 선언돼 있어야 하므로 기존 위치를 유지한다.

- [ ] **Step 5: 버튼 비활성화와 배지·토스트 UI**

- 조작 버튼에 `disabled`에 `offline || busy` 추가:
  - 기기 카드의 `openPhoneDialog(...)` 버튼: `disabled={offline}`
  - 대여자 카드 열기 버튼(`setBorrowerDialogOpen(true)`): `disabled={offline}`
  - "롤링 배너 추가하기" 버튼: `disabled={offline}`
  - 다이얼로그 내 `handleTransferLoan`, `handleManualReturn`, `handleStartLoan`, `handleAddBorrower`, `handleDeleteBorrower`, `handleAddBannerMessage`, `finalizeReturn` 버튼: 기존 조건에 `|| offline || busy` 추가.
- `<header>` 안 "현재 시각" `<span>` 옆에 배지 추가:

```tsx
        <div className="flex items-center gap-3">
          {offline && (
            <span className="rounded-full bg-destructive px-3 py-1 text-xs font-semibold text-destructive-foreground">
              서버 연결 끊김
            </span>
          )}
          <span className="text-sm text-muted-foreground">
            현재 시각 {formatClock(currentTime)}
          </span>
        </div>
```

- `<main>` 닫는 태그 바로 앞에 토스트:

```tsx
      {toast && (
        <div
          role="status"
          className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-md bg-foreground px-4 py-2 text-sm text-background shadow-lg"
        >
          {toast}
        </div>
      )}
```

- `if (!hydrated)` 로딩 화면은 유지한다.

- [ ] **Step 6: 타입·lint·빌드**

Run: `npx tsc --noEmit && npm run lint && npm run build`
Expected: 오류 없음. `MOTIVATION_MESSAGES`, `sanitizePhoneStates`, `createDefaultPhoneStates` 등 미사용 경고가 나오면 import를 정리한다(`createDefaultPhoneStates`는 `phones` 초기값에 아직 쓰인다).

- [ ] **Step 7: 수동 검증 (Review Focus 5)**

```bash
TEST_PHONE_DB_PATH=/tmp/tp-dev.db npm run dev
```

1. 브라우저 두 창(또는 PC + iPad)에서 `http://localhost:3000` 열기.
2. 창 A에서 대여자 추가 → 창 B에 5초 내 표시되는지 확인.
3. 창 A에서 A01 대여 → 창 B에 반영. 창 B에서 같은 기기 다이얼로그를 미리 열어두고 폴링 직전에 "대여 시작" 클릭 → "방금 다른 기기에서 처리됐습니다" 토스트 확인.
4. dev 서버를 Ctrl+C로 끈 뒤 창 A에서 대여 클릭 → 배지 표시, 상태 변화 없음. 서버 재시작 → 5초 내 배지 사라짐.

- [ ] **Step 8: 커밋**

```bash
git add src/app/page.tsx
git commit -m "feat(ui): replace localStorage with server state, polling, offline badge and toast"
```

---

### Task 8: 운영 — pm2 자동 실행, 백업, README(롤백 포함)

**Files:**
- Create: `ecosystem.config.cjs`
- Create: `scripts/backup-db.sh`
- Create: `docs/ops/com.cashdoc.test-phone-backup.plist`
- Modify: `README.md` (create-next-app 기본 내용 교체)
- Modify: `.gitignore` (`/logs` 추가)

- [ ] **Step 1: pm2 설정**

```bash
npm install -g pm2
```

`ecosystem.config.cjs`:

```js
module.exports = {
  apps: [
    {
      name: "test-phone",
      script: "npm",
      args: "start",
      cwd: __dirname,
      env: { NODE_ENV: "production", PORT: "3000" },
      autorestart: true,
      max_restarts: 10,
      out_file: "./logs/out.log",
      error_file: "./logs/err.log",
    },
  ],
};
```

`.gitignore`에 `/logs` 추가.

- [ ] **Step 2: 백업 스크립트**

`scripts/backup-db.sh`:

```bash
#!/bin/zsh
set -euo pipefail
DATA_DIR="${TEST_PHONE_DATA_DIR:-$HOME/test-phone-data}"
DB="$DATA_DIR/test-phone.db"
BACKUP_DIR="$DATA_DIR/backup"
mkdir -p "$BACKUP_DIR"
[ -f "$DB" ] || exit 0
STAMP="$(date +%Y%m%d)"
# WAL 내용까지 포함해 일관된 복사본을 만들기 위해 sqlite3 백업 명령 사용
sqlite3 "$DB" ".backup '$BACKUP_DIR/test-phone-$STAMP.db'"
find "$BACKUP_DIR" -name 'test-phone-*.db' -mtime +7 -delete
```

```bash
chmod +x scripts/backup-db.sh
which sqlite3   # macOS 기본 포함
./scripts/backup-db.sh && ls ~/test-phone-data/backup
```

- [ ] **Step 3: launchd plist**

`docs/ops/com.cashdoc.test-phone-backup.plist` (경로의 `__PROJECT_DIR__`은 설치 시 치환):

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.cashdoc.test-phone-backup</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/zsh</string>
    <string>__PROJECT_DIR__/scripts/backup-db.sh</string>
  </array>
  <key>StartCalendarInterval</key>
  <dict><key>Hour</key><integer>4</integer><key>Minute</key><integer>0</integer></dict>
  <key>StandardOutPath</key><string>/tmp/test-phone-backup.log</string>
  <key>StandardErrorPath</key><string>/tmp/test-phone-backup.err</string>
</dict>
</plist>
```

- [ ] **Step 4: README 작성**

기존 create-next-app 내용을 아래로 교체:

````markdown
# 전능아이티 테스트폰 이력관리

사내망에서 테스트폰 대여 현황을 공유하는 Next.js 앱. 데이터는 서버 맥의 SQLite 파일에 저장된다.

## 접속

- iPad/폰/PC (같은 사내 Wi-Fi): `http://ljhs-MacBook-Pro.local:3000`
- `.local`이 안 잡히면 서버 맥의 IP로 `http://<IP>:3000`. 고정이 필요하면 인프라에 DHCP 예약 요청 (Wi-Fi MAC은 서버 맥의 `ifconfig en0 | grep ether`).
- iPad: Safari 공유 → 홈 화면에 추가.

## 서버 실행 (처음 한 번)

```bash
git checkout server
npm install
npm run build
pm2 start ecosystem.config.cjs
pm2 startup        # 출력되는 sudo 명령을 복사해 실행
pm2 save
```

macOS 방화벽이 node 수신 허용을 물으면 허용한다.

## 코드 갱신

```bash
git pull
npm install
npm run build
pm2 restart test-phone
```

## 데이터·백업

- DB: `~/test-phone-data/test-phone.db` (`TEST_PHONE_DB_PATH`로 변경 가능)
- 백업: 매일 04:00 `~/test-phone-data/backup/`에 7일 보관. 설치:

```bash
sed "s#__PROJECT_DIR__#$(pwd)#" docs/ops/com.cashdoc.test-phone-backup.plist > ~/Library/LaunchAgents/com.cashdoc.test-phone-backup.plist
launchctl load ~/Library/LaunchAgents/com.cashdoc.test-phone-backup.plist
```

## 개발

```bash
TEST_PHONE_DB_PATH=/tmp/tp-dev.db npm run dev
npm test
npm run lint
```

## 되돌리기 (옛 localStorage 버전으로)

- `main` 브랜치가 Vercel에 그대로 배포돼 있다. iPad에서 Vercel 주소를 홈 화면에 다시 추가하면 끝.
- 서버는 `pm2 stop test-phone`으로 멈춘다. DB 파일은 남아 있으므로 다시 켜면 복귀한다.
- 대여자 명단은 두 버전이 공유하지 않는다. 되돌린 뒤에는 옛 버전에 남아 있던 명단을 쓴다.

## 제약

- 인증 없음. 사내망 누구나 조작 가능.
- 서버 맥이 덮개 닫힘·전원 분리·재부팅 후 로그인 전이면 중단. 데이터는 보존.
````

- [ ] **Step 5: 실제 기동 확인**

```bash
npm run build && pm2 start ecosystem.config.cjs && pm2 logs test-phone --lines 20
curl -s http://localhost:3000/api/state | head -c 200
```

Expected: pm2 status `online`, JSON 응답. 그 다음 iPad Safari에서 `http://ljhs-MacBook-Pro.local:3000` 접속. 안 되면 `http://192.168.2.102:3000`(IP는 `ipconfig getifaddr en0`로 재확인).

`pm2 startup`과 `pm2 save`, plist 설치는 sudo·시스템 설정 변경이므로 **사용자에게 명령을 보여주고 실행 여부를 확인받는다.**

- [ ] **Step 6: 커밋**

```bash
git add ecosystem.config.cjs scripts/backup-db.sh docs/ops README.md .gitignore
git commit -m "chore(ops): pm2 config, daily SQLite backup and README runbook"
```

---

### Task 9: 최종 검증

- [ ] **Step 1: 전체 테스트·lint·빌드**

```bash
npm test && npm run lint && npx tsc --noEmit && npm run build
```

- [ ] **Step 2: 스펙 성공 기준 점검**

| 기준 | 확인 방법 |
|---|---|
| 5초 내 다른 기기 반영 | iPad + PC에서 대여 후 시계로 확인 |
| 동시 대여 1건만 성공 | Task 7 Step 7의 3번 절차 |
| 재부팅 후 자동 복구 | `sudo reboot` 후 로그인 → `pm2 status` online, 데이터 유지 |
| 되돌리기 | iPad에서 Vercel 주소로 홈 화면 추가 → 옛 버전이 그대로 열리는지 확인 |

- [ ] **Step 3: iPad 첫 접속과 대여자 재등록**

iPad에서 `http://ljhs-MacBook-Pro.local:3000` 접속 → 홈 화면 추가 → 대여자 명단을 다시 등록하고 현재 대여 중인 기기를 실제 상태에 맞게 처리한다. 이 단계는 사용자가 직접 수행한다.
