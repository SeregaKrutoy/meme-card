/**
 * Извлекает четырёхсимвольный код комнаты из:
 * - чистого кода ABCD;
 * - ссылки /room/ABCD;
 * - invite-ссылки /?code=ABCD.
 */
export function extractRoomCode(
  value: string,
  base = "https://membattle.local",
): string | null {
  const raw = value.trim();
  if (!raw) return null;
  if (/^[A-Z0-9]{4}$/i.test(raw)) return raw.toUpperCase();

  try {
    const url = new URL(raw, base);
    const roomMatch = url.pathname.match(/\/room\/([A-Z0-9]{4})\/?$/i);
    if (roomMatch) return roomMatch[1].toUpperCase();

    const queryCode = url.searchParams.get("code");
    if (queryCode && /^[A-Z0-9]{4}$/i.test(queryCode)) {
      return queryCode.toUpperCase();
    }
  } catch {
    // Не URL и не валидный код.
  }
  return null;
}
