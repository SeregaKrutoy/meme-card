import { NextRequest } from "next/server";
import { createRoom, GameError } from "@/lib/game";
import { makeSessionCookieHeader } from "@/lib/server-auth";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      name?: string;
      avatar?: string;
      targetScore?: number;
    };
    const result = await createRoom(
      body.name ?? "",
      body.avatar ?? "🙂",
      Number(body.targetScore) || 5,
    );
    const response = Response.json(result);
    response.headers.append(
      "Set-Cookie",
      makeSessionCookieHeader(result.code, {
        playerId: result.playerId,
        token: result.token,
      }),
    );
    return response;
  } catch (err) {
    if (err instanceof GameError) {
      return Response.json({ error: err.message }, { status: err.status });
    }
    console.error(err);
    return Response.json({ error: "Не удалось создать комнату" }, { status: 500 });
  }
}
