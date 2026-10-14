import { getStore } from "@/lib/db";
import { handle, readJson } from "@/lib/api-server";

export const runtime = "nodejs";

export async function POST(req: Request) {
  return handle(async () => {
    const body = await readJson<{ name: string; organization: string }>(req);
    return getStore().addBorrower(String(body.name ?? ""), String(body.organization ?? ""));
  });
}
