import { NextRequest } from "next/server";

export type AuthCredentials = {
  playerId: number;
  token: string;
};

function parseId(raw: string | number | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Извлекает playerId и token из всех возможных источников:
 *   1. Заголовки x-player-id и x-token
 *   2. Query-параметры ?p=…&t=…
 *   3. Cookie membattle_session_${code}
 *   4. Тело запроса (если передано)
 *
 * Это гарантирует, что ни один запрос не потеряет сессию из-за
 * ограничений песочницы браузера или блокировки заголовков.
 */
export function getAuthFromRequest(
  req: NextRequest,
  code: string,
  body?: { playerId?: number; token?: string } | null,
): AuthCredentials | null {
  const upper = code.trim().toUpperCase();

  // 1. Заголовки
  const headerId = parseId(req.headers.get("x-player-id"));
  const headerToken = req.headers.get("x-token")?.trim() || null;
  if (headerId && headerToken) {
    return { playerId: headerId, token: headerToken };
  }

  // 2. Query-параметры
  const queryId = parseId(req.nextUrl.searchParams.get("p"));
  const queryToken = req.nextUrl.searchParams.get("t")?.trim() || null;
  if (queryId && queryToken) {
    return { playerId: queryId, token: queryToken };
  }

  // 3. Cookie
  const cookieVal = req.cookies.get(`membattle_session_${upper}`)?.value;
  if (cookieVal && cookieVal.includes(":")) {
    const [idStr, tok] = cookieVal.split(":");
    const cid = parseId(idStr);
    const ctok = tok?.trim() || null;
    if (cid && ctok) {
      return { playerId: cid, token: ctok };
    }
  }

  // 4. Тело запроса
  if (body) {
    const bodyId = parseId(body.playerId);
    const bodyToken = body.token?.trim() || null;
    if (bodyId && bodyToken) {
      return { playerId: bodyId, token: bodyToken };
    }
  }

  return null;
}

/** Создаёт заголовок Set-Cookie для сессии в комнате. */
export function makeSessionCookieHeader(
  code: string,
  identity: AuthCredentials,
): string {
  const upper = code.trim().toUpperCase();
  return `membattle_session_${upper}=${identity.playerId}:${identity.token}; Path=/; SameSite=Lax; Max-Age=2592000`;
}
