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
