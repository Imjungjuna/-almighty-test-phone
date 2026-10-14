import { describe, expect, it } from "vitest";
import { cn } from "@/lib/utils";

describe("vitest 설정", () => {
  it("경로 별칭이 동작한다", () => {
    expect(cn("a", "b")).toBe("a b");
  });
});
