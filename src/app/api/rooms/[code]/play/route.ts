import { NextRequest } from "next/server";
import { GameError, loadRoomByCode, playCard } from "@/lib/game";
import { getAuthFromRequest } from "@/lib/server-auth";

export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ code: string }> },
) {
  try {
    const { code } = await params;
    const body = (await req.json().catch(() => ({}))) as {
      cardId?: number;
      playerId?: number;
      token?: string;
    };
    if (!body.cardId) throw new GameError("Карта не выбрана");

    const auth = getAuthFromRequest(req, code, body);
    if (!auth) throw new GameError("Сессия устарела, обновите страницу", 401);

    const room = await loadRoomByCode(code);
    if (!room) throw new GameError("Комната не найдена", 404);
    await playCard(room, auth.playerId, auth.token, body.cardId);
    return Response.json({ ok: true });
  } catch (err) {
    if (err instanceof GameError) {
      return Response.json({ error: err.message }, { status: err.status });
    }
    console.error(err);
    return Response.json({ error: "Не удалось выложить карту" }, { status: 500 });
  }
}
