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
