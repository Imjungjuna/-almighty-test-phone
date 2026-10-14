import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { isPhoneId, type PhoneId } from "@/lib/phones";
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
