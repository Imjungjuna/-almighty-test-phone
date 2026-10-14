import { getStore } from "@/lib/db";
import { handle, readJson, requireString } from "@/lib/api-server";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, { params }: Ctx) {
  return handle(async () => {
    const { id } = await params;
    const body = await readJson<{ borrowerId: string }>(req);
    const borrowerId = requireString(body.borrowerId, "대여자");
    return getStore().transfer(id, borrowerId);
  });
}
