"use client";

import { useSyncExternalStore } from "react";

/**
 * Процедурные звуковые эффекты на Web Audio API.
 * Внешних аудиофайлов нет — звуки генерируются осцилляторами прямо в браузере,
 * поэтому работают мгновенно и без сетевых задержек.
 */

const MUTE_KEY = "membattle:muted";
const listeners = new Set<() => void>();
let audioCtx: AudioContext | null = null;
let cachedMuted = false;

if (typeof window !== "undefined") {
  try {
    cachedMuted = window.localStorage.getItem(MUTE_KEY) === "1";
  } catch {
    cachedMuted = false;
  }
}

function getContext(): AudioContext | null {
  if (typeof window === "undefined" || cachedMuted) return null;
  const Ctx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!Ctx) return null;
  if (!audioCtx) audioCtx = new Ctx();
  if (audioCtx.state === "suspended") {
    void audioCtx.resume().catch(() => {});
  }
  return audioCtx;
}

type Tone = {
  freq: number;
  endFreq?: number;
  duration: number;
  delay?: number;
  type?: OscillatorType;
  gain?: number;
};

function playTones(tones: Tone[]): void {
  const ctx = getContext();
  if (!ctx) return;
  const now = ctx.currentTime;

  for (const t of tones) {
    try {
      const osc = ctx.createOscillator();
      const env = ctx.createGain();
      const start = now + (t.delay ?? 0);
      const stop = start + t.duration;
      const peak = t.gain ?? 0.08;

      osc.type = t.type ?? "triangle";
      osc.frequency.setValueAtTime(t.freq, start);
      if (t.endFreq) {
        osc.frequency.exponentialRampToValueAtTime(t.endFreq, stop);
      }

      env.gain.setValueAtTime(0.0001, start);
      env.gain.linearRampToValueAtTime(peak, start + 0.012);
      env.gain.exponentialRampToValueAtTime(0.0001, stop);

      osc.connect(env);
      env.connect(ctx.destination);
      osc.start(start);
      osc.stop(stop + 0.01);
    } catch {
      // Браузер мог заблокировать воспроизведение до первого клика.
    }
  }
}

export const sfx = {
  /** Нажатие на карту в руке. */
  select(): void {
    playTones([{ freq: 520, endFreq: 680, duration: 0.055, gain: 0.06 }]);
  },
  /** Выкладывание карты на стол. */
  play(): void {
    playTones([
      { freq: 340, endFreq: 540, duration: 0.08, gain: 0.09 },
      { freq: 680, duration: 0.09, delay: 0.06, gain: 0.07 },
    ]);
  },
  /** Отдача голоса за чужой мем. */
  vote(): void {
    playTones([
      { freq: 587, duration: 0.07, gain: 0.08 },
      { freq: 880, duration: 0.12, delay: 0.065, gain: 0.09 },
    ]);
  },
  /** Открытие этапа голосования. */
  votingOpen(): void {
    playTones([
      { freq: 440, duration: 0.08, gain: 0.07 },
      { freq: 554, duration: 0.08, delay: 0.075, gain: 0.07 },
      { freq: 659, duration: 0.14, delay: 0.15, gain: 0.08 },
    ]);
  },
  /** Начало нового раунда / раздача карт. */
  roundStart(): void {
    playTones([
      { freq: 392, duration: 0.07, gain: 0.07 },
      { freq: 523, duration: 0.07, delay: 0.07, gain: 0.07 },
      { freq: 659, duration: 0.13, delay: 0.14, gain: 0.08 },
    ]);
  },
  /** Победа в раунде. */
  roundWin(): void {
    playTones([
      { freq: 523, duration: 0.09, gain: 0.09 },
      { freq: 659, duration: 0.09, delay: 0.08, gain: 0.09 },
      { freq: 784, duration: 0.11, delay: 0.16, gain: 0.09 },
      { freq: 1046, duration: 0.24, delay: 0.26, gain: 0.1 },
    ]);
  },
  /** Финальная победа в партии. */
  fanfare(): void {
    playTones([
      { freq: 523, duration: 0.1, gain: 0.09 },
      { freq: 659, duration: 0.1, delay: 0.1, gain: 0.09 },
      { freq: 784, duration: 0.1, delay: 0.2, gain: 0.09 },
      { freq: 1046, duration: 0.18, delay: 0.3, gain: 0.1 },
      { freq: 784, duration: 0.09, delay: 0.5, gain: 0.08 },
      { freq: 1046, duration: 0.32, delay: 0.6, gain: 0.11 },
    ]);
  },
  /** Последние 5 секунд таймера. */
  tick(): void {
    playTones([{ freq: 920, duration: 0.035, type: "sine", gain: 0.05 }]);
  },
  /** Добавление своей карточки или нажатие кнопки. */
  pop(): void {
    playTones([{ freq: 460, endFreq: 760, duration: 0.065, gain: 0.07 }]);
  },
  /** Ошибка / недоступное действие. */
  error(): void {
    playTones([
      { freq: 240, endFreq: 180, duration: 0.12, type: "sawtooth", gain: 0.06 },
    ]);
  },
};

/* ------------------------------------------------------------------ */
/* управление звуком                                                   */
/* ------------------------------------------------------------------ */

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): boolean {
  return cachedMuted;
}

function getServerSnapshot(): boolean {
  return false;
}

export function toggleMute(): void {
  cachedMuted = !cachedMuted;
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(MUTE_KEY, cachedMuted ? "1" : "0");
    } catch {
      // localStorage может быть запрещён
    }
  }
  if (!cachedMuted) sfx.pop();
  listeners.forEach((l) => l());
}

export function useSoundMuted(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
