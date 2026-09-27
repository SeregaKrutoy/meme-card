"use client";

import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { explainBotChoice } from "@/lib/bot-ai";
import { AVATARS } from "@/lib/cards";
import { sfx } from "@/lib/sound";
import {
  clearSession,
  clearSessionHash,
  resolveIdentity,
  saveSession,
  sessionHash,
  type Identity,
} from "@/lib/session";
import type { RoomState } from "@/lib/types";
import { MemeCard } from "./MemeCard";
import { SituationCard } from "./SituationCard";
import { Button, Pill, SoundToggle, Spinner } from "./ui";

type Action = (
  path: string,
  body?: unknown,
  method?: "POST" | "DELETE",
) => Promise<boolean>;

const POLL_MS = 1300;

function EmojiAvatar({ emoji, size = 42 }: { emoji: string; size?: number }) {
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-full border border-white/15 bg-white/10"
      style={{ width: size, height: size, fontSize: size * 0.55 }}
    >
      {emoji}
    </span>
  );
}

function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <h2 className="text-[11px] font-bold uppercase tracking-[0.2em] text-violet-300/70">
      {children}
    </h2>
  );
}

function CopyButton({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    const invite = `${window.location.origin}/room/${code}`;
    try {
      await navigator.clipboard.writeText(invite);
    } catch {
      try {
        await navigator.clipboard.writeText(code);
      } catch {
        // Код остаётся виден, его можно скопировать вручную.
      }
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  return (
    <button
      type="button"
      onClick={copy}
      className="rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-[10px] font-extrabold uppercase tracking-wider text-violet-200 transition hover:border-aqua hover:text-aqua"
    >
      {copied ? "Скопировано ✓" : "Скопировать ссылку"}
    </button>
  );
}

function InvitePanel({ code }: { code: string }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  async function share() {
    const url = `${window.location.origin}/room/${code}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: "МЕМ-БАТЛ", text: `Заходи в комнату ${code}`, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // Пользователь мог закрыть системный диалог — ничего не делаем.
    }
  }

  return (
    <div className="mt-5 rounded-2xl border border-aqua/25 bg-aqua/[0.07] p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-sm font-black text-cyan-100">Подключить друзей за 5 секунд</div>
          <p className="mt-1 text-xs leading-relaxed text-violet-200/65">
            Пусть отсканируют QR камерой телефона — останется только выбрать имя и аватар.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            className="rounded-xl border border-aqua/40 bg-aqua/10 px-3 py-2 text-[10px] font-extrabold uppercase tracking-wider text-cyan-100 transition hover:bg-aqua/20"
          >
            {open ? "Скрыть QR" : "Показать QR"}
          </button>
          <button
            type="button"
            onClick={() => void share()}
            className="rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-[10px] font-extrabold uppercase tracking-wider text-violet-100 transition hover:border-white/35"
          >
            {copied ? "Ссылка ✓" : "Поделиться"}
          </button>
        </div>
      </div>
      {open && (
        <div className="mt-4 flex flex-col items-center gap-3 rounded-xl bg-white p-4 text-center animate-rise sm:flex-row sm:text-left">
          <Image
            src={`/api/rooms/${code}/qr`}
            width={172}
            height={172}
            unoptimized
            alt={`QR-код для входа в комнату ${code}`}
            className="h-36 w-36 rounded-lg sm:h-40 sm:w-40"
          />
          <div className="text-ink">
            <div className="text-sm font-black">Отсканируйте камерой</div>
            <p className="mt-1 max-w-[240px] text-xs leading-relaxed text-slate-600">
              QR ведёт на чистую ссылку комнаты. Ваши данные хоста в код не попадают.
            </p>
            <div className="mt-3 rounded-lg bg-slate-100 px-3 py-2 font-mono text-sm font-black tracking-[0.18em] text-slate-900">
              {code}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function CustomDeckEditor({
  state,
  onAction,
  busy,
}: {
  state: RoomState;
  onAction: Action;
  busy: boolean;
}) {
  const isHost = state.you?.isHost ?? false;
  const [kind, setKind] = useState<"meme" | "situation">("meme");
  const [text, setText] = useState("");
  const [emoji, setEmoji] = useState("😂");
  const cards = kind === "meme" ? state.customMemes : state.customSituations;
  const title = kind === "meme" ? "мем" : "вопрос";

  async function addCard() {
    if (!text.trim()) return;
    const ok = await onAction("/cards", {
      kind,
      text: text.trim(),
      ...(kind === "meme" ? { emoji } : {}),
    });
    if (ok) {
      sfx.pop();
      setText("");
    }
  }

  async function removeCard(cardId: number) {
    await onAction("/cards", { kind, cardId }, "DELETE");
  }

  return (
    <section className="glass rounded-3xl p-6 sm:p-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <SectionTitle>Своя колода</SectionTitle>
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-violet-200/70">
            Карточки может добавлять любой игрок — без ограничений по количеству. Свою карточку можно удалить самому, чужие убирает только хост.
          </p>
        </div>
        <Pill tone="hot">✦ Без лимита</Pill>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-2 rounded-2xl border border-white/10 bg-black/25 p-1.5">
        {(["meme", "situation"] as const).map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => setKind(value)}
            className={`rounded-xl py-2.5 text-xs font-extrabold uppercase tracking-wider transition ${
              kind === value ? "bg-gradient-to-r from-hot to-grape text-white shadow-lg" : "text-violet-300 hover:text-white"
            }`}
          >
            {value === "meme" ? `🃏 Мемы (${state.customMemes.length})` : `🎴 Вопросы (${state.customSituations.length})`}
          </button>
        ))}
      </div>

      <div className="mt-4 rounded-2xl border border-white/10 bg-black/20 p-4">
        {kind === "meme" && (
          <div className="mb-3 flex flex-wrap gap-1.5">
            {["😂", "💀", "🤡", "🔥", "🫠", "🤯", "🐸", "🚀", "🍕", "🧠", "👀", "💅"].map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setEmoji(value)}
                className={`grid h-9 w-9 place-items-center rounded-lg border text-lg transition ${
                  emoji === value ? "border-hot bg-hot/20" : "border-white/10 bg-white/5 hover:border-white/30"
                }`}
              >
                {value}
              </button>
            ))}
          </div>
        )}
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            value={text}
            maxLength={kind === "meme" ? 96 : 220}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void addCard();
              }
            }}
            placeholder={kind === "meme" ? "Например: «Я в отпуске, меня нет»" : "Например: «Когда в чате пишут “есть минутка?”»"}
            className="min-w-0 flex-1 rounded-xl border border-white/15 bg-black/30 px-3.5 py-3 text-sm font-semibold text-white placeholder:text-violet-300/40 focus:border-hot focus:outline-none focus:ring-2 focus:ring-hot/40"
          />
          <Button disabled={!text.trim() || busy} onClick={() => void addCard()}>
            + Добавить
          </Button>
        </div>
        <p className="mt-2 text-[11px] text-violet-300/55">
          Добавлено {cards.length} {kind === "meme" ? "мемов" : "вопросов"} · Enter добавляет карточку
        </p>
      </div>

      {cards.length > 0 ? (
        <div className="no-scrollbar mt-5 flex gap-3 overflow-x-auto pb-2">
          {cards.map((card) => (
            <div key={card.id} className="relative shrink-0">
              {kind === "meme" ? (
                <MemeCard card={card} size="sm" />
              ) : (
                <div className="card-situation flex h-[150px] w-[190px] flex-col justify-between rounded-2xl border border-white/15 p-3 shadow-lg">
                  <span className="text-[9px] font-bold uppercase tracking-[0.15em] text-white/50">Свой вопрос</span>
                  <span className="line-clamp-4 text-sm font-black leading-tight text-white">{card.text}</span>
                  <span className="text-base">🎴</span>
                </div>
              )}
              <span className="mt-1.5 block max-w-[190px] truncate text-center text-[10px] font-bold text-violet-300/60">
                {card.isMine ? "ваша карточка" : card.authorName ?? "участник"}
              </span>
              {card.canDelete && (
                <button
                  type="button"
                  onClick={() => void removeCard(card.id)}
                  disabled={busy}
                  className="absolute -right-1.5 -top-1.5 grid h-7 w-7 place-items-center rounded-full border border-hot/60 bg-void text-sm font-black text-pink-200 shadow-lg transition hover:bg-hot hover:text-white disabled:opacity-50"
                  aria-label={card.isMine ? `Удалить свой ${title}` : `Удалить ${title} участника`}
                  title={card.isMine ? "Удалить свою карточку" : "Удалить как хост"}
                >
                  ×
                </button>
              )}
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-5 text-center text-xs text-violet-300/50">
          Здесь появятся карточки игроков. Основная колода уже готова к игре.
        </p>
      )}

      {!isHost && (
        <p className="mt-4 text-[11px] text-violet-300/50">
          Чужие карточки удалить нельзя — это может сделать только хост комнаты.
        </p>
      )}
    </section>
  );
}

/** Настройка длительности фаз: только хост и только в лобби. */
function TimerSettingsPanel({
  state,
  onAction,
  busy,
}: {
  state: RoomState;
  onAction: Action;
  busy: boolean;
}) {
  const isHost = state.you?.isHost ?? false;
  const { timers } = state;
  const rows = [
    { key: "submitSeconds", label: "Выбор карты", value: timers.submitSeconds, min: 10, max: 180 },
    { key: "voteSeconds", label: "Голосование", value: timers.voteSeconds, min: 10, max: 180 },
    { key: "revealSeconds", label: "Показ победителя", value: timers.revealSeconds, min: 5, max: 120 },
  ] as const;

  return (
    <section className="glass rounded-3xl p-6 sm:p-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <SectionTitle>Таймеры раунда</SectionTitle>
          <p className="mt-2 text-sm leading-relaxed text-violet-200/70">
            {timers.enabled
              ? "Фаза закрывается автоматически, когда время вышло."
              : "Таймеры выключены — раунд ждёт, пока все сделают ход."}
          </p>
        </div>
        <button
          type="button"
          disabled={!isHost || busy}
          onClick={() => onAction("/settings", { timersEnabled: !timers.enabled })}
          className={`rounded-xl border px-4 py-2.5 text-[11px] font-extrabold uppercase tracking-wider transition disabled:cursor-not-allowed disabled:opacity-60 ${
            timers.enabled
              ? "border-lime/45 bg-lime/15 text-lime-200 hover:bg-lime/25"
              : "border-white/15 bg-white/5 text-violet-200 hover:border-white/35"
          }`}
        >
          {timers.enabled ? "⏱ Включены" : "⏸ Выключены"}
        </button>
      </div>

      <div className={`mt-4 space-y-3 ${timers.enabled ? "" : "opacity-45"}`}>
        {rows.map((row) => (
          <div
            key={row.key}
            className="flex items-center gap-3 rounded-2xl border border-white/10 bg-black/20 p-3"
          >
            <span className="min-w-0 flex-1 text-sm font-bold">{row.label}</span>
            <button
              type="button"
              disabled={!isHost || busy || !timers.enabled || row.value <= row.min}
              onClick={() => onAction("/settings", { [row.key]: row.value - 5 })}
              className="grid h-9 w-9 place-items-center rounded-lg border border-white/15 bg-white/5 text-lg font-black text-violet-100 transition hover:border-hot disabled:opacity-35"
              aria-label={`Уменьшить: ${row.label}`}
            >
              −
            </button>
            <span className="w-16 text-center text-lg font-black text-amber-200">
              {row.value}с
            </span>
            <button
              type="button"
              disabled={!isHost || busy || !timers.enabled || row.value >= row.max}
              onClick={() => onAction("/settings", { [row.key]: row.value + 5 })}
              className="grid h-9 w-9 place-items-center rounded-lg border border-white/15 bg-white/5 text-lg font-black text-violet-100 transition hover:border-aqua disabled:opacity-35"
              aria-label={`Увеличить: ${row.label}`}
            >
              +
            </button>
          </div>
        ))}
      </div>

      <p className="mt-3 text-[11px] text-violet-300/55">
        {isHost
          ? "Шаг 5 секунд. Настройки доступны только до старта партии."
          : "Таймеры настраивает хост комнаты."}
      </p>
    </section>
  );
}

export function RoomClient({
  code,
  initialIdentity = null,
  initialState = null,
}: {
  code: string;
  /** Сессия из query-параметров, прочитанная на сервере страницы комнаты. */
  initialIdentity?: Identity | null;
  /** Состояние стола, полученное на сервере до первого рендера. */
  initialState?: RoomState | null;
}) {
  const router = useRouter();
  const roomCode = code.toUpperCase();

  // identityRef хранит актуальные креды вне замыканий и эффектов.
  // Это гарантирует, что fetchState никогда не использует устаревший или пустой id.
  const identityRef = useRef<Identity | null>(
    initialIdentity ?? resolveIdentity(roomCode),
  );
  const [identity, setIdentity] = useState<Identity | null>(() => identityRef.current);

  // Состояние стола уже передано с сервера (initialState).
  const [state, setState] = useState<RoomState | null>(initialState);
  const [missing, setMissing] = useState(initialState === null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const polling = useRef(false);

  const showToast = useCallback((message: string) => {
    setToast(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3800);
  }, []);

  /** Синхронизирует креды во всех хранилищах. */
  const rememberIdentity = useCallback(
    (next: Identity) => {
      identityRef.current = next;
      setIdentity(next);
      saveSession(roomCode, next);
    },
    [roomCode],
  );

  // При монтировании сохраняем сессию в браузерные хранилища (если они доступны).
  // Важно: мы НЕ вызываем window.history.replaceState, чтобы не сбивать Next.js роутер.
  useEffect(() => {
    const found = initialIdentity ?? resolveIdentity(roomCode);
    if (found) {
      identityRef.current = found;
      setIdentity((cur) => cur ?? found);
      saveSession(roomCode, found);
    }
  }, [initialIdentity, roomCode]);

  const fetchState = useCallback(async () => {
    if (polling.current) return;
    polling.current = true;
    try {
      const currentId = identityRef.current;
      // Передаём креды И в query-параметрах, И в заголовках.
      const url = currentId
        ? `/api/rooms/${roomCode}?p=${currentId.playerId}&t=${currentId.token}`
        : `/api/rooms/${roomCode}`;
      const response = await fetch(url, {
        headers: currentId
          ? { "x-player-id": String(currentId.playerId), "x-token": currentId.token }
          : {},
        cache: "no-store",
      });
      if (response.status === 404) {
        setMissing(true);
        return;
      }
      if (!response.ok) return;
      const next = (await response.json()) as RoomState;
      setMissing(false);
      setState((current) => {
        // КРИТИЧЕСКИ ВАЖНАЯ ЗАЩИТА:
        // Если игрок уже сидит за столом (current?.you существует),
        // но фоновый запрос вернул you = null (например, запрос ушёл без сессии),
        // МЫ НИ В КОЕМ СЛУЧАЕ не выкидываем игрока обратно на экран входа!
        if (current?.you && !next.you) {
          return { ...next, you: current.you };
        }
        if (!current) return next;

        // Сравниваем состояние БЕЗ secondsLeft: это единственное поле,
        // которое меняется на каждом опросе, и именно оно раньше
        // заставляло React перерисовывать весь экран комнаты
        // каждые 1.3 секунды. Счётчик таймера теперь считает локально.
        const { secondsLeft: _s1, ...stableCurrent } = current;
        const { secondsLeft: _s2, ...stableNext } = next;
        if (JSON.stringify(stableCurrent) === JSON.stringify(stableNext)) {
          return current;
        }
        return next;
      });
    } catch {
      // При временной потере сети продолжаем опрашивать комнату.
    } finally {
      polling.current = false;
    }
  }, [roomCode]);

  useEffect(() => {
    void fetchState();
    const timer = window.setInterval(() => void fetchState(), POLL_MS);
    return () => window.clearInterval(timer);
  }, [fetchState]);

  // Вернулись в вкладку — сразу синхронизируемся, а не ждём тик поллинга.
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "visible") void fetchState();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [fetchState]);

  const post = useCallback<Action>(
    async (path, body, method = "POST") => {
      const currentId = identityRef.current;
      if (!currentId) {
        showToast("Сначала войдите в комнату");
        return false;
      }
      setBusy(true);
      try {
        const url = `/api/rooms/${roomCode}${path}?p=${currentId.playerId}&t=${currentId.token}`;
        const response = await fetch(url, {
          method,
          headers: {
            "content-type": "application/json",
            "x-player-id": String(currentId.playerId),
            "x-token": currentId.token,
          },
          body: body === undefined ? undefined : JSON.stringify(body),
        });
        const result = (await response.json().catch(() => ({}))) as { error?: string };
        if (!response.ok) {
          showToast(result.error ?? "Не удалось выполнить действие");
          return false;
        }
        await fetchState();
        return true;
      } catch {
        showToast("Нет связи с сервером. Попробуйте ещё раз.");
        return false;
      } finally {
        setBusy(false);
      }
    },
    [fetchState, roomCode, showToast],
  );

  const join = useCallback(
    async (name: string, avatar: string) => {
      setBusy(true);
      try {
        const response = await fetch(`/api/rooms/${roomCode}/join`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name, avatar }),
        });
        const result = (await response.json().catch(() => ({}))) as {
          error?: string;
          playerId?: number;
          token?: string;
        };
        if (!response.ok || !result.playerId || !result.token) {
          showToast(result.error ?? "Не удалось войти в комнату");
          return;
        }
        const nextIdentity = { playerId: result.playerId, token: result.token };
        rememberIdentity(nextIdentity);
        await fetchState();
      } catch {
        showToast("Не удалось подключиться к комнате");
      } finally {
        setBusy(false);
      }
    },
    [fetchState, rememberIdentity, roomCode, showToast],
  );

  const leave = useCallback(async () => {
    await post("/leave");
    clearSession(roomCode);
    clearSessionHash();
    router.push("/");
  }, [post, roomCode, router]);

  if (!state && !missing) {
    return (
      <Shell code={roomCode}>
        <div className="grid min-h-[65vh] place-items-center px-4">
          <Spinner label="Подключаемся к игровому столу…" />
        </div>
      </Shell>
    );
  }

  if (missing) {
    return (
      <Shell code={roomCode}>
        <div className="mx-auto mt-12 max-w-md px-4">
          <div className="glass rounded-3xl p-9 text-center">
            <div className="text-5xl">🫥</div>
            <h1 className="mt-4 text-2xl font-black">Комната закрыта</h1>
            <p className="mt-2 text-sm leading-relaxed text-violet-200/70">
              Комната {roomCode} больше не существует. Создайте новую и пригласите друзей.
            </p>
            <div className="mt-6">
              <Button full onClick={() => router.push("/")}>На главную</Button>
            </div>
          </div>
        </div>
      </Shell>
    );
  }

  if (!state) return null;

  if (!state.you) {
    return (
      <>
        <JoinPanel code={roomCode} playerCount={state.players.length} onJoin={join} busy={busy} error={toast} />
      </>
    );
  }

  return (
    <Shell code={roomCode} state={state} onLeave={leave} toast={toast}>
      {state.status === "lobby" && <RoomLobby state={state} onAction={post} busy={busy} />}
      {state.status === "playing" && (
        <GameTable state={state} onAction={post} busy={busy} />
      )}
      {state.status === "finished" && (
        <GameResults state={state} onAction={post} onLeave={leave} busy={busy} />
      )}
    </Shell>
  );
}

function RoomLobby({
  state,
  onAction,
  busy,
}: {
  state: RoomState;
  onAction: Action;
  busy: boolean;
}) {
  const isHost = state.you?.isHost ?? false;
  const humans = state.players.filter((player) => !player.isBot).length;
  const bots = state.players.filter((player) => player.isBot);

  return (
    <div className="mx-auto grid w-full max-w-6xl gap-5 px-4 pb-16 pt-6 lg:grid-cols-[1.1fr_0.9fr]">
      <div className="space-y-5">
        <section className="glass rounded-3xl p-6 sm:p-8">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <SectionTitle>Код для друзей</SectionTitle>
            <CopyButton code={state.code} />
          </div>
          <div className="shine-text mt-2 text-6xl font-black tracking-[0.2em] sm:text-7xl">
            {state.code}
          </div>
          <p className="mt-3 max-w-xl text-sm leading-relaxed text-violet-200/70">
            Отправьте ссылку друзьям. Каждый играет на своём телефоне или компьютере —
            карты и голоса обновятся автоматически.
          </p>
          <InvitePanel code={state.code} />
        </section>

        <section className="glass rounded-3xl p-6 sm:p-8">
          <div className="flex items-center justify-between gap-4">
            <SectionTitle>Игроки за столом</SectionTitle>
            <Pill tone={state.players.length >= 3 ? "lime" : "violet"}>
              {state.players.length} / 8
            </Pill>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {state.players.map((player, index) => (
              <div
                key={player.id}
                className={`flex items-center gap-3 rounded-2xl border p-3 ${
                  player.isYou ? "border-hot/50 bg-hot/10" : "border-white/10 bg-white/5"
                }`}
              >
                <span className="w-5 text-center text-xs font-black text-violet-400/70">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <EmojiAvatar emoji={player.avatar} />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-bold">{player.name}</div>
                  <div className="mt-0.5 text-[10px] uppercase tracking-wider text-violet-300/60">
                    {player.isBot
                      ? "Бот · играет сам"
                      : player.isHost
                        ? "Создатель"
                        : "Готов играть"}
                    {player.isYou ? " · это вы" : ""}
                  </div>
                </div>
                {player.isHost && <span title="Хост">👑</span>}
                {player.isBot && <Pill tone="aqua">🤖</Pill>}
              </div>
            ))}
            {Array.from({ length: Math.max(0, 3 - state.players.length) }, (_, i) => (
              <div
                key={`waiting-${i}`}
                className="flex items-center gap-3 rounded-2xl border border-dashed border-white/10 p-3 text-violet-300/45"
              >
                <span className="grid h-[42px] w-[42px] place-items-center rounded-full border border-dashed border-white/15 text-lg">＋</span>
                <span className="text-sm">Ждём друга…</span>
              </div>
            ))}
          </div>
          <p className="mt-4 text-xs text-violet-300/60">
            За столом нужно минимум трое: так в голосовании всегда есть выбор. Если друзей не хватает, досидят боты.
          </p>
        </section>
      </div>

      <div className="space-y-5">
        <section className="glass rounded-3xl p-6 sm:p-8">
          <SectionTitle>Правила партии</SectionTitle>
          <div className="mt-4 space-y-4">
            {[
              ["01", "Ситуация", "На столе появляется смешное задание."],
              ["02", "Выбор карты", "Все игроки тайно выкладывают по одному мему."],
              ["03", "Голосование", "Карты открываются без имён — все голосуют за лучшую."],
              ["04", "Победа", "Очко получает автор карты с наибольшим числом голосов."],
            ].map(([n, title, description]) => (
              <div key={n} className="flex gap-3">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-grape/25 text-xs font-black text-violet-100">{n}</span>
                <div>
                  <div className="text-sm font-bold">{title}</div>
                  <p className="mt-0.5 text-xs leading-relaxed text-violet-200/60">{description}</p>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-5 rounded-2xl border border-white/10 bg-black/20 p-4">
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-bold">Играем до</span>
              <span className="text-xs text-violet-300/60">Очки за победу в раунде</span>
            </div>
            <div className="mt-3 grid grid-cols-4 gap-2">
              {[3, 5, 7, 10].map((value) => (
                <button
                  key={value}
                  type="button"
                  disabled={!isHost || busy}
                  onClick={() => onAction("/settings", { targetScore: value })}
                  className={`rounded-xl border py-2.5 text-lg font-black transition disabled:cursor-not-allowed ${
                    state.targetScore === value
                      ? "border-hot bg-hot/20 text-white"
                      : "border-white/10 bg-white/5 text-violet-200 hover:border-white/30"
                  } ${!isHost ? "opacity-60" : ""}`}
                >
                  {value}
                </button>
              ))}
            </div>
          </div>
        </section>

        <section className="glass rounded-3xl p-6 sm:p-8">
          <div className="flex items-center justify-between gap-3">
            <SectionTitle>Соперники</SectionTitle>
            <Pill tone={humans > 1 ? "lime" : "aqua"}>
              {humans} {plural(humans, "друг", "друга", "друзей")} · {bots.length}{" "}
              {plural(bots.length, "бот", "бота", "ботов")}
            </Pill>
          </div>
          <p className="mt-3 text-xs leading-relaxed text-violet-200/65">
            {humans > 1
              ? "Друзья уже за столом. Можно добавить ботов, чтобы раунды шли быстрее."
              : "Пока вы один. Добавьте ботов — они сами выкладывают мемы и голосуют, а друзья смогут присоединиться и позже."}
          </p>
          {isHost ? (
            <div className="mt-4 flex flex-wrap gap-2">
              <Button
                variant="ghost"
                disabled={busy || !state.botsAllowed}
                onClick={() => onAction("/bots")}
              >
                + Добавить бота
              </Button>
              {bots.map((bot) => (
                <button
                  key={bot.id}
                  type="button"
                  disabled={busy}
                  onClick={() => onAction("/bots/remove", { playerId: bot.id })}
                  className="rounded-xl border border-white/15 bg-white/5 px-3 py-3 text-xs font-bold text-violet-200 transition hover:border-hot hover:text-hot disabled:opacity-50"
                  title="Убрать бота"
                >
                  {bot.avatar} {bot.name} ✕
                </button>
              ))}
            </div>
          ) : (
            <p className="mt-4 text-xs text-violet-300/55">
              Управлять ботами может только хост.
            </p>
          )}
        </section>

        <TimerSettingsPanel state={state} onAction={onAction} busy={busy} />

        <CustomDeckEditor state={state} onAction={onAction} busy={busy} />

        {isHost ? (
          <section className="glass rounded-3xl p-6 sm:p-8">
            <Button full disabled={busy || !state.canStart} onClick={() => onAction("/start")}>
              {state.canStart ? "Раздать карты и начать" : state.startHint ?? "Ждём участников"}
            </Button>
            <p className="mt-3 text-center text-xs text-lime-200/70">
              {state.canStart
                ? state.players.length < 3
                  ? "Стол меньше трёх — недостающие места автоматически займут боты."
                  : "Каждому участнику выдадут по 7 мем-карт."
                : "Пригласите друзей по ссылке или начните в одиночку."}
            </p>
          </section>
        ) : (
          <section className="glass flex items-center justify-center rounded-3xl p-8">
            <Spinner label="Хост собирает компанию…" />
          </section>
        )}
      </div>
    </div>
  );
}

function GameTable({
  state,
  onAction,
  busy,
}: {
  state: RoomState;
  onAction: Action;
  busy: boolean;
}) {
  const [selection, setSelection] = useState<{ cardId: number; round: number; phase: string } | null>(null);
  const hasPlayed = state.you?.hasPlayed ?? false;
  const hasVoted = state.you?.hasVoted ?? false;
  const selectedCard =
    selection && selection.round === state.round && selection.phase === state.phase && !hasPlayed
      ? selection.cardId
      : null;

  // Озвучиваем смену фазы. Отсчёт таймера со своим тиканьем живёт
  // внутри маленьких компонентов, поэтому весь экран из-за него не рендерится.
  const prevPhaseRef = useRef<string | null>(null);
  useEffect(() => {
    const prev = prevPhaseRef.current;
    prevPhaseRef.current = state.phase;
    if (!prev || prev === state.phase) return;
    if (state.phase === "voting") sfx.votingOpen();
    else if (state.phase === "reveal") sfx.roundWin();
    else if (state.phase === "submitting") sfx.roundStart();
  }, [state.phase]);

  async function submitCard() {
    if (selectedCard === null) return;
    const ok = await onAction("/play", { cardId: selectedCard });
    if (ok) {
      sfx.play();
      setSelection(null);
    }
  }

  if (state.phase === "reveal") {
    return <RoundReveal state={state} onAction={onAction} busy={busy} />;
  }

  const showHandPanel = state.phase === "submitting" && !hasPlayed;

  return (
    <div className={`mx-auto w-full max-w-6xl px-4 pt-5 ${showHandPanel ? "pb-64" : "pb-16"}`}>
      <div className="mx-auto max-w-4xl">
        {state.situation && <SituationCard card={state.situation} round={state.round} />}

        {state.phase === "transitioning" ? (
          <div className="glass mt-6 flex items-center justify-center rounded-3xl p-6">
            <Spinner label="Перетасовываем колоду…" />
          </div>
        ) : state.phase === "submitting" ? (
          <section className="glass mt-5 rounded-3xl p-5 text-center sm:p-6">
            <div className="text-3xl">{hasPlayed ? "🂠" : "🃏"}</div>
            <h1 className="mt-2 text-xl font-black">
              {hasPlayed ? "Ваш мем уже на столе" : "Выберите мем под ситуацию"}
            </h1>
            <p className="mt-1 text-sm text-violet-200/70">
              {hasPlayed
                ? "Как только все сделают ход, начнётся общее голосование."
                : "Карту выкладывают все игроки. Судьи нет — победителя выберет голосование."}
            </p>
            <PhaseTimer
              deadline={phaseDeadline(state)}
              hint="До конца выбора"
              offHint="Таймер выключен — ждём всех игроков"
            />
            <RoundProgress
              players={state.players}
              done={state.submittedCount}
              total={state.players.length}
              mode="played"
              caption="карт на столе"
            />
          </section>
        ) : state.phase === "voting" ? (
          <section className="glass mt-5 rounded-3xl p-5 text-center sm:p-6">
            <div className="text-3xl">🗳️</div>
            <h1 className="mt-2 text-xl font-black">
              {hasVoted ? "Голос принят" : "Голосуйте за лучший мем"}
            </h1>
            <p className="mt-1 text-sm text-violet-200/70">
              {hasVoted
                ? "Ждём остальных. Побеждает карта с наибольшим числом голосов."
                : "Выберите самый смешной ответ. За свою карту голосовать нельзя."}
            </p>
            <PhaseTimer
              deadline={phaseDeadline(state)}
              hint="До конца голосования"
              offHint="Таймер выключен — ждём все голоса"
            />
            <RoundProgress
              players={state.players}
              done={state.votedCount}
              total={state.voterTotal}
              mode="voted"
              caption="голосов отдано"
            />
          </section>
        ) : null}

        {state.phase === "voting" && state.plays.length > 0 && (
          <div className="mt-7">
            <div className="flex items-center justify-between gap-3">
              <SectionTitle>Анонимные ответы</SectionTitle>
              <Pill tone="violet">
                {state.plays.length} {plural(state.plays.length, "карта", "карты", "карт")}
              </Pill>
            </div>
            <div className="mt-4 flex flex-wrap items-start justify-center gap-4 sm:gap-6">
              {state.plays.map((play, index) => {
                const canVote = !hasVoted && !play.isMine && !busy;
                return (
                  <div
                    key={play.playId}
                    className="animate-rise"
                    style={{ animationDelay: `${index * 75}ms` }}
                  >
                    <MemeCard
                      card={play.card}
                      size="md"
                      tilt={((index % 3) - 1) * 1.5}
                      selected={play.votedByMe}
                      accent={play.votedByMe}
                      disabled={play.isMine && !hasVoted}
                      onClick={
                        canVote
                          ? async () => {
                              const ok = await onAction("/vote", { playId: play.playId });
                              if (ok) sfx.vote();
                            }
                          : undefined
                      }
                    />
                    <p className="mt-2 text-center text-[10px] font-bold uppercase tracking-wider text-violet-300/60">
                      {play.votedByMe
                        ? "✓ ваш голос"
                        : play.isMine
                          ? "ваша карта"
                          : hasVoted
                            ? "голос отдан"
                            : busy
                              ? "отправляем…"
                              : "голосовать"}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {showHandPanel && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-white/10 bg-[#090610]/95 pb-[max(0.8rem,env(safe-area-inset-bottom))] pt-3 shadow-[0_-20px_60px_rgba(0,0,0,.55)] backdrop-blur-xl">
          <div className="mx-auto max-w-6xl px-4">
            <div className="mb-2 flex items-center justify-between gap-3">
              <div>
                <SectionTitle>Ваши карты</SectionTitle>
                <p className="mt-1 text-[10px] text-violet-300/55">
                  {state.myHand.length} в руке · выберите одну
                </p>
              </div>
              <Button disabled={selectedCard === null || busy} onClick={submitCard}>
                {busy ? "Выкладываем…" : "Выложить мем →"}
              </Button>
            </div>
            <div className="no-scrollbar flex gap-3 overflow-x-auto pb-1">
              {state.myHand.map((card, index) => (
                <div key={card.id} className="shrink-0">
                  <MemeCard
                    card={card}
                    size="sm"
                    selected={selectedCard === card.id}
                    tilt={(index % 2 === 0 ? 1 : -1) * 1.2}
                    onClick={() => {
                      sfx.select();
                      setSelection((current) =>
                        current?.cardId === card.id && current.round === state.round && current.phase === state.phase
                          ? null
                          : { cardId: card.id, round: state.round, phase: state.phase },
                      );
                    }}
                  />
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** Дедлайн смены фазы (epoch ms) по моменту смены фазы с сервера. */
function phaseDeadline(state: RoomState): number | null {
  if (!state.timers.enabled) return null;
  const base = new Date(state.phaseChangedAt).getTime();
  const limit =
    state.phase === "submitting"
      ? state.timers.submitSeconds
      : state.phase === "voting"
        ? state.timers.voteSeconds
        : state.phase === "reveal"
          ? state.timers.revealSeconds
          : 0;
  return base + limit * 1000;
}

/**
 * Локальный обратный отсчёт до дедлайна. Перерисовывается только маленький
 * компонент со счётчиком, а не весь экран комнаты. На последних пяти секундах
 * играет тиканье (каждую секунду не чаще одного раза).
 *
 * Значение «оставшихся секунд» вычисляется на рендере из состояния «сейчас»,
 * которое обновляется интервалом — поэтому в теле эффекта нет синхронного
 * setState, и React не делает каскадных рендеров.
 */
function useCountdown(deadline: number | null): number | null {
  const [now, setNow] = useState<number>(() => Date.now());
  const lastTickedRef = useRef(0);

  // Тикаем, только пока есть активный дедлайн.
  useEffect(() => {
    lastTickedRef.current = 0;
    if (deadline === null) return;
    const id = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(id);
  }, [deadline]);

  // Тиканье на последних пяти секундах.
  useEffect(() => {
    if (deadline === null) return;
    const left = Math.max(0, Math.ceil((deadline - now) / 1000));
    if (left > 0 && left <= 5 && left !== lastTickedRef.current) {
      lastTickedRef.current = left;
      sfx.tick();
    }
  }, [deadline, now]);

  if (deadline === null) return null;
  return Math.max(0, Math.ceil((deadline - now) / 1000));
}

/** Инлайн-счётчик секунд: перерисовывается только он сам. */
function SecondsLeft({ deadline }: { deadline: number | null }) {
  const left = useCountdown(deadline);
  if (left === null) return <span>—</span>;
  const urgent = left <= 5;
  return (
    <span
      className={
        urgent ? "animate-pulse font-black text-pink-300" : "text-amber-200/80"
      }
    >
      {left}с
    </span>
  );
}

/** Общий блок обратного отсчёта фазы. */
function PhaseTimer({
  deadline,
  hint,
  offHint,
}: {
  deadline: number | null;
  hint: string;
  offHint: string;
}) {
  const left = useCountdown(deadline);
  if (deadline === null) {
    return <p className="mt-3 text-xs text-violet-300/50">⏸ {offHint}</p>;
  }
  const urgent = (left ?? 0) <= 5;
  return (
    <p
      className={`mt-3 text-sm font-black tabular-nums ${
        urgent ? "animate-pulse text-pink-300" : "text-amber-200"
      }`}
    >
      ⏱ {hint}: {left ?? 0}с
    </p>
  );
}

function RoundProgress({
  players,
  done,
  total,
  mode,
  caption,
}: {
  players: RoomState["players"];
  done: number;
  total: number;
  mode: "played" | "voted";
  caption: string;
}) {
  return (
    <div className="mx-auto mt-5 max-w-xl">
      <div className="flex flex-wrap justify-center gap-2">
        {players.map((player) => {
          const ok = mode === "played" ? player.hasPlayed : player.hasVoted;
          return (
            <span
              key={player.id}
              className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-bold ${
                ok
                  ? "border-lime/40 bg-lime/10 text-lime-200"
                  : "border-white/10 bg-white/5 text-violet-200/70"
              }`}
            >
              <span>{player.avatar}</span>
              <span className="max-w-[100px] truncate">{player.name}</span>
              {player.isBot && <span title="Бот">🤖</span>}
              <span>{ok ? "✓" : "…"}</span>
            </span>
          );
        })}
      </div>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/10">
        <div
          className="h-full rounded-full bg-gradient-to-r from-hot to-aqua transition-all duration-500"
          style={{ width: `${total > 0 ? Math.min(100, (done / total) * 100) : 0}%` }}
        />
      </div>
      <p className="mt-2 text-[10px] uppercase tracking-wider text-violet-300/50">
        {done} из {total} {caption}
      </p>
    </div>
  );
}

function RoundReveal({
  state,
  onAction,
  busy,
}: {
  state: RoomState;
  onAction: Action;
  busy: boolean;
}) {
  const winners = state.winners;
  const isTie = winners.length > 1;
  const youReady = state.you?.isReady ?? false;
  const topScore = winners.length > 0 ? Math.max(...winners.map((w) => w.score)) : 0;
  const endsGame = topScore >= state.targetScore;
  const sortedPlays = [...state.plays].sort((a, b) => b.votes - a.votes);

  return (
    <div className="mx-auto w-full max-w-5xl px-4 pb-12 pt-6">
      <section className="glass rounded-[32px] p-6 text-center sm:p-10">
        <Pill tone={winners.length > 0 ? "gold" : "violet"}>
          {winners.length > 0 ? (isTie ? "🏆 Ничья в раунде" : "🏆 Итог раунда") : "Раунд без победителя"}
        </Pill>

        {winners.length > 0 ? (
          <>
            <h1 className="mt-4 text-3xl font-black sm:text-5xl">
              {winners.map((winner, index) => (
                <span key={winner.playId}>
                  {index > 0 && <span className="text-violet-300/60"> и </span>}
                  {winner.playerAvatar} <span className="shine-text">{winner.playerName}</span>
                </span>
              ))}
            </h1>
            <p className="mt-2 text-sm text-violet-200/70">
              {isTie ? "Поровну голосов — очко каждому" : `Набрано голосов: ${winners[0].votes}`}
              {" · "}
              {endsGame ? "победа в партии!" : `до титула: ${Math.max(0, state.targetScore - topScore)}`}
            </p>
          </>
        ) : (
          <>
            <h1 className="mt-4 text-3xl font-black sm:text-4xl">Голосов не было</h1>
            <p className="mt-2 text-sm text-violet-200/70">
              Очки никому не достались — открываем следующую ситуацию.
            </p>
          </>
        )}

        {state.situation && (
          <div className="mx-auto mt-7 max-w-2xl">
            <SituationCard card={state.situation} round={state.round} compact />
          </div>
        )}

        {sortedPlays.length > 0 && (
          <div className="mt-8">
            <SectionTitle>Результаты голосования</SectionTitle>
            <div className="mt-4 flex flex-wrap items-start justify-center gap-4">
              {sortedPlays.map((play, index) => (
                <div
                  key={play.playId}
                  className={`animate-rise ${play.isWinner ? "scale-[1.04]" : "opacity-70"}`}
                  style={{ animationDelay: `${index * 55}ms` }}
                >
                  <MemeCard
                    card={play.card}
                    size="sm"
                    tilt={(index % 2 === 0 ? 1 : -1) * 1.5}
                    label={play.playerName ?? "Игрок"}
                    accent={play.isWinner}
                  />
                  <div className="mt-2 w-[104px] text-center">
                    <div
                      className={`text-sm font-black ${
                        play.isWinner ? "text-amber-200" : "text-violet-200/70"
                      }`}
                    >
                      {play.votes} {plural(play.votes, "голос", "голоса", "голосов")}
                    </div>
                    {play.voterNames.length > 0 && (
                      <div className="mt-0.5 truncate text-[10px] text-violet-300/55" title={play.voterNames.join(", ")}>
                        {play.voterNames.join(", ")}
                      </div>
                    )}
                    {play.votedByMe && (
                      <div className="mt-0.5 text-[10px] font-bold text-cyan-200">ваш голос</div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="mt-8 flex flex-col items-center gap-3">
          <Button disabled={busy || youReady} onClick={() => onAction("/advance")}>
            {youReady
              ? `Ждём других (${state.readyCount}/${state.readyTotal})`
              : endsGame
                ? "К таблице результатов →"
                : "Следующая ситуация →"}
          </Button>
          <div className="flex flex-wrap items-center justify-center gap-2 text-xs text-violet-300/55">
            <span>
              Готовы: {state.readyCount} из {state.readyTotal}
            </span>
            {state.timers.enabled && (
              <span>
                · автопереход через <SecondsLeft deadline={phaseDeadline(state)} />
              </span>
            )}
            {!state.timers.enabled && <span>· таймер выключен, ждём всех</span>}
          </div>
        </div>
      </section>
    </div>
  );
}

function GameResults({
  state,
  onAction,
  onLeave,
  busy,
}: {
  state: RoomState;
  onAction: Action;
  onLeave: () => void;
  busy: boolean;
}) {
  const ranking = useMemo(
    () => [...state.players].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name)),
    [state.players],
  );
  const champion = ranking[0];
  const isHost = state.you?.isHost ?? false;

  useEffect(() => {
    sfx.fanfare();
  }, []);

  return (
    <div className="mx-auto w-full max-w-3xl px-4 pb-16 pt-7">
      <section className="glass rounded-[32px] p-7 text-center sm:p-12">
        <div className="text-6xl">🏆</div>
        <p className="mt-4 text-[11px] font-bold uppercase tracking-[0.24em] text-violet-300/65">
          партия завершена
        </p>
        <h1 className="mt-2 text-4xl font-black sm:text-5xl">
          <span className="shine-text">{champion?.name ?? "—"}</span>
        </h1>
        <p className="mt-2 text-sm text-violet-200/70">Новый главный мемолог компании</p>

        <ol className="mt-8 space-y-2 text-left">
          {ranking.map((player, index) => (
            <li
              key={player.id}
              className={`flex items-center gap-3 rounded-2xl border p-3 ${
                player.isYou ? "border-hot/50 bg-hot/10" : "border-white/10 bg-white/5"
              }`}
            >
              <span className="w-7 text-center text-lg font-black text-violet-300/60">{index + 1}</span>
              <EmojiAvatar emoji={player.avatar} />
              <span className="min-w-0 flex-1 truncate font-bold">{player.name}</span>
              {player.isYou && <Pill tone="hot">вы</Pill>}
              <span className="font-black text-amber-200">{player.score} очк.</span>
            </li>
          ))}
        </ol>

        <div className="mt-8 flex flex-col gap-3">
          {isHost ? (
            <Button full disabled={busy} onClick={() => onAction("/rematch")}>
              {busy ? "Перемешиваем…" : "Реванш — сыграть снова"}
            </Button>
          ) : (
            <p className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-violet-200/70">
              Хост может запустить реванш в любой момент.
            </p>
          )}
          <Button variant="ghost" onClick={onLeave}>Выйти из комнаты</Button>
        </div>
      </section>
    </div>
  );
}

/**
 * Компактный чип игрока для мобильного табло: аватар, имя, очки
 * и отметка готовности в текущей фазе раунда.
 */
const ScoreChip = memo(function ScoreChip({
  player,
  phase,
}: {
  player: RoomState["players"][number];
  phase: RoomState["phase"];
}) {
  const done =
    phase === "submitting"
      ? player.hasPlayed
      : phase === "voting"
        ? player.hasVoted
        : phase === "reveal"
          ? player.isReady
          : false;

  return (
    <span
      className={`flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1.5 ${
        player.isYou
          ? "border-hot/60 bg-hot/15"
          : "border-white/10 bg-white/5"
      }`}
    >
      <span className="text-sm leading-none">{player.avatar}</span>
      <span
        className={`max-w-[68px] truncate text-[11px] font-bold ${
          player.isYou ? "text-white" : "text-violet-100/85"
        }`}
      >
        {player.isYou ? "Вы" : player.name}
      </span>
      {done && <span className="text-[10px] leading-none text-lime-300">✓</span>}
      <span
        className={`min-w-[14px] text-center text-sm font-black tabular-nums ${
          player.isYou ? "text-hot" : "text-amber-200"
        }`}
      >
        {player.score}
      </span>
    </span>
  );
});

function Shell({
  code,
  children,
  state,
  onLeave,
  toast,
}: {
  code: string;
  children: ReactNode;
  state?: RoomState;
  onLeave?: () => void;
  toast?: string | null;
}) {
  const topPlayers = useMemo(
    () => state ? [...state.players].sort((a, b) => b.score - a.score).slice(0, 4) : [],
    [state],
  );

  // Полный список для мобильного табло: свой счёт всегда закреплён слева,
  // остальные отсортированы по очкам и прокручиваются по горизонтали.
  const ranked = useMemo(
    () =>
      state
        ? [...state.players].sort(
            (a, b) => b.score - a.score || a.name.localeCompare(b.name),
          )
        : [],
    [state],
  );
  const me = ranked.find((p) => p.isYou) ?? null;
  const others = ranked.filter((p) => !p.isYou);

  return (
    <>
      <div className="nebula" aria-hidden />
      <div className="nebula-grid" aria-hidden />
      <header className="sticky top-0 z-40 border-b border-white/10 bg-void/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3">
          <Link href="/" className="flex shrink-0 items-center gap-2">
            <span className="text-2xl">🎭</span>
            <span className="shine-text text-lg font-black">МЕМ-БАТЛ</span>
          </Link>
          <span className="hidden h-5 w-px bg-white/15 sm:block" />
          <span className="flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1.5">
            <span className="text-[9px] uppercase tracking-widest text-violet-300/55">код</span>
            <span className="text-sm font-black tracking-[0.2em]">{code}</span>
          </span>
          {state?.status === "playing" && (
            <span className="hidden rounded-full border border-white/15 bg-white/5 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider text-violet-200 sm:block">
              Раунд {state.round} / {state.targetScore} очков
            </span>
          )}
          <div className="ml-auto flex items-center gap-2">
            <div className="hidden items-center gap-1.5 lg:flex">
              {topPlayers.map((player) => (
                <span key={player.id} className="flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-xs font-bold">
                  <span>{player.avatar}</span>
                  <span className="max-w-[75px] truncate">{player.name}</span>
                  <span className="text-hot">{player.score}</span>
                </span>
              ))}
            </div>
            <SoundToggle />
            {onLeave && (
              <button
                type="button"
                onClick={onLeave}
                className="rounded-xl border border-white/15 px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-violet-200 transition hover:border-hot hover:text-hot"
              >
                Выйти
              </button>
            )}
          </div>
        </div>

        {/* Мобильное табло: на узких экранах список игроков в шапке скрыт,
            поэтому счёт показываем отдельной строкой. Свой результат
            закреплён слева и не уезжает при прокрутке. */}
        {state && state.status === "playing" && (
          <div className="border-t border-white/10 bg-black/25 lg:hidden">
            <div className="mx-auto flex max-w-6xl items-center gap-2 px-3 py-2">
              <span className="shrink-0 rounded-lg bg-white/5 px-2 py-1 text-[9px] font-black uppercase leading-tight tracking-wider text-violet-300/70">
                Р{state.round}
                <br />
                до {state.targetScore}
              </span>

              {me && <ScoreChip player={me} phase={state.phase} />}

              <div className="no-scrollbar flex min-w-0 flex-1 items-center gap-2 overflow-x-auto">
                {others.map((player) => (
                  <ScoreChip key={player.id} player={player} phase={state.phase} />
                ))}
              </div>
            </div>
          </div>
        )}
      </header>
      {toast && (
        <div role="status" className="fixed left-1/2 top-20 z-50 max-w-[calc(100vw-2rem)] -translate-x-1/2 animate-pop">
          <div className="rounded-2xl border border-hot/50 bg-panel/95 px-5 py-3 text-center text-sm font-bold text-pink-100 shadow-[0_18px_50px_rgba(0,0,0,.6)]">
            {toast}
          </div>
        </div>
      )}
      <main className="relative">{children}</main>
    </>
  );
}

function JoinPanel({
  code,
  playerCount,
  onJoin,
  busy,
  error,
}: {
  code: string;
  playerCount: number;
  onJoin: (name: string, avatar: string) => Promise<void>;
  busy: boolean;
  error: string | null;
}) {
  const [name, setName] = useState("");
  const [avatar, setAvatar] = useState(AVATARS[0]);

  return (
    <>
      <div className="nebula" aria-hidden />
      <div className="nebula-grid" aria-hidden />
      <main className="relative mx-auto flex min-h-screen w-full max-w-lg flex-col justify-center px-4 py-10">
        <div className="glass rounded-[32px] p-7 sm:p-10">
          <div className="flex items-center gap-2">
            <span className="text-3xl">🎭</span>
            <span className="shine-text text-xl font-black">МЕМ-БАТЛ</span>
          </div>
          <h1 className="mt-5 text-3xl font-black leading-tight">
            Заходи в комнату <span className="shine-text tracking-[0.14em]">{code}</span>
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-violet-200/70">
            {playerCount > 0
              ? `За столом уже ${playerCount} ${plural(playerCount, "игрок", "игрока", "игроков")}. Представьтесь, чтобы присоединиться.`
              : "Представьтесь, чтобы присоединиться к друзьям."}
          </p>
          <form
            className="mt-7 space-y-5"
            onSubmit={(event) => {
              event.preventDefault();
              if (name.trim()) void onJoin(name.trim(), avatar);
            }}
          >
            <label className="block">
              <span className="mb-2 block text-[11px] font-bold uppercase tracking-[0.17em] text-violet-300/70">Имя за столом</span>
              <input
                value={name}
                maxLength={24}
                onChange={(event) => setName(event.target.value)}
                placeholder="Например, Дядя Мем"
                className="w-full rounded-2xl border border-white/15 bg-black/30 px-4 py-3.5 font-semibold text-white placeholder:text-violet-300/40 focus:border-hot focus:outline-none focus:ring-2 focus:ring-hot/40"
              />
            </label>
            <div>
              <span className="mb-2 block text-[11px] font-bold uppercase tracking-[0.17em] text-violet-300/70">Выберите аватар</span>
              <div className="flex flex-wrap gap-2">
                {AVATARS.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    onClick={() => setAvatar(emoji)}
                    className={`grid h-10 w-10 place-items-center rounded-xl border text-xl transition ${
                      avatar === emoji ? "border-hot bg-hot/20 shadow-[0_0_0_3px_rgba(255,46,136,.3)]" : "border-white/10 bg-white/5 hover:border-white/30"
                    }`}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            </div>
            {error && <p role="alert" className="rounded-xl border border-hot/40 bg-hot/10 px-4 py-3 text-sm font-semibold text-pink-200">{error}</p>}
            <Button type="submit" full disabled={!name.trim() || busy}>
              {busy ? "Подключаемся…" : "Сесть за стол"}
            </Button>
          </form>
          <p className="mt-5 text-center text-xs text-violet-300/55">2–8 игроков · боты доберут стол · 7 мем-карт на руке</p>
        </div>
      </main>
    </>
  );
}

function plural(value: number, one: string, few: string, many: string) {
  const lastTwo = value % 100;
  if (lastTwo >= 11 && lastTwo <= 14) return many;
  const last = value % 10;
  if (last === 1) return one;
  if (last >= 2 && last <= 4) return few;
  return many;
}

function formatTime(seconds: number) {
  const safe = Math.max(0, seconds);
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, "0")}`;
}
