import { getStore } from "@/lib/db";
import { handle } from "@/lib/api-server";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function DELETE(_req: Request, { params }: Ctx) {
  return handle(async () => {
    const { id } = await params;
    return getStore().deleteBorrower(id);
  });
}
