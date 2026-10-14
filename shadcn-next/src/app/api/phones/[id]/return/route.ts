import { getStore } from "@/lib/db";
import { handle } from "@/lib/api-server";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(_req: Request, { params }: Ctx) {
  return handle(async () => {
    const { id } = await params;
    return getStore().returnPhone(id);
  });
}
