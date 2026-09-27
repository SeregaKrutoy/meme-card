import type { ReactNode } from "react";
import { toggleMute, useSoundMuted } from "@/lib/sound";

export function Avatar({
  emoji,
  size = 40,
  ring = false,
  dim = false,
}: {
  emoji: string;
  size?: number;
  ring?: boolean;
  dim?: boolean;
}) {
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-full border border-white/15 bg-white/10 ${
        ring ? "shadow-[0_0_0_3px_rgba(255,46,136,.65)]" : ""
      } ${dim ? "opacity-40 grayscale" : ""}`}
      style={{ width: size, height: size, fontSize: size * 0.55 }}
    >
      {emoji}
    </span>
  );
}

export function Button({
  children,
  onClick,
  variant = "primary",
  disabled = false,
  full = false,
  type = "button",
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: "primary" | "ghost" | "gold";
  disabled?: boolean;
  full?: boolean;
  type?: "button" | "submit";
}) {
  const base =
    "inline-flex items-center justify-center gap-2 rounded-2xl px-6 py-3.5 text-sm font-extrabold uppercase tracking-wider transition-all duration-200 disabled:cursor-not-allowed disabled:opacity-40 active:scale-[.97]";
  const styles = {
    primary:
      "bg-gradient-to-r from-hot via-fuchsia-500 to-grape text-white shadow-[0_14px_36px_rgba(255,46,136,.35)] hover:brightness-110 hover:shadow-[0_18px_44px_rgba(255,46,136,.5)]",
    gold:
      "bg-gradient-to-r from-gold to-orange-400 text-black shadow-[0_14px_36px_rgba(251,191,36,.3)] hover:brightness-110",
    ghost:
      "border border-white/20 bg-white/5 text-violet-100 hover:border-white/40 hover:bg-white/10",
  } as const;

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`${base} ${styles[variant]} ${full ? "w-full" : ""}`}
    >
      {children}
    </button>
  );
}

export function Pill({
  children,
  tone = "violet",
}: {
  children: ReactNode;
  tone?: "violet" | "hot" | "aqua" | "gold" | "lime";
}) {
  const tones = {
    violet: "bg-grape/20 text-violet-200 border-grape/40",
    hot: "bg-hot/20 text-pink-200 border-hot/40",
    aqua: "bg-aqua/15 text-cyan-200 border-aqua/40",
    gold: "bg-gold/20 text-amber-200 border-gold/40",
    lime: "bg-lime/20 text-lime-200 border-lime/40",
  } as const;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-bold uppercase tracking-wider ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center gap-3 text-sm font-semibold text-violet-300">
      <span className="relative inline-block h-4 w-4">
        <span className="absolute inset-0 animate-spin rounded-full border-2 border-violet-400/30 border-t-hot" />
      </span>
      {label}
    </div>
  );
}

export function SoundToggle() {
  const muted = useSoundMuted();
  return (
    <button
      type="button"
      onClick={toggleMute}
      title={muted ? "Включить звук" : "Выключить звук"}
      aria-label={muted ? "Включить звук" : "Выключить звук"}
      className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-white/15 bg-white/5 text-base transition hover:border-aqua hover:bg-aqua/10"
    >
      {muted ? "🔇" : "🔊"}
    </button>
  );
}
