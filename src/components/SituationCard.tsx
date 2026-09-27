import { memo } from "react";
import type { CardView } from "@/lib/types";

export const SituationCard = memo(function SituationCard({
  card,
  round,
  compact = false,
}: {
  card: CardView;
  round: number;
  compact?: boolean;
}) {
  return (
    <div
      className={`card-situation relative flex w-full flex-col justify-between overflow-hidden rounded-[24px] border border-white/15 p-5 text-left shadow-[0_24px_60px_rgba(0,0,0,.6)] sm:p-7 ${
        compact ? "max-w-xl" : "max-w-3xl"
      }`}
    >
      <div className="flex items-center justify-between gap-3 text-[10px] font-bold uppercase tracking-[0.2em] text-white/50">
        <span className="rounded-full bg-white/10 px-2.5 py-1">Ситуация</span>
        <span>Раунд {round}</span>
      </div>

      <p
        className={`my-5 font-extrabold leading-[1.12] tracking-tight text-white ${
          compact ? "text-xl sm:text-2xl" : "text-2xl sm:text-4xl"
        }`}
      >
        {card.text}
      </p>

      <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-[0.2em] text-white/40">
        <span>МЕМ-БАТЛ</span>
        <span className="text-lg leading-none">🎴</span>
      </div>

      <div className="pointer-events-none absolute -right-10 -top-10 h-36 w-36 rounded-full bg-hot/20 blur-3xl" />
    </div>
  );
});
