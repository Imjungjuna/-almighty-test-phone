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
