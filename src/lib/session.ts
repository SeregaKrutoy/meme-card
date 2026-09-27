/**
 * Хранение сессии игрока в комнате.
 *
 * Превью часто открывается в песочнице-iframe, где браузер запрещает
 * localStorage, sessionStorage и cookies. Поэтому сессия дублируется
 * сразу в несколько каналов, и чтение идёт по приоритету:
 *
 *   1. Память модуля  — живёт при мягкой навигации router.push (без перезагрузки).
 *   2. localStorage   — переживает перезагрузку страницы.
 *   3. sessionStorage — запасной вариант в рамках вкладки.
 *   4. Cookie         — ещё один вариант на случай блокировки Storage API.
 *   5. #фрагмент URL  — работает даже когда заблокировано вообще всё.
 *
 * Ни одна функция здесь не бросает исключений.
 */

export type Identity = { playerId: number; token: string };

const PREFIX = "membattle:";
const HASH_KEYS = { id: "p", token: "t" } as const;

/** Живёт в рамках загрузки страницы. Пересекает router.push без потерь. */
const memory = new Map<string, Identity>();

export function sessionKey(code: string): string {
  return `${PREFIX}${code.trim().toUpperCase()}`;
}

/* ------------------------------------------------------------------ */
/* передача через query-параметры (самый надёжный канал)               */
/* ------------------------------------------------------------------ */

/**
 * Собирает адрес комнаты с сессией в query-параметрах.
 * В отличие от хранилищ и #фрагмента, query-параметры Next.js
 * передаёт прямо в серверный компонент — они не зависят ни от
 * настроек браузера, ни от времени монтирования клиента.
 */
export function roomUrlWithIdentity(
  code: string,
  identity: Identity,
): string {
  const params = new URLSearchParams({
    [HASH_KEYS.id]: String(identity.playerId),
    [HASH_KEYS.token]: identity.token,
  });
  return `/room/${code.trim().toUpperCase()}?${params.toString()}`;
}

/** Разбирает сессию из query-параметров адреса. */
export function identityFromSearchParams(
  params: Record<string, string | string[] | undefined>,
): Identity | null {
  const read = (key: string): string | null => {
    const value = params[key];
    if (Array.isArray(value)) return value[0] ?? null;
    return value ?? null;
  };
  const playerId = Number(read(HASH_KEYS.id));
  const token = read(HASH_KEYS.token);
  if (!Number.isFinite(playerId) || playerId <= 0 || !token) return null;
  return { playerId, token };
}

function isIdentity(value: unknown): value is Identity {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<Identity>;
  return (
    typeof candidate.playerId === "number" &&
    Number.isFinite(candidate.playerId) &&
    candidate.playerId > 0 &&
    typeof candidate.token === "string" &&
    candidate.token.length > 0
  );
}

/* ------------------------------------------------------------------ */
/* каналы хранения                                                     */
/* ------------------------------------------------------------------ */

function fromLocalStorage(key: string): Identity | null {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (isIdentity(JSON.parse(raw)) ? (JSON.parse(raw) as Identity) : null) : null;
  } catch {
    return null;
  }
}

function fromSessionStorage(key: string): Identity | null {
  try {
    const raw = window.sessionStorage.getItem(key);
    return raw ? (isIdentity(JSON.parse(raw)) ? (JSON.parse(raw) as Identity) : null) : null;
  } catch {
    return null;
  }
}

function setCookie(key: string, raw: string): boolean {
  try {
    // path=/ и явный срок жизни, чтобы cookie работал после перезагрузки.
    document.cookie = `${key}=${encodeURIComponent(raw)}; path=/; max-age=86400; SameSite=Lax`;
    return document.cookie.includes(key);
  } catch {
    return false;
  }
}

function fromCookie(key: string): Identity | null {
  try {
    const match = document.cookie
      .split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${key}=`));
    if (!match) return null;
    const raw = decodeURIComponent(match.slice(key.length + 1));
    const parsed = JSON.parse(raw) as unknown;
    return isIdentity(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function dropCookie(key: string): void {
  try {
    document.cookie = `${key}=; path=/; max-age=0; SameSite=Lax`;
  } catch {
    // cookies могут быть запрещены
  }
}

/* ------------------------------------------------------------------ */
/* публичный API                                                       */
/* ------------------------------------------------------------------ */

/** Читает сессию из любого доступного канала. Никогда не бросает. */
export function loadSession(code: string): Identity | null {
  if (typeof window === "undefined") return null;
  const key = sessionKey(code);

  const inMemory = memory.get(key);
  if (inMemory) return inMemory;

  const stored = fromLocalStorage(key) ?? fromSessionStorage(key) ?? fromCookie(key);
  if (stored) {
    // кэшируем, чтобы дальше не ходить по каналам
    memory.set(key, stored);
    return stored;
  }
  return null;
}

/**
 * Сохраняет сессию во все доступные каналы.
 * Возвращает true, если хотя бы один *переживающий перезагрузку* канал сработал.
 * Память модуля заполняется всегда — этого достаточно для router.push.
 */
export function saveSession(code: string, identity: Identity): boolean {
  if (!isIdentity(identity) || typeof window === "undefined") return false;
  const key = sessionKey(code);
  const raw = JSON.stringify({ playerId: identity.playerId, token: identity.token });

  // Канал для мягкой навигации: не зависит от браузерных ограничений.
  memory.set(key, identity);

  let persisted = false;
  try {
    window.localStorage.setItem(key, raw);
    persisted = true;
  } catch {
    // хранилище запрещено — пробуем дальше
  }
  if (!persisted) {
    try {
      window.sessionStorage.setItem(key, raw);
      persisted = true;
    } catch {
      // см. выше
    }
  }
  if (!persisted) {
    persisted = setCookie(key, raw);
  }
  return persisted;
}

export function clearSession(code: string): void {
  if (typeof window === "undefined") return;
  const key = sessionKey(code);
  memory.delete(key);
  for (const store of [window.localStorage, window.sessionStorage]) {
    try {
      store.removeItem(key);
    } catch {
      // хранилище недоступно
    }
  }
  dropCookie(key);
}

/* ------------------------------------------------------------------ */
/* передача через адрес страницы                                       */
/* ------------------------------------------------------------------ */

/** Кодирует сессию в #фрагмент. */
export function sessionHash(identity: Identity): string {
  if (!isIdentity(identity)) return "";
  const params = new URLSearchParams({
    [HASH_KEYS.id]: String(identity.playerId),
    [HASH_KEYS.token]: identity.token,
  });
  return `#${params.toString()}`;
}

/**
 * Адрес комнаты с зашитой сессией.
 * Нужен, когда持久 хранилища недоступны: ссылка переживёт перезагрузку.
 */
export function roomUrlWithSession(code: string, identity: Identity): string {
  return `/room/${code.trim().toUpperCase()}${sessionHash(identity)}`;
}

/** Читает сессию из #фрагмента текущего адреса. */
export function readSessionHash(): Identity | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.location.hash.replace(/^#/, "");
    if (!raw) return null;
    const params = new URLSearchParams(raw);
    const playerId = Number(params.get(HASH_KEYS.id));
    const token = params.get(HASH_KEYS.token);
    if (!Number.isFinite(playerId) || playerId <= 0 || !token) return null;
    return { playerId, token };
  } catch {
    return null;
  }
}

/** Убирает креды из адресной строки. */
export function clearSessionHash(): void {
  if (typeof window === "undefined") return;
  try {
    if (!window.location.hash) return;
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${window.location.search}`,
    );
  } catch {
    // history API может быть запрещена
  }
}

/**
 * Итоговое разрешение сессии для комнаты: хранилище → cookie → #фрагмент.
 * Найденное во фрагменте сразу раскладывается по каналам, чтобы пережить перезагрузку.
 */
export function resolveIdentity(code: string): Identity | null {
  if (typeof window === "undefined") return null;

  const stored = loadSession(code);
  if (stored) {
    // Креды в адресе больше не нужны, если есть надёжное хранилище.
    if (readSessionHash()) clearSessionHash();
    return stored;
  }

  const fromHash = readSessionHash();
  if (fromHash) {
    const persisted = saveSession(code, fromHash);
    // Если ничего持久 не сработало — фрагмент оставляем: только он спасёт
    // сессию после перезагрузки страницы.
    if (persisted) clearSessionHash();
    return fromHash;
  }
  return null;
}
