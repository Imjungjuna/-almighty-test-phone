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
