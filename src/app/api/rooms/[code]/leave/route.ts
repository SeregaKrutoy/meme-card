import { NextRequest } from "next/server";
import { GameError, leaveRoom, loadRoomByCode } from "@/lib/game";
import { getAuthFromRequest } from "@/lib/server-auth";

export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ code: string }> },
) {
  try {
    const { code } = await params;
    const body = (await req.json().catch(() => ({}))) as {
      playerId?: number;
      token?: string;
    };
    const auth = getAuthFromRequest(req, code, body);
    const room = await loadRoomByCode(code);
    if (!room) return Response.json({ ok: true, closed: true });
    const result = await leaveRoom(room, auth?.playerId ?? null, auth?.token ?? null);
    return Response.json({ ok: true, closed: result === null });
  } catch (err) {
    if (err instanceof GameError) {
      return Response.json({ error: err.message }, { status: err.status });
    }
    console.error(err);
    return Response.json({ error: "Не удалось выйти" }, { status: 500 });
  }
}
