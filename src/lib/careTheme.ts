/**
 * 관리 강도(0~3)에 따라 통화 화면의 색·아바타·인사말이 바뀌게 하는 데이터입니다.
 * (4 강제적 채찍은 화면이 따로 있어서 여기에 없습니다 → #69)
 *
 * 아직 #78 의 CareLevel 타입이 없어서 임시로 여기서 정의합니다. 생기면 그쪽을 가져다 쓰세요.
 */
export type CareLevel = 0 | 1 | 2 | 3

export interface CareTheme {
  /** 단계 이름 (예: '당근') */
  name: string
  /** 화면 전체 배경 (Tailwind 는 완성된 클래스 이름만 읽어서, 조각을 붙이지 않고 통째로 적습니다) */
  pageBackground: string
  /** 아바타 동그라미 색 */
  avatarBackground: string
  /** 아바타 바깥 숨쉬는 동그라미 색 */
  avatarGlow: string
  /** 아바타 표정 */
  avatarEmoji: string
  /** 스크린 리더(화면을 읽어 주는 프로그램)용 표정 설명 */
  avatarLabel: string
}

// 색은 모두 어두운 배경 + 흰 글씨 기준입니다. (통화 화면은 글씨가 흰색)
export const careThemes: Record<CareLevel, CareTheme> = {
  0: {
    name: '회복',
    pageBackground: 'bg-teal-950',
    avatarBackground: 'bg-teal-600',
    avatarGlow: 'bg-teal-400/30',
    avatarEmoji: '😌',
    avatarLabel: '편안한 표정',
  },
  1: {
    name: '당근',
    pageBackground: 'bg-amber-950',
    avatarBackground: 'bg-amber-500',
    avatarGlow: 'bg-amber-300/30',
    avatarEmoji: '😄',
    avatarLabel: '기분 좋은 표정',
  },
  2: {
    name: '넛지',
    pageBackground: 'bg-slate-900',
    avatarBackground: 'bg-brand',
    avatarGlow: 'bg-indigo-500/30',
    avatarEmoji: '🙂',
    avatarLabel: '차분한 표정',
  },
  3: {
    name: '심리적 채찍',
    pageBackground: 'bg-rose-950',
    avatarBackground: 'bg-rose-700',
    avatarGlow: 'bg-rose-400/30',
    avatarEmoji: '😐',
    avatarLabel: '굳은 표정',
  },
}

/** 인사말 한 개. harshness 는 이 말이 얼마나 센지(1~5)입니다. */
export interface Greeting {
  text: string
  /**
   * 독설 수위. 설정 화면(#59)의 "독설 허용 수위"와 같은 기준입니다.
   * 1 부드럽게 / 2 담백하게 / 3 따끔하게 / 4 세게 / 5 제일 세게
   */
  harshness: number
}

/*
 * 단계별 첫 인사말입니다. 이 중 하나가 랜덤으로 나옵니다.
 *
 * 문구 규칙 (이슈 #32)
 * - 외모·성적·능력을 깎아내리는 말, 다른 사람과 비교하는 말은 쓰지 않습니다. 지적은 행동에만 합니다.
 * - 새 문구를 추가할 때는 수위(harshness)를 꼭 정직하게 답니다. 허용 수위보다 센 문구는 나오지 않습니다.
 * - 아직 수위 4~5 문구는 없습니다. 허용 수위를 4~5 로 올려도 3 이하 문구만 나옵니다.
 * - 기록과 상관없이 랜덤으로 나오므로, "어제 40분 빨랐어" 처럼 기록을 말하는 문장은 넣지 않습니다.
 *   (실제와 다르면 지어낸 칭찬 · 지적이 됩니다. 기록을 말하려면 진짜 기록으로 문장을 만들어야 합니다)
 */
export const careGreetings: Record<CareLevel, Greeting[]> = {
  0: [
    { text: '오늘은 10분만 해볼까?', harshness: 1 },
    { text: '괜찮아, 천천히 시작하자.', harshness: 1 },
    { text: '오늘은 가볍게 한 가지만 해보자.', harshness: 1 },
  ],
  1: [
    { text: '오늘도 와 줘서 반가워!', harshness: 1 },
    { text: '오늘도 같이 해 보자!', harshness: 1 },
    { text: '꾸준히 하는 모습이 보기 좋아.', harshness: 1 },
  ],
  2: [
    { text: '계획한 시간이 됐으면 시작해 볼까?', harshness: 1 },
    { text: '오늘 첫 계획 시작할 시간이야.', harshness: 1 },
    { text: '타이머 켤 시간이야.', harshness: 1 },
  ],
  3: [
    { text: '요즘 계속 미뤄지는 것 같아서 걱정돼.', harshness: 1 }, // 걱정
    { text: '오늘 계획, 아직 시작 전이네.', harshness: 2 }, // 담백
    { text: '독촉이 안 통하는 것 같으니 당분간 연락 안 할게.', harshness: 2 }, // 마무리
    { text: '또 미룰 거야? 오늘은 뭐부터 할지 지금 정하자.', harshness: 3 }, // 팩폭
    { text: '이번 주 계획이 계속 비어 있어. 오늘은 뭐부터 할 거야?', harshness: 3 }, // 팩폭
  ],
}

/**
 * 그 단계의 인사말 중 하나를 랜덤으로 고릅니다.
 * maxHarshness(허용 수위)보다 센 문구는 고르지 않습니다. 고를 수 있는 게 하나도 없으면
 * 가장 순한 문구 중에서 고릅니다. (random 은 테스트할 때 값을 고정하려고 받습니다)
 *
 * maxHarshness 기본값 3 은 설정 화면(#59)의 처음 값과 같습니다.
 * 사용자가 정한 값을 쓰려면 getCareLimits().maxHarshness 를 넘기세요.
 */
export function pickGreeting(
  level: CareLevel,
  maxHarshness = 3,
  random: () => number = Math.random,
) {
  const greetings = careGreetings[level]

  const allowed = greetings.filter((greeting) => greeting.harshness <= maxHarshness)
  let candidates = allowed
  if (candidates.length === 0) {
    const lowest = Math.min(...greetings.map((greeting) => greeting.harshness))
    candidates = greetings.filter((greeting) => greeting.harshness === lowest)
  }

  return candidates[Math.floor(random() * candidates.length)].text
}
