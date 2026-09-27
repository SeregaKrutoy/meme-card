"use client";

import { memo } from "react";
import type { CardView } from "@/lib/types";

type Size = "sm" | "md" | "lg";

const SIZES: Record<Size, { box: string; emoji: string; text: string; pad: string }> = {
  sm: { box: "w-[104px] min-h-[150px]", emoji: "text-4xl", text: "text-[11px]", pad: "p-2.5" },
  md: { box: "w-[136px] min-h-[196px] sm:w-[152px] sm:min-h-[212px]", emoji: "text-5xl", text: "text-[13px]", pad: "p-3.5" },
  lg: { box: "w-[220px] min-h-[300px] sm:w-[260px] sm:min-h-[340px]", emoji: "text-7xl", text: "text-base sm:text-lg", pad: "p-6" },
};

export const MemeCard = memo(function MemeCard({
  card,
  onClick,
  selected = false,
  size = "md",
  disabled = false,
  faceDown = false,
  tilt = 0,
  label,
  accent = false,
}: {
  card: CardView;
  onClick?: () => void;
  selected?: boolean;
  size?: Size;
  disabled?: boolean;
  faceDown?: boolean;
  tilt?: number;
  label?: string;
  accent?: boolean;
}) {
  const s = SIZES[size];
  const interactive = Boolean(onClick) && !disabled;

  const inner = (
    <>
      <span
        className={`flex items-center justify-between text-[9px] font-bold uppercase tracking-[0.18em] ${
          accent ? "text-fuchsia-200/80" : "text-violet-300/70"
        }`}
      >
        <span className="truncate">{card.category}</span>
        {faceDown ? <span>🂠</span> : <span>МЕМ</span>}
      </span>

      {faceDown ? (
        <span className="flex flex-1 items-center justify-center text-5xl opacity-40">🎴</span>
      ) : (
        <>
          <span
            className={`flex flex-1 items-center justify-center leading-none ${s.emoji} ${
              selected ? "animate-pop" : ""
            }`}
            style={{ filter: "drop-shadow(0 8px 18px rgba(0,0,0,.45))" }}
          >
            {card.emoji}
          </span>
          <span
            className={`${s.text} font-semibold leading-snug text-violet-50 ${
              size === "sm" ? "line-clamp-3" : ""
            }`}
          >
            {card.text}
          </span>
        </>
      )}

      {label ? (
        <span className="mt-2 truncate rounded-full bg-black/40 px-2 py-1 text-center text-[10px] font-bold uppercase tracking-wider text-fuchsia-200">
          {label}
        </span>
      ) : null}
    </>
  );

  const shell = `card-face relative flex ${s.pad} ${s.box} flex-col gap-2 overflow-hidden rounded-[20px] border text-left shadow-[0_18px_40px_rgba(4,2,12,.6)] transition-all duration-200 ${
    selected
      ? "border-hot shadow-[0_0_0_3px_rgba(255,46,136,.5),0_22px_50px_rgba(255,46,136,.28)]"
      : "border-white/10 hover:border-white/25"
  } ${interactive ? "cursor-pointer hover:-translate-y-2 hover:shadow-[0_26px_55px_rgba(139,92,246,.4)]" : ""} ${
    disabled ? "opacity-45 saturate-50" : ""
  }`;

  const style = { transform: `rotate(${tilt}deg)` };

  if (!interactive) {
    return (
      <div className={shell} style={style}>
        {inner}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={`${shell} ${selected ? "-translate-y-3" : ""}`}
      style={style}
    >
      {inner}
    </button>
  );
});
