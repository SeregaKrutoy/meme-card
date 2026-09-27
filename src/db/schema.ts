import {
  pgTable,
  serial,
  varchar,
  text,
  integer,
  boolean,
  timestamp,
} from "drizzle-orm/pg-core";

/** Игровая комната, создаётся по коду приглашения. */
export const rooms = pgTable("rooms", {
  id: serial("id").primaryKey(),
  code: varchar("code", { length: 6 }).notNull().unique(),
  /** lobby | playing | finished */
  status: varchar("status", { length: 16 }).notNull().default("lobby"),
  /** lobby | submitting | voting | reveal | transitioning | finished */
  phase: varchar("phase", { length: 16 }).notNull().default("lobby"),
  round: integer("round").notNull().default(0),
  targetScore: integer("target_score").notNull().default(5),
  situationCardId: integer("situation_card_id"),
  /** Время последней смены фазы — основа для всех таймеров раунда. */
  phaseChangedAt: timestamp("phase_changed_at").notNull().defaultNow(),
  /** Настраиваемые хостом лимиты фаз (в секундах). */
  submitSeconds: integer("submit_seconds").notNull().default(20),
  voteSeconds: integer("vote_seconds").notNull().default(30),
  revealSeconds: integer("reveal_seconds").notNull().default(15),
  /** Если false — фазы ждут действий игроков без обратного отсчёта. */
  timersEnabled: boolean("timers_enabled").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

/** Игрок в комнате. Идентифицируется парой (id, token) из localStorage. */
export const players = pgTable("players", {
  id: serial("id").primaryKey(),
  roomId: integer("room_id").notNull(),
  name: varchar("name", { length: 24 }).notNull(),
  avatar: varchar("avatar", { length: 8 }).notNull().default("🙂"),
  score: integer("score").notNull().default(0),
  isHost: boolean("is_host").notNull().default(false),
  /** Бот, управляемый сервером: сам выкладывает карты и голосует. */
  isBot: boolean("is_bot").notNull().default(false),
  token: varchar("token", { length: 40 }).notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

/** Карта-мем: эмодзи + подпись. Выкладывается игроками в ответ на ситуацию. */
export const memeCards = pgTable("meme_cards", {
  id: serial("id").primaryKey(),
  /** null — общая колода; roomId — карта, созданная только для одной комнаты. */
  roomId: integer("room_id"),
  emoji: varchar("emoji", { length: 8 }).notNull(),
  text: text("text").notNull(),
  category: varchar("category", { length: 24 }).notNull().default("реакция"),
  isCustom: boolean("is_custom").notNull().default(false),
  /** Автор пользовательской карточки: удалять её может он сам или хост. */
  createdByPlayerId: integer("created_by_player_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

/** Карта-ситуация: задание раунда, которую надо объяснить мемом. */
export const situationCards = pgTable("situation_cards", {
  id: serial("id").primaryKey(),
  /** null — общая колода; roomId — вопрос, созданный только для одной комнаты. */
  roomId: integer("room_id"),
  text: text("text").notNull(),
  category: varchar("category", { length: 24 }).notNull().default("ситуация"),
  isCustom: boolean("is_custom").notNull().default(false),
  createdByPlayerId: integer("created_by_player_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

/** Раунд: ситуация текущего круга. */
export const rounds = pgTable("rounds", {
  id: serial("id").primaryKey(),
  roomId: integer("room_id").notNull(),
  number: integer("number").notNull(),
  situationCardId: integer("situation_card_id").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

/** Выложенная карта в конкретном раунде. */
export const plays = pgTable("plays", {
  id: serial("id").primaryKey(),
  roomId: integer("room_id").notNull(),
  round: integer("round").notNull(),
  playerId: integer("player_id").notNull(),
  cardId: integer("card_id").notNull(),
});

/** Голос игрока за чужую карту в раунде. */
export const votes = pgTable("votes", {
  id: serial("id").primaryKey(),
  roomId: integer("room_id").notNull(),
  round: integer("round").notNull(),
  voterPlayerId: integer("voter_player_id").notNull(),
  playId: integer("play_id").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

/** Готовность игрока перейти к следующей ситуации на экране итогов. */
export const roundReady = pgTable("round_ready", {
  id: serial("id").primaryKey(),
  roomId: integer("room_id").notNull(),
  round: integer("round").notNull(),
  playerId: integer("player_id").notNull(),
});

/** Карта на руках у игрока. */
export const handCards = pgTable("hand_cards", {
  id: serial("id").primaryKey(),
  roomId: integer("room_id").notNull(),
  playerId: integer("player_id").notNull(),
  cardId: integer("card_id").notNull(),
});

export type Room = typeof rooms.$inferSelect;
export type Player = typeof players.$inferSelect;
export type MemeCard = typeof memeCards.$inferSelect;
export type SituationCard = typeof situationCards.$inferSelect;
export type Play = typeof plays.$inferSelect;
export type Vote = typeof votes.$inferSelect;
export type HandCard = typeof handCards.$inferSelect;
