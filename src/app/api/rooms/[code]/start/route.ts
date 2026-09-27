import { NextRequest } from "next/server";
import { GameError, loadRoomByCode, requireHost, startGame } from "@/lib/game";
import { getAuthFromRequest } from "@/lib/server-auth";

export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ code: string }> },
) {
  try {
    const { code } = await params;
    const auth = getAuthFromRequest(req, code);
    const room = await loadRoomByCode(code);
    if (!room) throw new GameError("Комната не найдена", 404);
    const host = await requireHost(room, auth?.playerId ?? null, auth?.token ?? null);
    await startGame(room, host.id);
    return Response.json({ ok: true });
  } catch (err) {
    if (err instanceof GameError) {
      return Response.json({ error: err.message }, { status: err.status });
    }
    console.error(err);
    return Response.json({ error: "Не удалось начать игру" }, { status: 500 });
  }
}
