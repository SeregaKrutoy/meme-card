import { NextRequest } from "next/server";
import { GameError, loadRoomByCode, voteForPlay } from "@/lib/game";
import { getAuthFromRequest } from "@/lib/server-auth";

export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ code: string }> },
) {
  try {
    const { code } = await params;
    const body = (await req.json().catch(() => ({}))) as {
      playId?: number;
      playerId?: number;
      token?: string;
    };
    if (!body.playId) throw new GameError("Карта не выбрана");

    const auth = getAuthFromRequest(req, code, body);
    const room = await loadRoomByCode(code);
    if (!room) throw new GameError("Комната не найдена", 404);
    await voteForPlay(room, auth?.playerId ?? null, auth?.token ?? null, body.playId);
    return Response.json({ ok: true });
  } catch (err) {
    if (err instanceof GameError) {
      return Response.json({ error: err.message }, { status: err.status });
    }
    console.error(err);
    return Response.json({ error: "Не удалось отдать голос" }, { status: 500 });
  }
}
