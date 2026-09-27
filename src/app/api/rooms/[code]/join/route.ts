import { NextRequest } from "next/server";
import { joinRoom, GameError } from "@/lib/game";
import { makeSessionCookieHeader } from "@/lib/server-auth";

export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ code: string }> },
) {
  try {
    const { code } = await params;
    const body = (await req.json()) as { name?: string; avatar?: string };
    const result = await joinRoom(code, body.name ?? "", body.avatar ?? "🙂");
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
    return Response.json({ error: "Не удалось войти в комнату" }, { status: 500 });
  }
}
