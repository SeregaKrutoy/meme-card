import { NextRequest } from "next/server";
import { getState } from "@/lib/game";
import { getAuthFromRequest } from "@/lib/server-auth";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ code: string }> },
) {
  const { code } = await params;
  const auth = getAuthFromRequest(req, code);
  const state = await getState(code, auth?.playerId ?? null, auth?.token ?? null);
  if (!state) {
    return Response.json({ error: "Комната не найдена" }, { status: 404 });
  }
  return Response.json(state);
}
