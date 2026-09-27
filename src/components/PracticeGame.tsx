"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import Link from "next/link";
import {
  explainBotChoice,
  pickBestCardForBot,
  pickBestPlayForBotJudge,
  scoreMemeForSituation,
} from "@/lib/bot-ai";
import { AVATARS, MEME_DECK, SITUATION_DECK } from "@/lib/cards";
import { sfx } from "@/lib/sound";
import type { CardView } from "@/lib/types";
import { MemeCard } from "./MemeCard";
import { SituationCard } from "./SituationCard";
import { Button, Pill, SoundToggle, Spinner } from "./ui";

type PlayerId = "you" | "bot1" | "bot2" | "bot3";
/** Судьи нет: карты выкладывают все, победителя определяет голосование. */
type PracticePhase = "playing" | "voting" | "counting" | "reveal" | "finished";
type Participant = {
  id: PlayerId;
  name: string;
  avatar: string;
  score: number;
  isBot: boolean;
};
type PracticePlay = {
  id: string;
  playerId: PlayerId;
  card: CardView;
};
type PracticeMatch = {
  round: number;
  targetScore: number;
  phase: PracticePhase;
  players: Participant[];
  hands: Record<PlayerId, CardView[]>;
  situation: CardView;
  plays: PracticePlay[];
  /** Кто за какой ход проголосовал: playerId -> playId. */
  votes: Record<string, string>;
  /** Победившие ходы раунда (несколько при равенстве голосов). */
  winnerPlayIds: string[];
};

const TARGET_SCORE = 3;
const HAND_SIZE = 7;
const HUMAN_ID: PlayerId = "you";
const BOT_NAMES = [
  { id: "bot1" as const, name: "Кот-менеджер", avatar: "🐱" },
  { id: "bot2" as const, name: "Тётя Wi-Fi", avatar: "🧙‍♀️" },
  { id: "bot3" as const, name: "Дедлайн", avatar: "👻" },
];
const DECK: CardView[] = MEME_DECK.map((card, index) => ({ ...card, id: index + 1 }));
const PROMPTS: CardView[] = SITUATION_DECK.map((card, index) => ({
  ...card,
  id: index + 1,
  emoji: "🎴",
}));
const MATCH_KEY = "membattle:practice:match";
const PROFILE_KEY = "membattle:profile";
const matchListeners = new Set<() => void>();
const profileListeners = new Set<() => void>();

function subscribeMatch(listener: () => void) {
  matchListeners.add(listener);
  return () => matchListeners.delete(listener);
}

function subscribeProfile(listener: () => void) {
  if (typeof window === "undefined") return () => {};
  profileListeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === PROFILE_KEY || event.key === null) listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    profileListeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

function getMatchSnapshot() {
  if (typeof window === "undefined") return "";
  try {
    return window.sessionStorage.getItem(MATCH_KEY) ?? "";
  } catch {
    return "";
  }
}

function getProfileSnapshot() {
  if (typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem(PROFILE_KEY) ?? "";
  } catch {
    return "";
  }
}

function getEmptySnapshot() {
  return "";
}

function parseMatch(raw: string): PracticeMatch | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as PracticeMatch;
    return value &&
      Array.isArray(value.players) &&
      Array.isArray(value.plays) &&
      Array.isArray(value.winnerPlayIds) &&
      value.votes &&
      value.hands
      ? value
      : null;
  } catch {
    return null;
  }
}

function parseProfile(raw: string): { name?: string; avatar?: string } {
  if (!raw) return {};
  try {
    return JSON.parse(raw) as { name?: string; avatar?: string };
  } catch {
    return {};
  }
}

function saveMatch(match: PracticeMatch | null) {
  if (typeof window !== "undefined") {
    try {
      if (match) window.sessionStorage.setItem(MATCH_KEY, JSON.stringify(match));
      else window.sessionStorage.removeItem(MATCH_KEY);
    } catch {
      // Хранение локального прогресса не обязательно для игрового цикла.
    }
  }
  matchListeners.forEach((listener) => listener());
}

function shuffled<T>(items: T[]): T[] {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index--) {
    const next = Math.floor(Math.random() * (index + 1));
    [result[index], result[next]] = [result[next], result[index]];
  }
  return result;
}

function drawHand(current: CardView[] = []): CardView[] {
  const unique = new Map(current.map((card) => [card.id, card]));
  const missing = Math.max(0, HAND_SIZE - unique.size);
  const excluded = new Set(unique.keys());
  const extra = shuffled(DECK.filter((card) => !excluded.has(card.id))).slice(0, missing);
  return [...unique.values(), ...extra];
}

function dealBotCard(
  match: Pick<PracticeMatch, "hands" | "situation" | "round">,
  playerId: PlayerId,
  usedCardIds: Set<number> = new Set(),
): { play: PracticePlay; hand: CardView[] } {
  const hand = match.hands[playerId];
  const botName = BOT_NAMES.find((b) => b.id === playerId)?.name;
  const availableInHand = hand.filter((c) => !usedCardIds.has(c.id));
  const candidateHand = availableInHand.length > 0 ? availableInHand : hand;

  let card = pickBestCardForBot(candidateHand, match.situation, botName);

  // Если на руках у бота не оказалось подходящей по смыслу карты,
  // бот добирает осмысленную карту из колоды (не дублируя руку игрока и стол).
  if (scoreMemeForSituation(card, match.situation, botName) < 35) {
    const humanIds = new Set(match.hands.you.map((c) => c.id));
    const pool = DECK.filter((c) => !usedCardIds.has(c.id) && !humanIds.has(c.id));
    if (pool.length > 0) {
      const topFromDeck = pool
        .map((c) => ({ c, s: scoreMemeForSituation(c, match.situation, botName) }))
        .sort((a, b) => b.s - a.s)
        .slice(0, 3);
      card = topFromDeck[Math.floor(Math.random() * topFromDeck.length)].c;
    }
  }

  usedCardIds.add(card.id);
  const nextHand = hand.some((item) => item.id === card.id)
    ? hand.filter((item) => item.id !== card.id)
    : hand.slice(1);

  return {
    play: { id: `${match.round}-${playerId}`, playerId, card },
    hand: nextHand,
  };
}

/** Все участники выкладывают карты в начале раунда. */
function dealEveryone(match: PracticeMatch, humanCard: CardView): PracticeMatch {
  const hands = { ...match.hands, you: match.hands.you.filter((c) => c.id !== humanCard.id) };
  const plays: PracticePlay[] = [
    { id: `${match.round}-you`, playerId: HUMAN_ID, card: humanCard },
  ];
  const usedCardIds = new Set<number>([humanCard.id]);
  for (const player of match.players) {
    if (!player.isBot) continue;
    const dealt = dealBotCard({ ...match, hands }, player.id, usedCardIds);
    hands[player.id] = dealt.hand;
    plays.push(dealt.play);
  }
  return { ...match, hands, plays: shuffled(plays), phase: "voting", votes: {} };
}

/** Боты голосуют за лучший чужой мем. */
function collectBotVotes(match: PracticeMatch): Record<string, string> {
  const votes: Record<string, string> = { ...match.votes };
  for (const player of match.players) {
    if (!player.isBot || votes[player.id]) continue;
    const options = match.plays.filter((play) => play.playerId !== player.id);
    if (options.length === 0) continue;
    const choice = pickBestPlayForBotJudge(options, match.situation, player.name);
    votes[player.id] = choice.id;
  }
  return votes;
}

/** Подводит итоги: побеждают карты с максимумом голосов. */
function tallyRound(match: PracticeMatch): PracticeMatch {
  const counts = new Map<string, number>();
  for (const play of match.plays) counts.set(play.id, 0);
  for (const playId of Object.values(match.votes)) {
    if (counts.has(playId)) counts.set(playId, (counts.get(playId) ?? 0) + 1);
  }

  const best = counts.size > 0 ? Math.max(...counts.values()) : 0;
  const winnerPlayIds =
    best > 0
      ? match.plays.filter((play) => (counts.get(play.id) ?? 0) === best).map((p) => p.id)
      : [];
  const winnerPlayerIds = new Set(
    match.plays.filter((play) => winnerPlayIds.includes(play.id)).map((p) => p.playerId),
  );

  return {
    ...match,
    phase: "reveal",
    winnerPlayIds,
    players: match.players.map((player) =>
      winnerPlayerIds.has(player.id) ? { ...player, score: player.score + 1 } : player,
    ),
  };
}

function createMatch(name: string, avatar: string): PracticeMatch {
  const players: Participant[] = [
    { id: HUMAN_ID, name: name.trim() || "Ты", avatar, score: 0, isBot: false },
    ...BOT_NAMES.map((bot) => ({ ...bot, score: 0, isBot: true })),
  ];
  const hands: Record<PlayerId, CardView[]> = {
    you: drawHand(),
    bot1: drawHand(),
    bot2: drawHand(),
    bot3: drawHand(),
  };
  return {
    players,
    hands,
    targetScore: TARGET_SCORE,
    round: 1,
    situation: shuffled(PROMPTS)[0],
    phase: "playing",
    plays: [],
    votes: {},
    winnerPlayIds: [],
  };
}

function startNextRound(match: PracticeMatch): PracticeMatch {
  const round = match.round + 1;
  const hands = { ...match.hands };
  for (const player of match.players) hands[player.id] = drawHand(hands[player.id]);

  const situation =
    shuffled(PROMPTS.filter((prompt) => prompt.id !== match.situation.id))[0] ?? PROMPTS[0];
  return {
    ...match,
    round,
    phase: "playing",
    hands,
    situation,
    plays: [],
    votes: {},
    winnerPlayIds: [],
  };
}

function Emoji({ value, size = 42 }: { value: string; size?: number }) {
  return (
    <span
      className="inline-grid shrink-0 place-items-center rounded-full border border-white/15 bg-white/10"
      style={{ width: size, height: size, fontSize: size * 0.56 }}
    >
      {value}
    </span>
  );
}

export function PracticeGame() {
  const matchSnapshot = useSyncExternalStore(subscribeMatch, getMatchSnapshot, getEmptySnapshot);
  const profileSnapshot = useSyncExternalStore(subscribeProfile, getProfileSnapshot, getEmptySnapshot);
  const match = useMemo(() => parseMatch(matchSnapshot), [matchSnapshot]);
  const profile = useMemo(() => parseProfile(profileSnapshot), [profileSnapshot]);
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const [avatarDraft, setAvatarDraft] = useState<string | null>(null);
  const [selectedCard, setSelectedCard] = useState<number | null>(null);
  const playerName = nameDraft ?? profile.name ?? "";
  const playerAvatar =
    avatarDraft ?? (profile.avatar && AVATARS.includes(profile.avatar) ? profile.avatar : AVATARS[0]);

  const setMatch = useCallback<Dispatch<SetStateAction<PracticeMatch | null>>>((action) => {
    const current = parseMatch(getMatchSnapshot());
    const next = typeof action === "function" ? action(current) : action;
    saveMatch(next);
  }, []);

  // Боты досчитывают голоса с небольшой паузой, чтобы было видно процесс.
  // Как только голоса подведены, играет победный аккорд раунда.
  useEffect(() => {
    if (!match || match.phase !== "counting") return;
    const timer = window.setTimeout(() => {
      sfx.roundWin();
      setMatch((current) => {
        if (!current || current.phase !== "counting") return current;
        return tallyRound({ ...current, votes: collectBotVotes(current) });
      });
    }, 1200);
    return () => window.clearTimeout(timer);
  }, [match, setMatch]);

  function begin() {
    const cleanName = playerName.trim().slice(0, 24) || "Ты";
    setNameDraft(cleanName);
    try {
      localStorage.setItem(PROFILE_KEY, JSON.stringify({ name: cleanName, avatar: playerAvatar }));
    } catch {
      // Игра всё равно запускается без сохранения профиля.
    }
    setSelectedCard(null);
    sfx.roundStart();
    setMatch(createMatch(cleanName, playerAvatar));
  }

  function submitCard() {
    if (selectedCard === null) return;
    setMatch((current) => {
      if (!current || current.phase !== "playing") return current;
      const chosen = current.hands.you.find((card) => card.id === selectedCard);
      if (!chosen) return current;
      sfx.play();
      return dealEveryone(current, chosen);
    });
    setSelectedCard(null);
  }

  function voteFor(playId: string) {
    setMatch((current) => {
      if (!current || current.phase !== "voting") return current;
      const target = current.plays.find((play) => play.id === playId);
      if (!target || target.playerId === HUMAN_ID) return current;
      sfx.vote();
      return {
        ...current,
        votes: { ...current.votes, [HUMAN_ID]: playId },
        phase: "counting",
      };
    });
  }

  function continueMatch() {
    setMatch((current) => {
      if (!current) return current;
      if (current.players.some((player) => player.score >= current.targetScore)) {
        sfx.fanfare();
        return { ...current, phase: "finished" };
      }
      sfx.roundStart();
      return startNextRound(current);
    });
    setSelectedCard(null);
  }

  function restart() {
    begin();
  }

  function leaveMatch() {
    setSelectedCard(null);
    setMatch(null);
  }

  const ranking = useMemo(
    () =>
      match
        ? [...match.players].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
        : [],
    [match],
  );

  if (!match) {
    return (
      <PracticeShell>
        <div className="mx-auto grid w-full max-w-6xl gap-8 px-4 pb-16 pt-6 lg:grid-cols-[1fr_0.9fr] lg:pt-12">
          <div className="flex flex-col justify-center">
            <div className="mb-4">
              <Link
                href="/"
                className="inline-flex items-center gap-2 rounded-xl border border-white/15 bg-white/5 px-3.5 py-2 text-xs font-extrabold uppercase tracking-wider text-violet-200 transition hover:border-hot hover:bg-hot/10 hover:text-white"
              >
                <span>←</span> Назад на главную
              </Link>
            </div>
            <Pill tone="hot">⚡ Быстрый матч · умные боты</Pill>
            <h1 className="mt-5 text-4xl font-black leading-[1.02] sm:text-6xl">
              Проверь, <span className="shine-text">кто здесь главный мемолог</span>
            </h1>
            <p className="mt-5 max-w-xl text-base leading-relaxed text-violet-100/75">
              Все выкладывают карту, а потом голосуют за лучшую. Судьи нет — побеждает мем,
              набравший больше всего голосов. Первый до 3 очков забирает партию.
            </p>
            <div className="mt-8 grid max-w-xl gap-3 sm:grid-cols-3">
              {[
                ["🎴", "7 карт", "выбор каждый ход"],
                ["🗳️", "Голосование", "решает большинство"],
                ["🏆", "3 очка", "до победы"],
              ].map(([icon, title, body]) => (
                <div key={title} className="glass rounded-2xl p-4">
                  <div className="text-2xl">{icon}</div>
                  <div className="mt-2 text-sm font-black">{title}</div>
                  <div className="mt-1 text-[10px] uppercase tracking-wider text-violet-300/55">{body}</div>
                </div>
              ))}
            </div>
          </div>

          <section className="glass rounded-[32px] p-6 shadow-[0_30px_80px_rgba(0,0,0,.45)] sm:p-8">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <span className="text-3xl">🎮</span>
                <div>
                  <h2 className="text-xl font-black">Сесть за стол</h2>
                  <p className="text-xs text-violet-300/60">Матч начнётся сразу после старта</p>
                </div>
              </div>
              <Link
                href="/"
                className="rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-xs font-bold text-violet-200 transition hover:border-white/35 hover:text-white"
              >
                ← Назад
              </Link>
            </div>
            <label className="mt-6 block">
              <span className="mb-2 block text-[11px] font-bold uppercase tracking-[0.17em] text-violet-300/70">Ваше имя</span>
              <input
                value={playerName}
                maxLength={24}
                onChange={(event) => setNameDraft(event.target.value)}
                placeholder="Например, Мемный лорд"
                className="w-full rounded-2xl border border-white/15 bg-black/30 px-4 py-3.5 font-semibold text-white placeholder:text-violet-300/40 focus:border-hot focus:outline-none focus:ring-2 focus:ring-hot/40"
              />
            </label>
            <div className="mb-6 mt-5">
              <span className="mb-2 block text-[11px] font-bold uppercase tracking-[0.17em] text-violet-300/70">Ваш аватар</span>
              <div className="flex flex-wrap gap-2">
                {AVATARS.map((avatar) => (
                  <button
                    key={avatar}
                    type="button"
                    onClick={() => setAvatarDraft(avatar)}
                    className={`grid h-10 w-10 place-items-center rounded-xl border text-xl transition ${
                      playerAvatar === avatar
                        ? "border-hot bg-hot/20 shadow-[0_0_0_3px_rgba(255,46,136,.32)]"
                        : "border-white/10 bg-white/5 hover:border-white/30"
                    }`}
                  >
                    {avatar}
                  </button>
                ))}
              </div>
            </div>
            <Button full onClick={begin}>
              Начать быстрый матч →
            </Button>
            <p className="mt-3 text-center text-xs text-violet-300/55">Прогресс матча сохраняется в этой вкладке</p>
          </section>
        </div>
      </PracticeShell>
    );
  }

  if (match.phase === "finished") {
    const champion = ranking[0];
    return (
      <PracticeShell onLeaveMatch={leaveMatch}>
        <div className="mx-auto w-full max-w-3xl px-4 pb-16 pt-8">
          <section className="glass rounded-[32px] p-7 text-center sm:p-12">
            <div className="animate-wiggle text-7xl">🏆</div>
            <p className="mt-5 text-[11px] font-bold uppercase tracking-[0.24em] text-violet-300/65">матч завершён</p>
            <h1 className="mt-2 text-4xl font-black sm:text-5xl">
              <span className="shine-text">{champion?.name ?? "—"}</span>
            </h1>
            <p className="mt-2 text-sm text-violet-200/70">
              {champion?.id === HUMAN_ID
                ? "Ты победил — мемолог года официально найден."
                : "Боты оказались настойчивее. Реванш?"}
            </p>
            <Scoreboard players={ranking} humanId={HUMAN_ID} />
            <div className="mx-auto mt-8 flex max-w-md flex-col gap-3">
              <Button full onClick={restart}>Сыграть ещё раз</Button>
              <Link
                href="/"
                className="rounded-2xl border border-white/15 bg-white/5 px-6 py-3.5 text-center text-sm font-extrabold uppercase tracking-wider text-violet-100 transition hover:border-white/40 hover:bg-white/10"
              >
                ← Назад на главную
              </Link>
            </div>
          </section>
        </div>
      </PracticeShell>
    );
  }

  const canSubmit = match.phase === "playing";
  const voteCounts = new Map<string, number>();
  for (const play of match.plays) voteCounts.set(play.id, 0);
  for (const playId of Object.values(match.votes)) {
    if (voteCounts.has(playId)) voteCounts.set(playId, (voteCounts.get(playId) ?? 0) + 1);
  }
  const winnerPlays = match.plays.filter((play) => match.winnerPlayIds.includes(play.id));
  const humanWon = winnerPlays.some((play) => play.playerId === HUMAN_ID);
  const myVote = match.votes[HUMAN_ID];

  return (
    <PracticeShell round={match.round} onLeaveMatch={leaveMatch}>
      <div className={`mx-auto w-full max-w-6xl px-4 pt-5 ${canSubmit ? "pb-[255px]" : "pb-12"}`}>
        <Scoreboard players={ranking} humanId={HUMAN_ID} />

        <div className="mx-auto mt-5 max-w-4xl">
          <SituationCard card={match.situation} round={match.round} />
        </div>

        <div className="mx-auto mt-4 flex flex-wrap items-center justify-center gap-2">
          {match.phase === "playing" && <Pill tone="aqua">Ваш ход — сыграйте карту</Pill>}
          {match.phase === "voting" && <Pill tone="hot">🗳️ Голосуйте за лучший мем</Pill>}
          {match.phase === "counting" && <Pill tone="violet">Считаем голоса…</Pill>}
          {match.phase === "reveal" && <Pill tone="gold">🏆 Итоги раунда</Pill>}
        </div>

        {match.phase === "playing" && (
          <section className="glass mx-auto mt-5 max-w-3xl rounded-3xl p-5 text-center sm:p-6">
            <div className="text-3xl">🃏</div>
            <h1 className="mt-2 text-xl font-black">Какая карта лучше подходит?</h1>
            <p className="mt-1 text-sm text-violet-200/70">
              Карту выкладывают все за столом. Затем каждый проголосует за лучший чужой мем.
            </p>
          </section>
        )}

        {match.phase === "voting" && (
          <section className="glass mx-auto mt-5 max-w-3xl rounded-3xl p-5 text-center sm:p-6">
            <div className="text-3xl">🗳️</div>
            <h1 className="mt-2 text-xl font-black">Выберите самый смешной ответ</h1>
            <p className="mt-1 text-sm text-violet-200/70">
              За свою карту голосовать нельзя — она подсвечена и недоступна.
            </p>
          </section>
        )}

        {match.phase === "counting" && (
          <section className="glass mx-auto mt-5 max-w-3xl rounded-3xl p-5 text-center sm:p-6">
            <div className="text-3xl">🤔</div>
            <h1 className="mt-2 text-xl font-black">Боты отдают свои голоса…</h1>
            <div className="mt-4 flex justify-center"><Spinner label="Идёт голосование" /></div>
          </section>
        )}

        {match.phase === "reveal" && (
          <section className="glass mx-auto mt-5 max-w-3xl rounded-3xl p-5 text-center sm:p-6">
            <div className="text-3xl">{humanWon ? "🎉" : "🏆"}</div>
            <h1 className="mt-2 text-2xl font-black">
              {winnerPlays.length === 0
                ? "Голосов не было"
                : winnerPlays.length > 1
                  ? "Ничья — очко каждому!"
                  : humanWon
                    ? "Твой мем набрал больше голосов!"
                    : `${match.players.find((p) => p.id === winnerPlays[0].playerId)?.name} забирает очко!`}
            </h1>
            {winnerPlays.length > 0 && (
              <p className="mt-1 text-sm text-violet-200/70">
                {winnerPlays.map((play) => `${play.card.emoji} ${play.card.text}`).join(" · ")}
              </p>
            )}
            {winnerPlays.length > 0 && !humanWon && (
              <p className="mb-4 mt-2 text-xs italic text-amber-200/80">
                «{explainBotChoice(winnerPlays[0].card, match.situation)}»
              </p>
            )}
            <div className="mt-4">
              <Button onClick={continueMatch}>
                {match.players.some((player) => player.score >= match.targetScore)
                  ? "К итогам матча →"
                  : "Следующая ситуация →"}
              </Button>
            </div>
          </section>
        )}

        {(match.phase === "voting" || match.phase === "counting" || match.phase === "reveal") && (
          <div className="mt-8">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-[11px] font-bold uppercase tracking-[0.2em] text-violet-300/70">
                {match.phase === "reveal" ? "Результаты голосования" : "Карты на столе"}
              </h2>
              <Pill tone={match.phase === "reveal" ? "gold" : "violet"}>{match.plays.length} карты</Pill>
            </div>
            <div className="mt-4 flex flex-wrap items-start justify-center gap-4 sm:gap-6">
              {match.plays.map((play, index) => {
                const owner = match.players.find((player) => player.id === play.playerId);
                const isWinner = match.winnerPlayIds.includes(play.id);
                const isMine = play.playerId === HUMAN_ID;
                const canVote = match.phase === "voting" && !isMine && !myVote;
                return (
                  <div
                    key={play.id}
                    className={`animate-rise ${match.phase === "reveal" && !isWinner ? "opacity-60" : ""}`}
                    style={{ animationDelay: `${index * 80}ms` }}
                  >
                    <MemeCard
                      card={play.card}
                      size="md"
                      tilt={((index % 3) - 1) * 1.5}
                      accent={isWinner || myVote === play.id}
                      selected={myVote === play.id}
                      disabled={isMine && match.phase === "voting"}
                      label={match.phase === "reveal" ? owner?.name : undefined}
                      onClick={canVote ? () => voteFor(play.id) : undefined}
                    />
                    <p className="mt-2 text-center text-[10px] font-bold uppercase tracking-wider text-violet-300/60">
                      {match.phase === "reveal"
                        ? `${voteCounts.get(play.id) ?? 0} голос(ов)`
                        : isMine
                          ? "ваша карта"
                          : myVote === play.id
                            ? "✓ ваш голос"
                            : myVote
                              ? "голос отдан"
                              : "голосовать"}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {canSubmit && (
          <div className="fixed inset-x-0 bottom-0 z-30 border-t border-white/10 bg-[#090610]/95 pb-[max(0.8rem,env(safe-area-inset-bottom))] pt-3 shadow-[0_-20px_60px_rgba(0,0,0,.55)] backdrop-blur-xl">
            <div className="mx-auto max-w-6xl px-4">
              <div className="mb-2 flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-[11px] font-bold uppercase tracking-[0.2em] text-violet-300/70">
                    Твоя рука · {match.hands.you.length} карт
                  </h2>
                  <p className="mt-1 text-[10px] text-violet-300/55">Выбери карту и отправь её на стол</p>
                </div>
                <Button disabled={selectedCard === null} onClick={submitCard}>
                  Выложить мем →
                </Button>
              </div>
              <div className="no-scrollbar flex gap-3 overflow-x-auto pb-1">
                {match.hands.you.map((card, index) => (
                  <div key={card.id} className="shrink-0">
                    <MemeCard
                      card={card}
                      size="sm"
                      selected={selectedCard === card.id}
                      tilt={(index % 2 === 0 ? 1 : -1) * 1.2}
                      onClick={() => {
                        sfx.select();
                        setSelectedCard((selected) => (selected === card.id ? null : card.id));
                      }}
                    />
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </PracticeShell>
  );
}

function Scoreboard({
  players,
  humanId,
}: {
  players: Participant[];
  humanId: PlayerId;
}) {
  return (
    <section className="glass mx-auto flex max-w-4xl flex-wrap items-center justify-center gap-2 rounded-3xl p-3 sm:gap-3 sm:p-4">
      {players.map((player) => (
        <div
          key={player.id}
          className={`flex min-w-[145px] flex-1 items-center gap-2 rounded-2xl border px-3 py-2 ${
            player.id === humanId ? "border-hot/40 bg-hot/10" : "border-white/10 bg-black/10"
          }`}
        >
          <Emoji value={player.avatar} size={36} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-xs font-bold">
              {player.name}
              {player.id === humanId ? " · ты" : ""}
            </div>
            <div className="mt-0.5 text-[9px] uppercase tracking-wider text-violet-300/55">
              {player.isBot ? "соперник" : "игрок"}
            </div>
          </div>
          <span className="text-lg font-black text-amber-200">{player.score}</span>
        </div>
      ))}
      <span className="w-full text-center text-[9px] font-bold uppercase tracking-[0.2em] text-violet-300/45">
        Первый до {TARGET_SCORE} очков
      </span>
    </section>
  );
}

function PracticeShell({
  children,
  round,
  onLeaveMatch,
}: {
  children: ReactNode;
  round?: number;
  onLeaveMatch?: () => void;
}) {
  return (
    <>
      <div className="nebula" aria-hidden />
      <div className="nebula-grid" aria-hidden />
      <header className="sticky top-0 z-40 border-b border-white/10 bg-void/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3">
          <Link
            href="/"
            className="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-xs font-extrabold uppercase tracking-wider text-violet-100 transition hover:border-hot hover:bg-hot/10 hover:text-white"
          >
            <span>←</span> Назад
          </Link>
          <Link href="/" className="hidden shrink-0 items-center gap-2 sm:flex">
            <span className="text-2xl">🎭</span>
            <span className="shine-text text-lg font-black">МЕМ-БАТЛ</span>
          </Link>
          <Pill tone="aqua">Быстрая игра · боты</Pill>
          {round && <Pill tone="violet">Раунд {round}</Pill>}
          <div className="ml-auto flex items-center gap-2">
            <SoundToggle />
            {onLeaveMatch && (
              <button
                type="button"
                onClick={onLeaveMatch}
                className="rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-violet-200 transition hover:border-amber-400/60 hover:text-amber-200"
              >
                Заново
              </button>
            )}
            <Link
              href="/"
              className="rounded-xl border border-white/15 px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-violet-200 transition hover:border-hot hover:text-hot"
            >
              С друзьями
            </Link>
          </div>
        </div>
      </header>
      <main className="relative">{children}</main>
    </>
  );
}
