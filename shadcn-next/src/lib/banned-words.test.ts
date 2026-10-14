import { describe, expect, it } from "vitest";
import { replaceBannedWords } from "@/lib/banned-words";

describe("replaceBannedWords", () => {
  it("담배와 금연을 하트로 바꾼다", () => {
    expect(replaceBannedWords("담배는 백해무익하다")).toBe("❤️는 백해무익하다");
    expect(replaceBannedWords("정한님 금연 기원 1일차")).toBe("정한님 ❤️ 기원 1일차");
  });

  it("공백을 끼워 넣어도 바꾼다", () => {
    expect(replaceBannedWords("담 배 금  연")).toBe("❤️ ❤️");
  });

  it("여러 번 나와도 모두 바꾼다", () => {
    expect(replaceBannedWords("담배담배")).toBe("❤️❤️");
  });

  it("금지어가 없으면 그대로 둔다", () => {
    expect(replaceBannedWords("다음 사람을 위해 충전기 꼭 꽂아주세요")).toBe(
      "다음 사람을 위해 충전기 꼭 꽂아주세요"
    );
  });
});
