import { NextRequest } from "next/server";
import QRCode from "qrcode";
import { loadRoomByCode } from "@/lib/game";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ code: string }> },
) {
  const { code } = await params;
  const room = await loadRoomByCode(code);
  if (!room) {
    return Response.json({ error: "Комната не найдена" }, { status: 404 });
  }

  // Чистая ссылка — отсканировавший игрок вводит только своё имя и аватар.
  // За reverse proxy nextUrl.origin может быть внутренним localhost, поэтому
  // в первую очередь используем публичные forwarded-заголовки.
  const forwardedHost = req.headers.get("x-forwarded-host");
  const host = forwardedHost ?? req.headers.get("host") ?? req.nextUrl.host;
  const forwardedProto = req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const protocol = forwardedProto || req.nextUrl.protocol.replace(":", "") || "https";
  const inviteUrl = `${protocol}://${host}/room/${room.code}`;
  const svg = await QRCode.toString(inviteUrl, {
    type: "svg",
    errorCorrectionLevel: "M",
    margin: 1,
    color: { dark: "#120b26", light: "#ffffff" },
  });

  return new Response(svg, {
    headers: {
      "content-type": "image/svg+xml; charset=utf-8",
      "cache-control": "private, max-age=60",
    },
  });
}
