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
