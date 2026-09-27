// Создаёт таблицы игры напрямую по SQL — надёжнее, чем drizzle-kit push,
// в общей базе данных с другими приложениями (там drizzle-kit пытается
// задать интерактивный вопрос про переименование таблиц и падает в CI).
const { Pool } = require('pg');

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.log('DATABASE_URL не задан — пропускаю миграцию.');
  process.exit(0);
}

const pool = new Pool({ connectionString: databaseUrl });

const statements = [
  `CREATE TABLE IF NOT EXISTS "rooms" (
    "id" serial PRIMARY KEY,
    "code" varchar(6) NOT NULL UNIQUE,
    "status" varchar(16) NOT NULL DEFAULT 'lobby',
    "phase" varchar(16) NOT NULL DEFAULT 'lobby',
    "round" integer NOT NULL DEFAULT 0,
    "target_score" integer NOT NULL DEFAULT 5,
    "situation_card_id" integer,
    "phase_changed_at" timestamp NOT NULL DEFAULT now(),
    "submit_seconds" integer NOT NULL DEFAULT 20,
    "vote_seconds" integer NOT NULL DEFAULT 30,
    "reveal_seconds" integer NOT NULL DEFAULT 15,
    "timers_enabled" boolean NOT NULL DEFAULT true,
    "created_at" timestamp NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS "players" (
    "id" serial PRIMARY KEY,
    "room_id" integer NOT NULL,
    "name" varchar(24) NOT NULL,
    "avatar" varchar(8) NOT NULL DEFAULT '🙂',
    "score" integer NOT NULL DEFAULT 0,
    "is_host" boolean NOT NULL DEFAULT false,
    "is_bot" boolean NOT NULL DEFAULT false,
    "token" varchar(40) NOT NULL,
    "created_at" timestamp NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS "meme_cards" (
    "id" serial PRIMARY KEY,
    "room_id" integer,
    "emoji" varchar(8) NOT NULL,
    "text" text NOT NULL,
    "category" varchar(24) NOT NULL DEFAULT 'реакция',
    "is_custom" boolean NOT NULL DEFAULT false,
    "created_by_player_id" integer,
    "created_at" timestamp NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS "situation_cards" (
    "id" serial PRIMARY KEY,
    "room_id" integer,
    "text" text NOT NULL,
    "category" varchar(24) NOT NULL DEFAULT 'ситуация',
    "is_custom" boolean NOT NULL DEFAULT false,
    "created_by_player_id" integer,
    "created_at" timestamp NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS "rounds" (
    "id" serial PRIMARY KEY,
    "room_id" integer NOT NULL,
    "number" integer NOT NULL,
    "situation_card_id" integer NOT NULL,
    "created_at" timestamp NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS "plays" (
    "id" serial PRIMARY KEY,
    "room_id" integer NOT NULL,
    "round" integer NOT NULL,
    "player_id" integer NOT NULL,
    "card_id" integer NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS "votes" (
    "id" serial PRIMARY KEY,
    "room_id" integer NOT NULL,
    "round" integer NOT NULL,
    "voter_player_id" integer NOT NULL,
    "play_id" integer NOT NULL,
    "created_at" timestamp NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS "round_ready" (
    "id" serial PRIMARY KEY,
    "room_id" integer NOT NULL,
    "round" integer NOT NULL,
    "player_id" integer NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS "hand_cards" (
    "id" serial PRIMARY KEY,
    "room_id" integer NOT NULL,
    "player_id" integer NOT NULL,
    "card_id" integer NOT NULL
  )`,
];

(async () => {
  for (const sql of statements) {
    await pool.query(sql);
  }
  await pool.end();
  console.log(`Миграция готова: проверено/создано таблиц — ${statements.length}.`);
})().catch((err) => {
  console.error('Миграция не удалась:', err);
  process.exit(1);
});
