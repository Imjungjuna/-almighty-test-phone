export const BANNED_WORDS = ["담배", "금연"] as const;
export const BANNED_WORD_REPLACEMENT = "❤️";

// 글자 사이에 공백을 끼워 넣은 변형("담 배")도 잡는다.
const BANNED_PATTERN = new RegExp(
  BANNED_WORDS.map((word) => [...word].join("\\s*")).join("|"),
  "g"
);

export const replaceBannedWords = (text: string) =>
  text.replace(BANNED_PATTERN, BANNED_WORD_REPLACEMENT);
