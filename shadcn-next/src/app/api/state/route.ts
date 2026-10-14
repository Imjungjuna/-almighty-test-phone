import { getStore } from "@/lib/db";
import { handle } from "@/lib/api-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return handle(() => getStore().getState());
}
