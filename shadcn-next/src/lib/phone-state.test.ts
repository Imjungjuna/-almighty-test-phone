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
