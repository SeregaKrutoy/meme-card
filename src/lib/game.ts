import { randomBytes } from "node:crypto";
import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  handCards,
  memeCards,
  players,
  plays,
  rooms,
  rounds,
  roundReady,
  situationCards,
  votes,
  type Player,
  type Room,
} from "@/db/schema";
import { pickBestCardForBot, pickBestPlayForBotJudge, scoreMemeForSituation } from "./bot-ai";
import {
  AVATARS,
  BOT_PLAY_DELAY_SECONDS,
  BOT_VOTE_DELAY_SECONDS,
  BOT_PROFILES,
  HAND_SIZE,
  MEME_DECK,
  MIN_PARTICIPANTS,
  SITUATION_DECK,
  TIMER_LIMITS,
} from "./cards";
import type {
  CardView,
  CustomCardView,
  JoinResult,
  PlayView,
  PlayerView,
  RoomState,
  SelfView,
  WinnerView,
} from "./types";

export const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const MAX_PLAYERS = 8;

export class GameError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
    this.name = "GameError";
  }
}

/* ------------------------------------------------------------------ */
/* утилиты                                                             */
/* ------------------------------------------------------------------ */

function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function normalizeCode(raw: string): string {
  return raw.trim().toUpperCase();
}

function makeToken(): string {
  return randomBytes(18).toString("hex");
}

function safeAvatar(value: string): string {
  return AVATARS.includes(value) ? value : AVATARS[0];
}

function clampTimer(value: number, bounds: { min: number; max: number }): number {
  if (!Number.isFinite(value)) return bounds.min;
  return Math.min(bounds.max, Math.max(bounds.min, Math.round(value)));
}

let cardsReady: Promise<void> | null = null;

/** Заливает базовую колоду в БД при первом обращении. */
export function ensureCards(): Promise<void> {
  if (!cardsReady) {
    cardsReady = (async () => {
      const [m] = await db
        .select({ c: sql<number>`count(*)::int` })
        .from(memeCards)
        .where(isNull(memeCards.roomId));
      const [s] = await db
        .select({ c: sql<number>`count(*)::int` })
        .from(situationCards)
        .where(isNull(situationCards.roomId));
      if (!m || m.c === 0) await db.insert(memeCards).values(MEME_DECK);
      if (!s || s.c === 0) await db.insert(situationCards).values(SITUATION_DECK);
    })().catch((err) => {
      cardsReady = null;
      throw err;
    });
  }
  return cardsReady;
}

type CardIndex = {
  memes: Map<number, CardView>;
  situations: Map<number, CardView>;
};
let cardCache: Promise<CardIndex> | null = null;

function invalidateCardCache(): void {
  cardCache = null;
}

function loadCards(): Promise<CardIndex> {
  if (!cardCache) {
    cardCache = (async () => {
      const memes = await db.select().from(memeCards);
      const situations = await db.select().from(situationCards);
      return {
        memes: new Map(
          memes.map((m) => [
            m.id,
            { id: m.id, emoji: m.emoji, text: m.text, category: m.category },
          ]),
        ),
        situations: new Map(
          situations.map((s) => [
            s.id,
            { id: s.id, emoji: "🎴", text: s.text, category: s.category },
          ]),
        ),
      };
    })();
  }
  return cardCache;
}

async function loadRoom(code: string): Promise<Room | null> {
  const [room] = await db.select().from(rooms).where(eq(rooms.code, code)).limit(1);
  return room ?? null;
}

export async function loadRoomByCode(rawCode: string): Promise<Room | null> {
  return loadRoom(normalizeCode(rawCode));
}

function getRoomPlayers(roomId: number): Promise<Player[]> {
  return db.select().from(players).where(eq(players.roomId, roomId)).orderBy(players.id);
}

function getRoundPlays(roomId: number, round: number) {
  return db
    .select()
    .from(plays)
    .where(and(eq(plays.roomId, roomId), eq(plays.round, round)))
    .orderBy(plays.id);
}

function getRoundVotes(roomId: number, round: number) {
  return db
    .select()
    .from(votes)
    .where(and(eq(votes.roomId, roomId), eq(votes.round, round)));
}

function getRoundReady(roomId: number, round: number) {
  return db
    .select()
    .from(roundReady)
    .where(and(eq(roundReady.roomId, roomId), eq(roundReady.round, round)));
}

async function authenticate(
  room: Room,
  playerId: number | null,
  token: string | null,
): Promise<Player | null> {
  if (!playerId || !token) return null;
  const [player] = await db
    .select()
    .from(players)
    .where(and(eq(players.id, playerId), eq(players.roomId, room.id)))
    .limit(1);
  if (!player || player.isBot || player.token !== token) return null;
  return player;
}

export async function requireActor(
  room: Room,
  playerId: number | null,
  token: string | null,
): Promise<Player> {
  const actor = await authenticate(room, playerId, token);
  if (!actor) throw new GameError("Сессия устарела, обновите страницу", 401);
  return actor;
}

export async function requireHost(
  room: Room,
  playerId: number | null,
  token: string | null,
): Promise<Player> {
  const actor = await requireActor(room, playerId, token);
  if (!actor.isHost) throw new GameError("Это может сделать только хост");
  return actor;
}

/* ------------------------------------------------------------------ */
/* создание / вход                                                     */
/* ------------------------------------------------------------------ */

async function generateCode(): Promise<string> {
  for (let attempt = 0; attempt < 12; attempt++) {
    let code = "";
    for (let i = 0; i < 4; i++) {
      code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
    }
    const [existing] = await db
      .select({ id: rooms.id })
      .from(rooms)
      .where(eq(rooms.code, code))
      .limit(1);
    if (!existing) return code;
  }
  throw new GameError("Не удалось подобрать код комнаты, попробуйте ещё раз", 500);
}

export async function createRoom(
  hostName: string,
  hostAvatar: string,
  targetScore: number,
): Promise<JoinResult> {
  await ensureCards();
  const name = hostName.trim().slice(0, 24);
  if (!name) throw new GameError("Введите имя");
  const winningScore = [3, 5, 7, 10].includes(targetScore) ? targetScore : 5;

  const code = await generateCode();
  const token = makeToken();
  const [room] = await db
    .insert(rooms)
    .values({ code, targetScore: winningScore })
    .returning({ id: rooms.id });

  const [player] = await db
    .insert(players)
    .values({
      roomId: room.id,
      name,
      avatar: safeAvatar(hostAvatar),
      isHost: true,
      token,
    })
    .returning({ id: players.id });

  return { code, playerId: player.id, token };
}

export async function joinRoom(
  rawCode: string,
  name: string,
  avatar: string,
): Promise<JoinResult> {
  await ensureCards();
  const room = await loadRoom(normalizeCode(rawCode));
  if (!room) throw new GameError("Комната не найдена. Проверьте код.");
  if (room.status === "finished") throw new GameError("Эта партия уже завершена");

  const current = await getRoomPlayers(room.id);
  if (current.length >= MAX_PLAYERS) {
    throw new GameError(`За столом уже максимум игроков (${MAX_PLAYERS})`);
  }

  const cleanName = name.trim().slice(0, 24);
  if (!cleanName) throw new GameError("Введите имя");
  if (current.some((p) => p.name.toLowerCase() === cleanName.toLowerCase())) {
    throw new GameError("Такое имя уже занято в этой комнате");
  }

  const token = makeToken();
  const [player] = await db
    .insert(players)
    .values({
      roomId: room.id,
      name: cleanName,
      avatar: safeAvatar(avatar),
      token,
    })
    .returning({ id: players.id });

  if (room.status === "playing") await topUpHand(room.id, player.id);
  return { code: room.code, playerId: player.id, token };
}

async function insertBot(roomId: number, taken: string[]): Promise<void> {
  const used = new Set(taken.map((name) => name.toLowerCase()));
  const profile =
    BOT_PROFILES.find((p) => !used.has(p.name.toLowerCase())) ??
    { name: `Бот ${taken.length + 1}`, avatar: "🤖" };
  await db.insert(players).values({
    roomId,
    name: profile.name,
    avatar: profile.avatar,
    token: makeToken(),
    isBot: true,
  });
}

export async function addBot(
  room: Room,
  playerId: number | null,
  token: string | null,
): Promise<void> {
  await requireHost(room, playerId, token);
  if (room.status !== "lobby") throw new GameError("Добавить бота можно только до старта");
  const roster = await getRoomPlayers(room.id);
  if (roster.length >= MAX_PLAYERS) {
    throw new GameError(`За столом уже ${MAX_PLAYERS} участников`);
  }
  await insertBot(room.id, roster.map((p) => p.name));
}

export async function removeParticipant(
  room: Room,
  playerId: number | null,
  token: string | null,
  targetId: number,
): Promise<void> {
  const host = await requireHost(room, playerId, token);
  const roster = await getRoomPlayers(room.id);
  const target = roster.find((p) => p.id === targetId);
  if (!target) throw new GameError("Участник не найден", 404);
  if (!target.isBot) throw new GameError("Убрать со стола можно только бота");
  if (host.id === target.id) throw new GameError("Нельзя убрать себя");

  await db.delete(plays).where(eq(plays.playerId, target.id));
  await db.delete(votes).where(eq(votes.voterPlayerId, target.id));
  await db.delete(handCards).where(eq(handCards.playerId, target.id));
  await db.delete(players).where(eq(players.id, target.id));
}

/* ------------------------------------------------------------------ */
/* раздача                                                             */
/* ------------------------------------------------------------------ */

async function topUpHand(roomId: number, playerId: number): Promise<void> {
  const held = await db
    .select({ cardId: handCards.cardId })
    .from(handCards)
    .where(and(eq(handCards.roomId, roomId), eq(handCards.playerId, playerId)));
  const heldIds = new Set(held.map((h) => h.cardId));

  const all = await db
    .select({ id: memeCards.id })
    .from(memeCards)
    .where(or(isNull(memeCards.roomId), eq(memeCards.roomId, roomId)));
  let pool = all.map((c) => c.id).filter((id) => !heldIds.has(id));
  if (pool.length === 0) pool = all.map((c) => c.id);
  shuffle(pool);

  const need = HAND_SIZE - heldIds.size;
  if (need <= 0) return;
  const picks = pool.slice(0, need);
  if (picks.length > 0) {
    await db
      .insert(handCards)
      .values(picks.map((cardId) => ({ roomId, playerId, cardId })));
  }
}

async function pickSituationCardId(roomId: number): Promise<number> {
  const used = await db
    .select({ id: rounds.situationCardId })
    .from(rounds)
    .where(eq(rounds.roomId, roomId));
  const usedIds = new Set(used.map((u) => u.id));
  const all = await db
    .select({ id: situationCards.id })
    .from(situationCards)
    .where(or(isNull(situationCards.roomId), eq(situationCards.roomId, roomId)));
  let pool = all.map((c) => c.id).filter((id) => !usedIds.has(id));
  if (pool.length === 0) pool = all.map((c) => c.id);
  shuffle(pool);
  return pool[0];
}

/* ------------------------------------------------------------------ */
/* игровой цикл                                                        */
/* ------------------------------------------------------------------ */

async function startNextRound(room: Room): Promise<Room> {
  const roomPlayers = await getRoomPlayers(room.id);
  const number = room.round + 1;
  const situationCardId = await pickSituationCardId(room.id);

  // Чистим прошлые круги, чтобы таблицы не разрастались.
  await db
    .delete(plays)
    .where(and(eq(plays.roomId, room.id), sql`${plays.round} < ${number}`));
  await db
    .delete(votes)
    .where(and(eq(votes.roomId, room.id), sql`${votes.round} < ${number}`));
  await db
    .delete(roundReady)
    .where(and(eq(roundReady.roomId, room.id), sql`${roundReady.round} < ${number}`));

  await db.insert(rounds).values({ roomId: room.id, number, situationCardId });
  for (const p of roomPlayers) await topUpHand(room.id, p.id);

  const [updated] = await db
    .update(rooms)
    .set({
      status: "playing",
      phase: "submitting",
      round: number,
      situationCardId,
      phaseChangedAt: new Date(),
    })
    .where(eq(rooms.id, room.id))
    .returning();

  return updated;
}

export async function startGame(room: Room, actorId: number): Promise<Room> {
  const [host] = await db
    .select({ isHost: players.isHost })
    .from(players)
    .where(and(eq(players.id, actorId), eq(players.roomId, room.id)))
    .limit(1);
  if (!host?.isHost) throw new GameError("Начать игру может только хост");
  if (room.status !== "lobby") return room;

  let roster = await getRoomPlayers(room.id);
  if (roster.length === 0) throw new GameError("В комнате нет игроков");

  while (roster.length < MIN_PARTICIPANTS) {
    await insertBot(room.id, roster.map((p) => p.name));
    roster = await getRoomPlayers(room.id);
  }

  const [claimed] = await db
    .update(rooms)
    .set({ status: "playing", phase: "transitioning", phaseChangedAt: new Date() })
    .where(and(eq(rooms.id, room.id), eq(rooms.status, "lobby")))
    .returning();
  if (!claimed) return (await loadRoomByCode(room.code)) ?? room;

  await db.delete(plays).where(eq(plays.roomId, room.id));
  await db.delete(votes).where(eq(votes.roomId, room.id));
  await db.delete(roundReady).where(eq(roundReady.roomId, room.id));
  await db.delete(handCards).where(eq(handCards.roomId, room.id));
  await db.delete(rounds).where(eq(rounds.roomId, room.id));
  return startNextRound({ ...claimed, round: 0 });
}

/** Переводит раунд из выкладывания карт в голосование. */
async function openVoting(room: Room): Promise<Room> {
  const [updated] = await db
    .update(rooms)
    .set({ phase: "voting", phaseChangedAt: new Date() })
    .where(
      and(
        eq(rooms.id, room.id),
        eq(rooms.round, room.round),
        eq(rooms.phase, "submitting"),
      ),
    )
    .returning();
  if (!updated) return (await loadRoomByCode(room.code)) ?? room;

  const submitted = await getRoundPlays(updated.id, updated.round);
  // Никто не успел сыграть — раунд закрывается без победителя.
  if (submitted.length === 0) return closeRound(updated);
  return updated;
}

/**
 * Подводит итоги голосования: победители — авторы карт с максимумом голосов.
 * При равенстве очко получают все, кто набрал максимум.
 */
async function closeRound(room: Room): Promise<Room> {
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(rooms)
      .where(eq(rooms.id, room.id))
      .for("update")
      .limit(1);
    if (!current) return room;
    if (
      current.status !== "playing" ||
      current.round !== room.round ||
      (current.phase !== "voting" && current.phase !== "submitting")
    ) {
      return current;
    }

    const roundPlays = await tx
      .select()
      .from(plays)
      .where(and(eq(plays.roomId, current.id), eq(plays.round, current.round)))
      .orderBy(plays.id);
    const roundVotes = await tx
      .select()
      .from(votes)
      .where(and(eq(votes.roomId, current.id), eq(votes.round, current.round)));

    if (roundPlays.length > 0) {
      const tally = new Map<number, number>();
      for (const play of roundPlays) tally.set(play.id, 0);
      for (const vote of roundVotes) {
        if (tally.has(vote.playId)) {
          tally.set(vote.playId, (tally.get(vote.playId) ?? 0) + 1);
        }
      }

      const best = Math.max(...tally.values());
      // Голосов может не быть вовсе — тогда очки никому не начисляются.
      if (best > 0) {
        const winningPlayIds = roundPlays
          .filter((play) => (tally.get(play.id) ?? 0) === best)
          .map((play) => play.id);
        const winnerPlayerIds = [
          ...new Set(
            roundPlays
              .filter((play) => winningPlayIds.includes(play.id))
              .map((play) => play.playerId),
          ),
        ];
        if (winnerPlayerIds.length > 0) {
          await tx
            .update(players)
            .set({ score: sql`${players.score} + 1` })
            .where(inArray(players.id, winnerPlayerIds));
        }
      }
    }

    const [updated] = await tx
      .update(rooms)
      .set({ phase: "reveal", phaseChangedAt: new Date() })
      .where(eq(rooms.id, current.id))
      .returning();
    return updated ?? current;
  });
}

async function advance(room: Room): Promise<Room> {
  if (room.phase !== "reveal") return room;

  const [claimed] = await db
    .update(rooms)
    .set({ phase: "transitioning", phaseChangedAt: new Date() })
    .where(
      and(
        eq(rooms.id, room.id),
        eq(rooms.round, room.round),
        eq(rooms.phase, "reveal"),
      ),
    )
    .returning();
  if (!claimed) return (await loadRoomByCode(room.code)) ?? room;

  const [leader] = await db
    .select({ score: players.score })
    .from(players)
    .where(eq(players.roomId, claimed.id))
    .orderBy(sql`${players.score} desc`)
    .limit(1);

  if (leader && leader.score >= claimed.targetScore) {
    const [finished] = await db
      .update(rooms)
      .set({ status: "finished", phase: "finished", phaseChangedAt: new Date() })
      .where(and(eq(rooms.id, claimed.id), eq(rooms.phase, "transitioning")))
      .returning();
    return finished ?? claimed;
  }
  return startNextRound(claimed);
}

/* ------------------------------------------------------------------ */
/* боты                                                                */
/* ------------------------------------------------------------------ */

/** Боты выкладывают карты, как только истекла пауза на «размышление». */
async function botsTakeTurn(current: Room): Promise<Room> {
  return db.transaction(async (tx) => {
    const [locked] = await tx
      .select()
      .from(rooms)
      .where(eq(rooms.id, current.id))
      .for("update")
      .limit(1);
    if (
      !locked ||
      locked.status !== "playing" ||
      locked.phase !== "submitting" ||
      locked.round !== current.round
    ) {
      return locked ?? current;
    }

    const roster = await tx
      .select()
      .from(players)
      .where(eq(players.roomId, locked.id))
      .orderBy(players.id);
    const existing = await tx
      .select({ playerId: plays.playerId, cardId: plays.cardId })
      .from(plays)
      .where(and(eq(plays.roomId, locked.id), eq(plays.round, locked.round)));
    const playedIds = new Set(existing.map((p) => p.playerId));
    const usedCardIds = new Set(existing.map((p) => p.cardId));

    const { memes, situations } = await loadCards();
    const situation = locked.situationCardId
      ? situations.get(locked.situationCardId) ?? null
      : null;

    let submitted = existing.length;
    for (const bot of roster) {
      if (!bot.isBot || playedIds.has(bot.id)) continue;
      const hand = await tx
        .select({ id: handCards.id, cardId: handCards.cardId })
        .from(handCards)
        .where(and(eq(handCards.roomId, locked.id), eq(handCards.playerId, bot.id)));
      const cards = hand
        .map((h) => memes.get(h.cardId))
        .filter((c): c is CardView => Boolean(c));
      if (cards.length === 0) continue;

      const available = cards.filter((c) => !usedCardIds.has(c.id));
      let pick = pickBestCardForBot(
        available.length > 0 ? available : cards,
        situation,
        bot.name,
      );

      if (scoreMemeForSituation(pick, situation, bot.name) < 35) {
        const allCards = [...memes.values()].filter((c) => !usedCardIds.has(c.id));
        if (allCards.length > 0) {
          const top = allCards
            .map((c) => ({ c, s: scoreMemeForSituation(c, situation, bot.name) }))
            .sort((a, b) => b.s - a.s)
            .slice(0, 3);
          pick = top[Math.floor(Math.random() * top.length)].c;
        }
      }

      usedCardIds.add(pick.id);
      const heldEntry = hand.find((h) => h.cardId === pick.id) ?? hand[0];
      await tx.delete(handCards).where(eq(handCards.id, heldEntry.id));
      await tx.insert(plays).values({
        roomId: locked.id,
        round: locked.round,
        playerId: bot.id,
        cardId: pick.id,
      });
      playedIds.add(bot.id);
      submitted += 1;
    }

    if (roster.length > 0 && submitted >= roster.length) {
      const [updated] = await tx
        .update(rooms)
        .set({ phase: "voting", phaseChangedAt: new Date() })
        .where(and(eq(rooms.id, locked.id), eq(rooms.phase, "submitting")))
        .returning();
      return updated ?? locked;
    }
    return locked;
  });
}

/** Боты голосуют за лучший чужой мем по смыслу ситуации. */
async function botsVote(current: Room): Promise<Room> {
  const roster = await getRoomPlayers(current.id);
  const roundPlays = await getRoundPlays(current.id, current.round);
  if (roundPlays.length === 0) return closeRound(current);

  const existingVotes = await getRoundVotes(current.id, current.round);
  const votedIds = new Set(existingVotes.map((v) => v.voterPlayerId));
  const { memes, situations } = await loadCards();
  const situation = current.situationCardId
    ? situations.get(current.situationCardId) ?? null
    : null;

  for (const bot of roster) {
    if (!bot.isBot || votedIds.has(bot.id)) continue;
    // За свою карту голосовать нельзя.
    const options = roundPlays
      .filter((play) => play.playerId !== bot.id)
      .map((play) => ({ play, card: memes.get(play.cardId) }))
      .filter((entry): entry is { play: (typeof roundPlays)[number]; card: CardView } =>
        Boolean(entry.card),
      );
    if (options.length === 0) continue;

    const choice = pickBestPlayForBotJudge(options, situation, bot.name);
    await db.insert(votes).values({
      roomId: current.id,
      round: current.round,
      voterPlayerId: bot.id,
      playId: choice.play.id,
    });
    votedIds.add(bot.id);
  }

  const eligible = roster.filter((p) =>
    roundPlays.some((play) => play.playerId !== p.id),
  );
  if (eligible.length > 0 && eligible.every((p) => votedIds.has(p.id))) {
    return closeRound(current);
  }
  return current;
}

/**
 * Автопрогрессия запускается не чаще, чем раз в окно для каждой комнаты:
 * N клиентов опрашивают комнату параллельно, и каждый запуск гоняет
 * до трёх запросов к БД. Окно 900 мс почти незаметно игрокам,
 * но снижает лишнюю нагрузку в разы.
 */
const lastAutoProgressAt = new Map<number, number>();
const AUTO_PROGRESS_WINDOW_MS = 900;

function shouldAutoProgress(roomId: number): boolean {
  const now = Date.now();
  const last = lastAutoProgressAt.get(roomId) ?? 0;
  if (now - last < AUTO_PROGRESS_WINDOW_MS) return false;
  if (lastAutoProgressAt.size > 256) {
    for (const [key, value] of lastAutoProgressAt) {
      if (now - value > 5 * 60 * 1000) lastAutoProgressAt.delete(key);
    }
  }
  lastAutoProgressAt.set(roomId, now);
  return true;
}

/** Двигает партию: ходы и голоса ботов, таймеры фаз, готовность игроков. */
async function autoProgress(room: Room): Promise<Room> {
  if (room.status !== "playing") return room;
  const elapsed = (Date.now() - new Date(room.phaseChangedAt).getTime()) / 1000;

  if (room.phase === "submitting") {
    const roster = await getRoomPlayers(room.id);
    const submitted = await getRoundPlays(room.id, room.round);
    const playedIds = new Set(submitted.map((p) => p.playerId));
    const pendingBots = roster.some((p) => p.isBot && !playedIds.has(p.id));

    if (pendingBots && elapsed >= BOT_PLAY_DELAY_SECONDS) return botsTakeTurn(room);
    if (room.timersEnabled && elapsed >= room.submitSeconds) return openVoting(room);
    return room;
  }

  if (room.phase === "voting") {
    const roster = await getRoomPlayers(room.id);
    const roundPlays = await getRoundPlays(room.id, room.round);
    const roundVotes = await getRoundVotes(room.id, room.round);
    const votedIds = new Set(roundVotes.map((v) => v.voterPlayerId));
    const pendingBots = roster.some(
      (p) =>
        p.isBot &&
        !votedIds.has(p.id) &&
        roundPlays.some((play) => play.playerId !== p.id),
    );

    if (pendingBots && elapsed >= BOT_VOTE_DELAY_SECONDS) return botsVote(room);
    if (room.timersEnabled && elapsed >= room.voteSeconds) return closeRound(room);
    return room;
  }

  if (room.phase === "reveal") {
    // Боты всегда «готовы»: ждём только живых игроков.
    const roster = await getRoomPlayers(room.id);
    const humans = roster.filter((p) => !p.isBot);
    const ready = await getRoundReady(room.id, room.round);
    const readyIds = new Set(ready.map((r) => r.playerId));
    const allReady =
      humans.length > 0 && humans.every((p) => readyIds.has(p.id));

    if (allReady) return advance(room);
    if (room.timersEnabled && elapsed >= room.revealSeconds) return advance(room);
    return room;
  }

  return room;
}

/* ------------------------------------------------------------------ */
/* действия игроков                                                    */
/* ------------------------------------------------------------------ */

export async function playCard(
  room: Room,
  actorId: number,
  token: string,
  cardId: number,
): Promise<Room> {
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(rooms)
      .where(eq(rooms.id, room.id))
      .for("update")
      .limit(1);
    if (!current) throw new GameError("Комната уже закрыта", 404);

    const [actor] = await tx
      .select()
      .from(players)
      .where(and(eq(players.id, actorId), eq(players.roomId, current.id)))
      .limit(1);
    if (!actor || actor.isBot || actor.token !== token) {
      throw new GameError("Сессия устарела, обновите страницу", 401);
    }
    if (current.status !== "playing" || current.phase !== "submitting") {
      throw new GameError("Время для выкладывания карт закончилось");
    }

    const [held] = await tx
      .select({ id: handCards.id })
      .from(handCards)
      .where(
        and(
          eq(handCards.roomId, current.id),
          eq(handCards.playerId, actor.id),
          eq(handCards.cardId, cardId),
        ),
      )
      .limit(1);
    if (!held) throw new GameError("Этой карты нет у вас на руках");

    const already = await tx
      .select({ playerId: plays.playerId })
      .from(plays)
      .where(and(eq(plays.roomId, current.id), eq(plays.round, current.round)));
    if (already.some((play) => play.playerId === actor.id)) {
      throw new GameError("Вы уже выложили карту в этом раунде");
    }

    await tx.delete(handCards).where(eq(handCards.id, held.id));
    await tx.insert(plays).values({
      roomId: current.id,
      round: current.round,
      playerId: actor.id,
      cardId,
    });

    const roster = await tx
      .select({ id: players.id })
      .from(players)
      .where(eq(players.roomId, current.id));
    if (already.length + 1 >= roster.length && roster.length > 0) {
      const [updated] = await tx
        .update(rooms)
        .set({ phase: "voting", phaseChangedAt: new Date() })
        .where(and(eq(rooms.id, current.id), eq(rooms.phase, "submitting")))
        .returning();
      return updated ?? current;
    }
    return current;
  });
}

/** Голос игрока за чужую карту. Когда проголосовали все — раунд закрывается. */
export async function voteForPlay(
  room: Room,
  actorId: number | null,
  token: string | null,
  playId: number,
): Promise<Room> {
  const outcome = await db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(rooms)
      .where(eq(rooms.id, room.id))
      .for("update")
      .limit(1);
    if (!current) throw new GameError("Комната уже закрыта", 404);

    const [actor] = await tx
      .select()
      .from(players)
      .where(and(eq(players.id, actorId ?? -1), eq(players.roomId, current.id)))
      .limit(1);
    if (!actor || actor.isBot || actor.token !== token) {
      throw new GameError("Сессия устарела, обновите страницу", 401);
    }
    if (current.status !== "playing" || current.phase !== "voting") {
      throw new GameError("Сейчас не время голосовать");
    }

    const roundPlays = await tx
      .select()
      .from(plays)
      .where(and(eq(plays.roomId, current.id), eq(plays.round, current.round)));
    const target = roundPlays.find((play) => play.id === playId);
    if (!target) throw new GameError("Такой карты в этом раунде нет");
    if (target.playerId === actor.id) {
      throw new GameError("За свою карту голосовать нельзя");
    }

    const existing = await tx
      .select()
      .from(votes)
      .where(and(eq(votes.roomId, current.id), eq(votes.round, current.round)));
    if (existing.some((vote) => vote.voterPlayerId === actor.id)) {
      throw new GameError("Вы уже проголосовали в этом раунде");
    }

    await tx.insert(votes).values({
      roomId: current.id,
      round: current.round,
      voterPlayerId: actor.id,
      playId,
    });

    const roster = await tx
      .select()
      .from(players)
      .where(eq(players.roomId, current.id));
    const votedIds = new Set([...existing.map((v) => v.voterPlayerId), actor.id]);
    const eligible = roster.filter((p) =>
      roundPlays.some((play) => play.playerId !== p.id),
    );
    const everyoneVoted =
      eligible.length > 0 && eligible.every((p) => votedIds.has(p.id));
    return { room: current, everyoneVoted };
  });

  if (outcome.everyoneVoted) return closeRound(outcome.room);
  return outcome.room;
}

/** Отмечает готовность игрока к следующей ситуации. */
export async function markReady(
  room: Room,
  playerId: number | null,
  token: string | null,
): Promise<Room> {
  const actor = await requireActor(room, playerId, token);
  if (room.phase !== "reveal") return room;

  const existing = await getRoundReady(room.id, room.round);
  if (!existing.some((entry) => entry.playerId === actor.id)) {
    await db.insert(roundReady).values({
      roomId: room.id,
      round: room.round,
      playerId: actor.id,
    });
  }

  const roster = await getRoomPlayers(room.id);
  const humans = roster.filter((p) => !p.isBot);
  const readyIds = new Set([
    ...existing.map((entry) => entry.playerId),
    actor.id,
  ]);
  if (humans.length > 0 && humans.every((p) => readyIds.has(p.id))) {
    return advance(room);
  }
  const fresh = await loadRoomByCode(room.code);
  return fresh ?? room;
}

export async function advanceRoom(
  room: Room,
  playerId: number | null,
  token: string | null,
): Promise<Room> {
  return markReady(room, playerId, token);
}

/** Настройки партии: цель по очкам и таймеры фаз. */
export async function updateSettings(
  room: Room,
  playerId: number | null,
  token: string | null,
  payload: {
    targetScore?: number;
    timersEnabled?: boolean;
    submitSeconds?: number;
    voteSeconds?: number;
    revealSeconds?: number;
  },
): Promise<void> {
  const actor = await requireActor(room, playerId, token);
  if (!actor.isHost) throw new GameError("Менять настройки может только хост");
  if (room.status !== "lobby") throw new GameError("Игра уже началась");

  const patch: Partial<typeof rooms.$inferInsert> = {};

  if (payload.targetScore !== undefined) {
    if (![3, 5, 7, 10].includes(payload.targetScore)) {
      throw new GameError("Недопустимое количество очков");
    }
    patch.targetScore = payload.targetScore;
  }
  if (payload.timersEnabled !== undefined) {
    patch.timersEnabled = Boolean(payload.timersEnabled);
  }
  if (payload.submitSeconds !== undefined) {
    patch.submitSeconds = clampTimer(payload.submitSeconds, TIMER_LIMITS.submit);
  }
  if (payload.voteSeconds !== undefined) {
    patch.voteSeconds = clampTimer(payload.voteSeconds, TIMER_LIMITS.vote);
  }
  if (payload.revealSeconds !== undefined) {
    patch.revealSeconds = clampTimer(payload.revealSeconds, TIMER_LIMITS.reveal);
  }
  if (Object.keys(patch).length === 0) return;

  const [updated] = await db
    .update(rooms)
    .set(patch)
    .where(and(eq(rooms.id, room.id), eq(rooms.status, "lobby")))
    .returning({ id: rooms.id });
  if (!updated) throw new GameError("Игра уже началась — настройки заблокированы");
}

function cleanCardText(value: string, max: number): string {
  return value.replace(/\s+/g, " ").trim().slice(0, max);
}

/** Любой участник комнаты может добавить свою карточку без ограничений по количеству. */
export async function addCustomCard(
  room: Room,
  playerId: number | null,
  token: string | null,
  kind: "meme" | "situation",
  payload: { text?: string; emoji?: string },
): Promise<void> {
  const actor = await requireActor(room, playerId, token);
  if (room.status !== "lobby") {
    throw new GameError("Редактировать колоду можно только до старта партии");
  }

  const text = cleanCardText(payload.text ?? "", kind === "meme" ? 96 : 220);
  if (!text) {
    throw new GameError(
      kind === "meme" ? "Введите подпись для мема" : "Введите текст ситуации",
    );
  }

  if (kind === "meme") {
    const emoji = cleanCardText(payload.emoji ?? "", 8) || "🎭";
    await db.insert(memeCards).values({
      roomId: room.id,
      emoji,
      text,
      category: "свой мем",
      isCustom: true,
      createdByPlayerId: actor.id,
    });
  } else {
    await db.insert(situationCards).values({
      roomId: room.id,
      text,
      category: "свой вопрос",
      isCustom: true,
      createdByPlayerId: actor.id,
    });
  }
  invalidateCardCache();
}

/** Свою карточку удаляет автор, любую — хост. */
export async function removeCustomCard(
  room: Room,
  playerId: number | null,
  token: string | null,
  kind: "meme" | "situation",
  cardId: number,
): Promise<void> {
  const actor = await requireActor(room, playerId, token);
  if (room.status !== "lobby") {
    throw new GameError("Редактировать колоду можно только до старта партии");
  }

  if (kind === "meme") {
    const [card] = await db
      .select()
      .from(memeCards)
      .where(
        and(
          eq(memeCards.id, cardId),
          eq(memeCards.roomId, room.id),
          eq(memeCards.isCustom, true),
        ),
      )
      .limit(1);
    if (!card) throw new GameError("Своя мем-карта не найдена", 404);
    if (!actor.isHost && card.createdByPlayerId !== actor.id) {
      throw new GameError("Удалять чужие карточки может только хост", 403);
    }
    await db.delete(memeCards).where(eq(memeCards.id, card.id));
  } else {
    const [card] = await db
      .select()
      .from(situationCards)
      .where(
        and(
          eq(situationCards.id, cardId),
          eq(situationCards.roomId, room.id),
          eq(situationCards.isCustom, true),
        ),
      )
      .limit(1);
    if (!card) throw new GameError("Свой вопрос не найден", 404);
    if (!actor.isHost && card.createdByPlayerId !== actor.id) {
      throw new GameError("Удалять чужие вопросы может только хост", 403);
    }
    await db.delete(situationCards).where(eq(situationCards.id, card.id));
  }
  invalidateCardCache();
}

export async function leaveRoom(
  room: Room,
  actorId: number | null,
  token: string | null,
): Promise<Room | null> {
  const actor = await authenticate(room, actorId, token);
  if (!actor) return room;

  await db.delete(plays).where(eq(plays.playerId, actor.id));
  await db.delete(votes).where(eq(votes.voterPlayerId, actor.id));
  await db.delete(roundReady).where(eq(roundReady.playerId, actor.id));
  await db.delete(handCards).where(eq(handCards.playerId, actor.id));
  await db.delete(players).where(eq(players.id, actor.id));

  const left = await getRoomPlayers(room.id);
  if (left.length === 0) {
    await db.delete(plays).where(eq(plays.roomId, room.id));
    await db.delete(votes).where(eq(votes.roomId, room.id));
    await db.delete(roundReady).where(eq(roundReady.roomId, room.id));
    await db.delete(handCards).where(eq(handCards.roomId, room.id));
    await db.delete(rounds).where(eq(rounds.roomId, room.id));
    await db.delete(memeCards).where(eq(memeCards.roomId, room.id));
    await db.delete(situationCards).where(eq(situationCards.roomId, room.id));
    await db.delete(rooms).where(eq(rooms.id, room.id));
    invalidateCardCache();
    return null;
  }

  if (actor.isHost && !left.some((p) => p.isHost)) {
    const heir = left.find((p) => !p.isBot) ?? left[0];
    await db.update(players).set({ isHost: true }).where(eq(players.id, heir.id));
  }

  if (room.status === "playing") {
    const humans = left.filter((p) => !p.isBot);
    if (humans.length === 0) {
      await db.delete(rooms).where(eq(rooms.id, room.id));
      return null;
    }
    if (left.length < MIN_PARTICIPANTS) {
      await insertBot(room.id, left.map((p) => p.name));
    }
  }

  const [reloaded] = await db
    .select()
    .from(rooms)
    .where(eq(rooms.id, room.id))
    .limit(1);
  return reloaded ?? null;
}

export async function rematch(
  room: Room,
  playerId: number | null,
  token: string | null,
): Promise<Room> {
  const actor = await requireActor(room, playerId, token);
  if (room.status !== "finished") throw new GameError("Игра ещё не закончена");
  if (!actor.isHost) throw new GameError("Начать реванш может только хост");

  const [claimed] = await db
    .update(rooms)
    .set({ status: "playing", phase: "transitioning", round: 0, phaseChangedAt: new Date() })
    .where(and(eq(rooms.id, room.id), eq(rooms.status, "finished")))
    .returning();
  if (!claimed) return (await loadRoomByCode(room.code)) ?? room;

  let roster = await getRoomPlayers(room.id);
  while (roster.length < MIN_PARTICIPANTS) {
    await insertBot(room.id, roster.map((p) => p.name));
    roster = await getRoomPlayers(room.id);
  }

  await db.update(players).set({ score: 0 }).where(eq(players.roomId, room.id));
  await db.delete(plays).where(eq(plays.roomId, room.id));
  await db.delete(votes).where(eq(votes.roomId, room.id));
  await db.delete(roundReady).where(eq(roundReady.roomId, room.id));
  await db.delete(handCards).where(eq(handCards.roomId, room.id));
  await db.delete(rounds).where(eq(rounds.roomId, room.id));

  return startNextRound({ ...claimed, round: 0 });
}

/* ------------------------------------------------------------------ */
/* сборка состояния для клиента                                        */
/* ------------------------------------------------------------------ */

export async function getState(
  rawCode: string,
  viewerId: number | null,
  viewerToken: string | null,
): Promise<RoomState | null> {
  await ensureCards();
  const code = normalizeCode(rawCode);
  let room = await loadRoom(code);
  if (!room) return null;

  // Прогрессируем комнату только из-под одного клиента за окно:
  // остальные просто получат уже обновлённое состояние.
  if (shouldAutoProgress(room.id)) {
    room = await autoProgress(room);
    if (!room) return null;
  }

  const { memes, situations } = await loadCards();
  const inRound = room.status === "playing" && room.round > 0;

  // Все независимые запросы выполняются параллельно: состояние собирается
  // за два round-trip'а до БД вместо семи последовательных.
  const [roster, viewer] = await Promise.all([
    getRoomPlayers(room.id),
    authenticate(room, viewerId, viewerToken),
  ]);

  const [
    roundPlays,
    roundVotes,
    readyRows,
    heldRows,
    customMemeRows,
    customSituationRows,
  ] = await Promise.all([
    inRound ? getRoundPlays(room.id, room.round) : Promise.resolve([]),
    inRound ? getRoundVotes(room.id, room.round) : Promise.resolve([]),
    inRound && room.phase === "reveal"
      ? getRoundReady(room.id, room.round)
      : Promise.resolve([]),
    viewer
      ? db
          .select({ cardId: handCards.cardId })
          .from(handCards)
          .where(and(eq(handCards.roomId, room.id), eq(handCards.playerId, viewer.id)))
      : Promise.resolve([]),
    db
      .select()
      .from(memeCards)
      .where(and(eq(memeCards.roomId, room.id), eq(memeCards.isCustom, true)))
      .orderBy(memeCards.id),
    db
      .select()
      .from(situationCards)
      .where(and(eq(situationCards.roomId, room.id), eq(situationCards.isCustom, true)))
      .orderBy(situationCards.id),
  ]);

  const playersById = new Map(roster.map((p) => [p.id, p]));
  const playedIds = new Set(roundPlays.map((p) => p.playerId));
  const votedIds = new Set(roundVotes.map((v) => v.voterPlayerId));
  const readyIds = new Set(readyRows.map((r) => r.playerId));
  const revealed = room.phase === "reveal";

  const tally = new Map<number, number>();
  const votersByPlay = new Map<number, string[]>();
  for (const play of roundPlays) {
    tally.set(play.id, 0);
    votersByPlay.set(play.id, []);
  }
  for (const vote of roundVotes) {
    if (!tally.has(vote.playId)) continue;
    tally.set(vote.playId, (tally.get(vote.playId) ?? 0) + 1);
    const voter = playersById.get(vote.voterPlayerId);
    if (voter) votersByPlay.get(vote.playId)?.push(voter.name);
  }
  const bestVotes = roundPlays.length > 0 ? Math.max(...tally.values()) : 0;
  const myVote = viewer
    ? roundVotes.find((vote) => vote.voterPlayerId === viewer.id) ?? null
    : null;

  const showTable = room.phase === "voting" || revealed;
  const playViews: PlayView[] = showTable
    ? roundPlays.map((p) => {
        const card = memes.get(p.cardId);
        const author = playersById.get(p.playerId);
        const count = tally.get(p.id) ?? 0;
        return {
          playId: p.id,
          card: card ?? { id: p.cardId, emoji: "🎴", text: "", category: "" },
          playerName: revealed && author ? author.name : null,
          playerAvatar: revealed && author ? author.avatar : null,
          isMine: viewer?.id === p.playerId,
          votes: revealed ? count : 0,
          voterNames: revealed ? votersByPlay.get(p.id) ?? [] : [],
          votedByMe: myVote?.playId === p.id,
          isWinner: revealed && bestVotes > 0 && count === bestVotes,
        };
      })
    : [];

  const winners: WinnerView[] = revealed
    ? roundPlays
        .filter((p) => bestVotes > 0 && (tally.get(p.id) ?? 0) === bestVotes)
        .map((p) => {
          const author = playersById.get(p.playerId);
          const card = memes.get(p.cardId);
          if (!author || !card) return null;
          return {
            playId: p.id,
            playerName: author.name,
            playerAvatar: author.avatar,
            card,
            score: author.score,
            votes: tally.get(p.id) ?? 0,
          };
        })
        .filter((w): w is WinnerView => Boolean(w))
    : [];

  const myHand: CardView[] = viewer
    ? heldRows
        .map((h) => memes.get(h.cardId))
        .filter((c): c is CardView => Boolean(c))
    : [];

  const isHostViewer = viewer?.isHost ?? false;
  const describeAuthor = (authorId: number | null) =>
    authorId ? playersById.get(authorId)?.name ?? "Вышел из игры" : null;

  const customMemes: CustomCardView[] = customMemeRows.map((row) => ({
    id: row.id,
    emoji: row.emoji,
    text: row.text,
    category: row.category,
    authorId: row.createdByPlayerId,
    authorName: describeAuthor(row.createdByPlayerId),
    isMine: Boolean(viewer && row.createdByPlayerId === viewer.id),
    canDelete: Boolean(
      viewer && (isHostViewer || row.createdByPlayerId === viewer.id),
    ),
  }));
  const customSituations: CustomCardView[] = customSituationRows.map((row) => ({
    id: row.id,
    emoji: "🎴",
    text: row.text,
    category: row.category,
    authorId: row.createdByPlayerId,
    authorName: describeAuthor(row.createdByPlayerId),
    isMine: Boolean(viewer && row.createdByPlayerId === viewer.id),
    canDelete: Boolean(
      viewer && (isHostViewer || row.createdByPlayerId === viewer.id),
    ),
  }));

  const playerViews: PlayerView[] = roster.map((p) => ({
    id: p.id,
    name: p.name,
    avatar: p.avatar,
    score: p.score,
    isHost: p.isHost,
    isBot: p.isBot,
    isYou: viewer?.id === p.id,
    hasPlayed: playedIds.has(p.id),
    hasVoted: votedIds.has(p.id),
    isReady: p.isBot ? true : readyIds.has(p.id),
  }));

  const you: SelfView | null = viewer
    ? {
        id: viewer.id,
        name: viewer.name,
        avatar: viewer.avatar,
        isHost: viewer.isHost,
        isBot: false,
        hasPlayed: playedIds.has(viewer.id),
        hasVoted: votedIds.has(viewer.id),
        isReady: readyIds.has(viewer.id),
        votedPlayId: myVote?.playId ?? null,
      }
    : null;

  const humans = roster.filter((p) => !p.isBot);
  const canStart = humans.length >= 1;
  const startHint = !canStart ? "Нужен хотя бы один живой игрок" : null;

  const elapsed = (Date.now() - new Date(room.phaseChangedAt).getTime()) / 1000;
  let secondsLeft: number | null = null;
  if (room.status === "playing" && room.timersEnabled) {
    if (room.phase === "submitting") {
      secondsLeft = Math.max(0, Math.ceil(room.submitSeconds - elapsed));
    } else if (room.phase === "voting") {
      secondsLeft = Math.max(0, Math.ceil(room.voteSeconds - elapsed));
    } else if (room.phase === "reveal") {
      secondsLeft = Math.max(0, Math.ceil(room.revealSeconds - elapsed));
    }
  }

  const voterTotal = roundPlays.length
    ? roster.filter((p) => roundPlays.some((play) => play.playerId !== p.id)).length
    : 0;

  return {
    code: room.code,
    status: room.status as RoomState["status"],
    phase: room.phase as RoomState["phase"],
    round: room.round,
    targetScore: room.targetScore,
    players: playerViews,
    situation: room.situationCardId
      ? situations.get(room.situationCardId) ?? null
      : null,
    myHand,
    plays: playViews,
    winners,
    you,
    secondsLeft,
    phaseChangedAt: room.phaseChangedAt.toISOString(),
    timers: {
      enabled: room.timersEnabled,
      submitSeconds: room.submitSeconds,
      voteSeconds: room.voteSeconds,
      revealSeconds: room.revealSeconds,
    },
    readyCount: humans.filter((p) => readyIds.has(p.id)).length,
    readyTotal: humans.length,
    submittedCount: roundPlays.length,
    votedCount: roundVotes.length,
    voterTotal,
    canStart,
    startHint,
    botsAllowed: roster.length < MAX_PLAYERS,
    customMemes,
    customSituations,
  };
}
