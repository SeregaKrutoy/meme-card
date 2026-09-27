"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Button, Pill } from "./ui";
import { MemeCard } from "./MemeCard";
import { QrRoomScanner } from "./QrRoomScanner";
import { SituationCard } from "./SituationCard";
import { AVATARS } from "@/lib/cards";
import { roomUrlWithIdentity, saveSession } from "@/lib/session";
import type { CardView } from "@/lib/types";

const PROFILE_KEY = "membattle:profile";

type Profile = { name: string; avatar: string };

const SAMPLE_MEMES: CardView[] = [
  { id: 1, emoji: "😱", text: "Это фиаско, братан", category: "реакция" },
  { id: 2, emoji: "🚀", text: "Запуск в пятницу", category: "работа" },
  { id: 3, emoji: "🐱", text: "Кот, который всё видел", category: "животные" },
  { id: 4, emoji: "🤖", text: "Я тоже бот, бывает", category: "техно" },
];

const SAMPLE_SITUATIONS: CardView[] = [
  { id: 1, emoji: "🎴", text: "Когда в пятницу вечером запушил в прод.", category: "работа" },
  { id: 2, emoji: "🎴", text: "Твоё лицо, когда…", category: "реакция" },
  { id: 3, emoji: "🎴", text: "Когда бабушка просит «настроить интернет».", category: "быт" },
];

export function Landing({
  memeCount,
  situationCount,
}: {
  memeCount: number;
  situationCount: number;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const inviteCode = (searchParams.get("code") ?? "").toUpperCase().slice(0, 4);

  const [tab, setTab] = useState<"create" | "join">(inviteCode ? "join" : "create");
  const [name, setName] = useState("");
  const [avatar, setAvatar] = useState(AVATARS[0]);
  const [code, setCode] = useState(inviteCode);
  const [target, setTarget] = useState(5);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scannerOpen, setScannerOpen] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(PROFILE_KEY);
      if (raw) {
        const p = JSON.parse(raw) as Profile;
        if (p.name) setName(p.name);
        if (p.avatar && AVATARS.includes(p.avatar)) setAvatar(p.avatar);
      }
    } catch {
      /* ignore */
    }
  }, []);

  const remember = (p: Profile) => {
    try {
      localStorage.setItem(PROFILE_KEY, JSON.stringify(p));
    } catch {
      /* ignore */
    }
  };

  const nameOk = name.trim().length >= 2;

  /**
   * Запоминает игрока и переводит его в комнату.
   * Переход выполняется всегда: даже если браузер запретил хранилище,
   * сессия уедет во фрагмент адреса и комната её прочитает.
   */
  function enterRoom(code: string, playerId?: number, token?: string) {
    let target = `/room/${code}`;
    if (code && playerId && token) {
      const identity = { playerId, token };
      saveSession(code, identity);
      target = roomUrlWithIdentity(code, identity);
    }
    setBusy(false);
    // Полный переход в комнату: браузер загружает страницу со всеми query-параметрами,
    // сервер генерирует начальное состояние стола с игроком за столом,
    // без задержек и артефактов клиентского роутера.
    if (typeof window !== "undefined") {
      window.location.assign(target);
    } else {
      router.push(target);
    }
  }

  function openScannedRoom(roomCode: string) {
    setScannerOpen(false);
    setCode(roomCode);
    setTab("join");
    setError(null);
    // QR ведёт на чистую ссылку: новый игрок представляется уже в комнате.
    window.location.assign(`/room/${roomCode}`);
  }

  async function submit() {
    setError(null);
    if (!nameOk) {
      setError("Имя должно быть хотя бы из двух символов");
      return;
    }
    setBusy(true);
    try {
      if (tab === "create") {
        const res = await fetch("/api/rooms", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: name.trim(), avatar, targetScore: target }),
        });
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
          code?: string;
          playerId?: number;
          token?: string;
        };
        if (!res.ok || !data.code) {
          setError(data.error ?? "Не удалось создать комнату");
          return;
        }
        remember({ name: name.trim(), avatar });
        enterRoom(data.code, data.playerId, data.token);
        return;
      }

      if (code.trim().length < 4) {
        setError("Код комнаты состоит из 4 символов");
        return;
      }
      const res = await fetch(`/api/rooms/${code.trim().toUpperCase()}/join`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: name.trim(), avatar }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        code?: string;
        playerId?: number;
        token?: string;
      };
      if (!res.ok || !data.code) {
        setError(data.error ?? "Не удалось войти в комнату");
        return;
      }
      remember({ name: name.trim(), avatar });
      enterRoom(data.code, data.playerId, data.token);
    } catch {
      setError("Проблемы с сетью, попробуйте ещё раз");
    } finally {
      setBusy(false);
    }
  }

  const showcase = useMemo(
    () => SAMPLE_SITUATIONS[(Math.floor(Date.now() / 60000) + 1) % SAMPLE_SITUATIONS.length],
    [],
  );

  return (
    <>
      <div className="nebula" aria-hidden />
      <div className="nebula-grid" aria-hidden />

      <QrRoomScanner
        open={scannerOpen}
        onClose={() => setScannerOpen(false)}
        onRoom={openScannedRoom}
      />

      <div className="relative mx-auto w-full max-w-6xl px-4 pb-20 pt-6 sm:pt-10">
        {/* шапка */}
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <span className="text-3xl">🎭</span>
            <span className="shine-text text-xl font-black tracking-tight">МЕМ-БАТЛ</span>
          </div>
          <div className="hidden items-center gap-2 sm:flex">
            <Pill tone="violet">🎴 {memeCount} мемов</Pill>
            <Pill tone="aqua">💬 {situationCount} ситуаций</Pill>
          </div>
        </header>

        {/* герой */}
        <section className="mt-10 grid items-center gap-10 lg:mt-16 lg:grid-cols-[1.05fr_0.95fr]">
          <div>
            <Pill tone="hot">🔥 карточная игра для компании</Pill>
            <h1 className="mt-5 text-[clamp(2.6rem,7vw,4.6rem)] font-black leading-[0.98] tracking-tight">
              Ситуация на столе.
              <br />
              <span className="shine-text">Мем у тебя на руках.</span>
            </h1>
            <p className="mt-5 max-w-xl text-lg leading-relaxed text-violet-100/80">
              Каждый раунд выпадает ситуация — и все игроки выкладывают мем, который лучше
              всего её описывает. Затем все голосуют за лучший мем — очко автору, титул
              победителю. Если друзей меньше трёх, свободные места займут боты.
            </p>

            <div className="mt-8 flex flex-wrap gap-3">
              <Button onClick={() => setTab("create")}>Создать комнату</Button>
              <Button variant="ghost" onClick={() => setTab("join")}>
                Войти по коду
              </Button>
              <button
                type="button"
                onClick={() => setScannerOpen(true)}
                className="inline-flex items-center justify-center gap-2 rounded-2xl border border-aqua/40 bg-aqua/10 px-5 py-3.5 text-sm font-extrabold uppercase tracking-wider text-cyan-100 transition hover:border-aqua hover:bg-aqua/20"
              >
                <span className="text-lg">▦</span> Сканировать QR
              </button>
            </div>
            <Link
              href="/practice"
              className="mt-4 inline-flex items-center gap-2 rounded-xl border border-aqua/30 bg-aqua/10 px-4 py-2.5 text-sm font-bold text-cyan-100 transition hover:border-aqua/60 hover:bg-aqua/15"
            >
              <span>🎮</span> Сыграть быстрый матч против ботов <span>→</span>
            </Link>

            <dl className="mt-10 grid max-w-lg grid-cols-3 gap-4">
              {[
                ["2–8", "друзей за столом"],
                ["7", "карт на руках"],
                ["5", "очков до победы"],
              ].map(([v, l]) => (
                <div key={l} className="glass rounded-2xl px-4 py-3">
                  <dt className="text-2xl font-black text-hot">{v}</dt>
                  <dd className="text-[11px] uppercase tracking-wider text-violet-300/70">
                    {l}
                  </dd>
                </div>
              ))}
            </dl>
          </div>

          {/* форма */}
          <div className="glass rounded-[32px] p-6 shadow-[0_30px_80px_rgba(0,0,0,.5)] sm:p-8">
            <div className="grid grid-cols-2 gap-2 rounded-2xl border border-white/10 bg-black/30 p-1.5">
              {(
                [
                  ["create", "Создать"],
                  ["join", "Присоединиться"],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => {
                    setTab(key);
                    setError(null);
                  }}
                  className={`rounded-xl py-2.5 text-xs font-extrabold uppercase tracking-wider transition ${
                    tab === key
                      ? "bg-gradient-to-r from-hot to-grape text-white shadow-lg"
                      : "text-violet-300 hover:text-white"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="mt-6 space-y-5">
              <label className="block">
                <span className="mb-2 block text-[11px] font-bold uppercase tracking-[0.18em] text-violet-300/70">
                  Имя
                </span>
                <input
                  value={name}
                  maxLength={24}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Например, Дядя Мем"
                  className="w-full rounded-2xl border border-white/15 bg-black/30 px-4 py-3.5 text-base font-semibold text-white placeholder:text-violet-300/40 focus:border-hot focus:outline-none focus:ring-2 focus:ring-hot/40"
                />
              </label>

              <div>
                <span className="mb-2 block text-[11px] font-bold uppercase tracking-[0.18em] text-violet-300/70">
                  Аватар
                </span>
                <div className="flex flex-wrap gap-2">
                  {AVATARS.map((a) => (
                    <button
                      key={a}
                      type="button"
                      onClick={() => setAvatar(a)}
                      className={`grid h-11 w-11 place-items-center rounded-xl border text-xl transition ${
                        avatar === a
                          ? "border-hot bg-hot/20 shadow-[0_0_0_3px_rgba(255,46,136,.35)]"
                          : "border-white/10 bg-white/5 hover:border-white/30"
                      }`}
                    >
                      {a}
                    </button>
                  ))}
                </div>
              </div>

              {tab === "join" && (
                <div className="animate-rise">
                  <label className="block">
                    <span className="mb-2 block text-[11px] font-bold uppercase tracking-[0.18em] text-violet-300/70">
                      Код комнаты
                    </span>
                    <input
                      value={code}
                      maxLength={4}
                      onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
                      placeholder="ABCD"
                      className="w-full rounded-2xl border border-white/15 bg-black/30 px-4 py-3.5 text-center text-2xl font-black tracking-[0.4em] text-white placeholder:text-violet-300/30 focus:border-hot focus:outline-none focus:ring-2 focus:ring-hot/40"
                    />
                  </label>
                  <div className="my-3 flex items-center gap-3 text-[10px] font-bold uppercase tracking-wider text-violet-300/40">
                    <span className="h-px flex-1 bg-white/10" /> или <span className="h-px flex-1 bg-white/10" />
                  </div>
                  <button
                    type="button"
                    onClick={() => setScannerOpen(true)}
                    className="flex w-full items-center justify-center gap-2 rounded-xl border border-aqua/35 bg-aqua/10 px-4 py-3 text-xs font-extrabold uppercase tracking-wider text-cyan-100 transition hover:border-aqua hover:bg-aqua/20"
                  >
                    <span className="text-base">▦</span> Сканировать QR камерой
                  </button>
                </div>
              )}

              {tab === "create" && (
                <div className="animate-rise">
                  <span className="mb-2 block text-[11px] font-bold uppercase tracking-[0.18em] text-violet-300/70">
                    Играть до
                  </span>
                  <div className="grid grid-cols-4 gap-2">
                    {[3, 5, 7, 10].map((v) => (
                      <button
                        key={v}
                        type="button"
                        onClick={() => setTarget(v)}
                        className={`rounded-xl border py-3 text-lg font-black transition ${
                          target === v
                            ? "border-hot bg-hot/20 text-white"
                            : "border-white/10 bg-white/5 text-violet-200 hover:border-white/30"
                        }`}
                      >
                        {v}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {error && (
                <p className="rounded-xl border border-hot/40 bg-hot/10 px-4 py-3 text-sm font-semibold text-pink-200">
                  {error}
                </p>
              )}

              <Button full disabled={busy || !nameOk} onClick={submit}>
                {busy
                  ? "Секунду…"
                  : tab === "create"
                    ? "Создать и сесть за стол"
                    : "Присоединиться"}
              </Button>

              <p className="text-center text-xs text-violet-300/60">
                {tab === "create"
                  ? "Вы станете хостом и получите код для друзей"
                  : "Код из 4 символов вам даст хост комнаты"}
              </p>
            </div>
          </div>
        </section>

        {/* правила */}
        <section className="mt-20 sm:mt-28">
          <h2 className="text-2xl font-black sm:text-3xl">Три шага — и все ржут</h2>
          <div className="mt-6 grid gap-4 md:grid-cols-3">
            {[
              [
                "🎴",
                "Ситуация",
                "В начале раунда на стол выкладывается ситуация: «Когда в пятницу вечером запушил в прод».",
              ],
              [
                "🃏",
                "Ваш мем",
                "Из семи карт на руках выбираете ту, которая лучше всего описывает ситуацию, и выкладываете её.",
              ],
              [
                "🗳️",
                "Общее голосование",
                "Карты вскрываются анонимно, и все голосуют за лучшую. Очко получает автор карты-победителя.",
              ],
            ].map(([icon, title, text]) => (
              <div key={title} className="glass rounded-3xl p-6">
                <div className="text-4xl">{icon}</div>
                <h3 className="mt-4 text-lg font-black">{title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-violet-100/75">{text}</p>
              </div>
            ))}
          </div>
        </section>

        {/* витрина колоды */}
        <section className="mt-20 sm:mt-28">
          <div className="glass rounded-[32px] p-6 sm:p-10">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <h2 className="text-2xl font-black sm:text-3xl">Что inside колоды</h2>
                <p className="mt-2 max-w-xl text-sm text-violet-100/75">
                  {memeCount} мем-карт шести категорий и {situationCount} ситуаций из работы,
                  быта, техно и чистого абсурда. Каждая партия собирается случайно.
                </p>
              </div>
              <div className="hidden sm:block">
                <Pill tone="hot">обновляется каждый раунд</Pill>
              </div>
            </div>

            <div className="mt-8 grid gap-8 lg:grid-cols-[0.9fr_1.1fr]">
              <div>
                <p className="mb-4 text-[11px] font-bold uppercase tracking-[0.2em] text-violet-300/70">
                  Пример ситуации
                </p>
                <SituationCard card={showcase} round={1} compact />
              </div>
              <div>
                <p className="mb-4 text-[11px] font-bold uppercase tracking-[0.2em] text-violet-300/70">
                  Примеры мемов на руках
                </p>
                <div className="no-scrollbar flex gap-4 overflow-x-auto pb-2">
                  {SAMPLE_MEMES.map((c, i) => (
                    <div key={c.id} className="shrink-0">
                      <MemeCard card={c} size="sm" tilt={(i % 2 === 0 ? 1 : -1) * 2} />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* финальный CTA */}
        <section className="mt-20 text-center sm:mt-28">
          <h2 className="text-3xl font-black sm:text-5xl">
            Собирайте компанию — <span className="shine-text">мемы сами себя не выложат</span>
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-violet-100/75">
            Создайте комнату, отправьте код друзьям и решайте, чей мем смешнее. Один экран на
            каждого — играть можно и с телефона.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Button onClick={() => setTab("create")}>Создать комнату</Button>
            <Button variant="ghost" onClick={() => setTab("join")}>
              Войти по коду
            </Button>
          </div>
        </section>

        <footer className="mt-20 flex flex-col items-center gap-2 border-t border-white/10 pt-8 text-center text-xs text-violet-300/50">
          <span className="flex items-center gap-2">
            <span className="text-base">🎭</span> МЕМ-БАТЛ — карточная игра по мемам для компании
          </span>
          <span>Локальная игра: правила, колода и состояние хранятся на вашем сервере.</span>
        </footer>
      </div>
    </>
  );
}
