import { cookies } from "next/headers";
import { RoomClient } from "@/components/RoomClient";
import { getState } from "@/lib/game";
import { identityFromSearchParams } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function RoomPage({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ code }, query, cookieStore] = await Promise.all([
    params,
    searchParams,
    cookies(),
  ]);

  let identity = identityFromSearchParams(query);
  if (!identity) {
    const cookieVal = cookieStore.get(`membattle_session_${code.toUpperCase()}`)?.value;
    if (cookieVal && cookieVal.includes(":")) {
      const [idStr, tok] = cookieVal.split(":");
      const pid = Number(idStr);
      if (Number.isFinite(pid) && pid > 0 && tok) {
        identity = { playerId: pid, token: tok };
      }
    }
  }

  const initialState = await getState(
    code,
    identity?.playerId ?? null,
    identity?.token ?? null,
  );

  return (
    <RoomClient
      code={code}
      initialIdentity={identity}
      initialState={initialState}
    />
  );
}
