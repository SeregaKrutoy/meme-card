import { Suspense } from "react";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { memeCards, situationCards } from "@/db/schema";
import { ensureCards } from "@/lib/game";
import { Landing } from "@/components/Landing";

export const dynamic = "force-dynamic";

async function DeckStats() {
  try {
    await ensureCards();
    const [m] = await db.select({ c: sql<number>`count(*)::int` }).from(memeCards);
    const [s] = await db
      .select({ c: sql<number>`count(*)::int` })
      .from(situationCards);
    return <Landing memeCount={m?.c ?? 0} situationCount={s?.c ?? 0} />;
  } catch {
    return <Landing memeCount={0} situationCount={0} />;
  }
}

export default function HomePage() {
  return (
    <Suspense fallback={<div className="grid min-h-screen place-items-center text-violet-300">Загружаем колоду…</div>}>
      <DeckStats />
    </Suspense>
  );
}
