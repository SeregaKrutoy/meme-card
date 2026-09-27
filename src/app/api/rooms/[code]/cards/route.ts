import { NextRequest } from "next/server";
import {
  addCustomCard,
  GameError,
  loadRoomByCode,
  removeCustomCard,
} from "@/lib/game";
import { getAuthFromRequest } from "@/lib/server-auth";

export const dynamic = "force-dynamic";

type CardPayload = {
  kind?: "meme" | "situation";
  text?: string;
  emoji?: string;
  cardId?: number;
  playerId?: number;
  token?: string;
};

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ code: string }> },
) {
  try {
    const { code } = await params;
    const body = (await req.json().catch(() => ({}))) as CardPayload;
    if (body.kind !== "meme" && body.kind !== "situation") {
      throw new GameError("Выберите тип карточки");
    }
    const auth = getAuthFromRequest(req, code, body);
    const room = await loadRoomByCode(code);
    if (!room) throw new GameError("Комната не найдена", 404);

    await addCustomCard(
      room,
      auth?.playerId ?? null,
      auth?.token ?? null,
      body.kind,
      { text: body.text, emoji: body.emoji },
    );
    return Response.json({ ok: true });
  } catch (err) {
    if (err instanceof GameError) {
      return Response.json({ error: err.message }, { status: err.status });
    }
    console.error(err);
    return Response.json({ error: "Не удалось добавить карточку" }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ code: string }> },
) {
  try {
    const { code } = await params;
    const body = (await req.json().catch(() => ({}))) as CardPayload;
    if (body.kind !== "meme" && body.kind !== "situation") {
      throw new GameError("Выберите тип карточки");
    }
    if (!body.cardId || !Number.isFinite(body.cardId)) {
      throw new GameError("Карточка не выбрана");
    }
    const auth = getAuthFromRequest(req, code, body);
    const room = await loadRoomByCode(code);
    if (!room) throw new GameError("Комната не найдена", 404);

    await removeCustomCard(
      room,
      auth?.playerId ?? null,
      auth?.token ?? null,
      body.kind,
      body.cardId,
    );
    return Response.json({ ok: true });
  } catch (err) {
    if (err instanceof GameError) {
      return Response.json({ error: err.message }, { status: err.status });
    }
    console.error(err);
    return Response.json({ error: "Не удалось удалить карточку" }, { status: 500 });
  }
}
