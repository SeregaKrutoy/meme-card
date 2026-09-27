import { NextRequest } from "next/server";
import { GameError, loadRoomByCode, updateSettings } from "@/lib/game";
import { getAuthFromRequest } from "@/lib/server-auth";

export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ code: string }> },
) {
  try {
    const { code } = await params;
    const body = (await req.json().catch(() => ({}))) as {
      targetScore?: number;
      timersEnabled?: boolean;
      submitSeconds?: number;
      voteSeconds?: number;
      revealSeconds?: number;
      playerId?: number;
      token?: string;
    };
    const auth = getAuthFromRequest(req, code, body);
    const room = await loadRoomByCode(code);
    if (!room) throw new GameError("Комната не найдена", 404);

    await updateSettings(room, auth?.playerId ?? null, auth?.token ?? null, {
      targetScore: body.targetScore,
      timersEnabled: body.timersEnabled,
      submitSeconds: body.submitSeconds,
      voteSeconds: body.voteSeconds,
      revealSeconds: body.revealSeconds,
    });
    return Response.json({ ok: true });
  } catch (err) {
    if (err instanceof GameError) {
      return Response.json({ error: err.message }, { status: err.status });
    }
    console.error(err);
    return Response.json({ error: "Не удалось сохранить настройку" }, { status: 500 });
  }
}
