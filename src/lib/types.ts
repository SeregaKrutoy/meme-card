export type RoomStatus = "lobby" | "playing" | "finished";
export type RoomPhase =
  | "lobby"
  | "submitting"
  | "voting"
  | "reveal"
  | "transitioning"
  | "finished";

export type CardView = {
  id: number;
  emoji: string;
  text: string;
  category: string;
};

/** Пользовательская карточка с автором и правом удаления для текущего зрителя. */
export type CustomCardView = CardView & {
  authorId: number | null;
  authorName: string | null;
  isMine: boolean;
  canDelete: boolean;
};

export type PlayerView = {
  id: number;
  name: string;
  avatar: string;
  score: number;
  isHost: boolean;
  isBot: boolean;
  isYou: boolean;
  /** Выложил карту в текущем раунде. */
  hasPlayed: boolean;
  /** Проголосовал в текущем раунде. */
  hasVoted: boolean;
  /** Готов перейти к следующей ситуации на экране итогов. */
  isReady: boolean;
};

export type PlayView = {
  playId: number;
  card: CardView;
  /** null, пока авторы не раскрыты */
  playerName: string | null;
  playerAvatar: string | null;
  isMine: boolean;
  /** Количество голосов (показывается только на этапе итогов). */
  votes: number;
  /** Кто отдал голос за эту карту — раскрывается вместе с авторами. */
  voterNames: string[];
  /** Этот игрок проголосовал именно за эту карту. */
  votedByMe: boolean;
  /** Победитель раунда. */
  isWinner: boolean;
};

export type WinnerView = {
  playId: number;
  playerName: string;
  playerAvatar: string;
  card: CardView;
  score: number;
  votes: number;
};

export type SelfView = {
  id: number;
  name: string;
  avatar: string;
  isHost: boolean;
  isBot: boolean;
  hasPlayed: boolean;
  hasVoted: boolean;
  isReady: boolean;
  /** За какую карту проголосовал этот игрок. */
  votedPlayId: number | null;
};

export type TimerSettings = {
  enabled: boolean;
  submitSeconds: number;
  voteSeconds: number;
  revealSeconds: number;
};

export type RoomState = {
  code: string;
  status: RoomStatus;
  phase: RoomPhase;
  round: number;
  targetScore: number;
  players: PlayerView[];
  situation: CardView | null;
  myHand: CardView[];
  plays: PlayView[];
  /** Победители раунда (несколько при равенстве голосов). */
  winners: WinnerView[];
  you: SelfView | null;
  /** Секунды до автоперехода; null — когда таймеры отключены. */
  secondsLeft: number | null;
  /** Момент смены фазы (ISO). Клиент считает отсчёт по нему локально. */
  phaseChangedAt: string;
  timers: TimerSettings;
  /** Сколько игроков уже нажали «следующая ситуация». */
  readyCount: number;
  /** Сколько всего живых участников должны нажать. */
  readyTotal: number;
  submittedCount: number;
  votedCount: number;
  /** Сколько игроков вообще должны голосовать в этом раунде. */
  voterTotal: number;
  canStart: boolean;
  startHint: string | null;
  botsAllowed: boolean;
  customMemes: CustomCardView[];
  customSituations: CustomCardView[];
};

export type JoinResult = { code: string; playerId: number; token: string };
