/**
 * 테스트 로그인으로 시연할 때 AI 코치 대신 답하는 "정해진 답" 입니다. (2026-10-18)
 * 테스트 로그인은 서버(진짜 AI)를 쓸 수 없어서, 학생이 쓴 말의 낱말을 보고 미리 써 둔 답을 고릅니다.
 * 화면은 이 답 아래에 꼭 "시연용 정해진 답" 이라고 붙입니다. (AI 인 척하지 않기 위해서)
 *
 *   replyDemo('오늘 너무 피곤해', 재료) -> { text: '피곤한 날엔 계획을 가볍게 고치자. …', chips: [▷ 오늘 계획 가볍게 고치기, …], showHelp: false }
 *
 * 대화방 3개(2026-10-18 저녁, #582): 📅 계획 · 📚 과목 쌤 방과 [이야기하기] 주제(후기 · 못 한 카드 …)에도
 * 시연용 정해진 답이 있습니다. (replyDemoInRoom · demoTopicOpener) 💬 상담 방은 예전 코치 답(replyDemo)을 씁니다.
 */
import type { ChatAboutKind, ChatRoomId } from '@/lib/chatRooms'
import {
  LONG_PLAN_CHIP,
  negotiationChipsFor,
  PLAN_CHIP,
  QUIZ_CHIP,
  SMALL_START_MINUTES,
  type CoachChip,
  type CoachMessage,
} from '@/lib/coachBriefing'
import { getSafetyBrakeResult } from '@/lib/safetyBrake'
import type { SchoolToday } from '@/lib/schoolToday'
import type { Card } from '@/types'

export interface DemoReply extends CoachMessage {
  /** true 면 위기 표현이라 상담 전화 한 줄을 같이 보여 줍니다. */
  showHelp: boolean
  /** 후기 · 못 한 카드 대화에서 학생 말로 짐작한 이유 값 (서버의 tags 와 같은 뜻). 없으면 undefined */
  tags?: string[]
}

export interface DemoContext {
  school: SchoolToday | null
  /** 지금 · 다음에 할 카드. 없으면 undefined */
  card: Card | undefined
}

/** 낱말 중 하나라도 들어 있는지 */
function hasAny(text: string, words: string[]): boolean {
  return words.some((word) => text.includes(word))
}

/** 카드가 있으면 그 카드로, 없으면 즉석 카드로 시작하는 칩 */
function startChip(card: Card | undefined): CoachChip {
  return card
    ? { kind: 'startCard', label: '▷ 지금 시작', cardId: card.id }
    : {
        kind: 'startMinutes',
        label: `▷ ${SMALL_START_MINUTES}분 시작`,
        minutes: SMALL_START_MINUTES,
      }
}

/** 위기 표현이면 공부 이야기를 멈추는 답. 아니면 null (어떤 규칙보다 먼저 봅니다) */
function crisisReply(text: string): DemoReply | null {
  const brake = getSafetyBrakeResult({
    now: new Date(),
    recentTexts: [text],
    recentMoods: [],
    exams: [],
  })
  if (!brake.stopWhip) return null
  return {
    text: '말해 줘서 고마워. 지금 많이 힘들구나. 공부 이야기는 잠시 멈출게. 믿을 수 있는 어른에게 꼭 이야기해 줘.',
    chips: [],
    showHelp: true,
  }
}

/** 시연용 정해진 답을 고릅니다. 위에서부터 먼저 맞는 규칙 하나를 씁니다. */
export function replyDemo(studentText: string, context: DemoContext): DemoReply {
  const text = studentText.trim()

  // 위기 표현은 어떤 규칙보다 먼저 봅니다. 공부 이야기는 멈추고 상담 전화 한 줄을 보여 줍니다.
  const crisis = crisisReply(text)
  if (crisis) return crisis

  // 핑계 협상: 코치가 오늘 계획을 가볍게 다시 짜고, 학생이 보고 같이 고칩니다. (계획 핑퐁)
  const negotiation = negotiationChipsFor(text)
  if (hasAny(text, ['피곤', '졸려', '힘들'])) {
    return {
      text: '피곤한 날엔 계획을 가볍게 고치자. 내가 줄여서 다시 짜 볼 테니, 보고 더 고칠 곳 말해 줘.',
      chips: negotiation,
      showHelp: false,
    }
  }
  if (hasAny(text, ['시간 없', '시간이 없', '바빠'])) {
    return {
      text: '바쁜 날이면 오늘 계획을 짧게 고쳐 보자. 제일 중요한 것 하나만 남겨도 돼.',
      chips: negotiation,
      showHelp: false,
    }
  }
  if (hasAny(text, ['계획', '뭐 하지', '뭐하지', '뭐부터'])) {
    return {
      text: '좋아, 내가 먼저 오늘 계획을 짜 볼게. 시험 · 대회 날까지 길게 짤 수도 있어.',
      chips: [PLAN_CHIP, LONG_PLAN_CHIP],
      showHelp: false,
    }
  }
  if (hasAny(text, ['하기 싫', '귀찮', '싫어'])) {
    return {
      text: '하기 싫은 날이 제일 중요해. 딱 한 장, 30분만 해 보고 그래도 싫으면 그만둬도 돼. 약속할게.',
      chips: [
        { kind: 'startMinutes', label: '▷ 30분만 해 볼게', minutes: 30 },
        ...negotiation.slice(1),
      ],
      showHelp: false,
    }
  }
  if (hasAny(text, ['쉴래', '쉬고', '쉴게'])) {
    return {
      text: '좋아, 쉬는 것도 계획이야. 대신 내일 아침에 내가 먼저 물어볼게. 푹 쉬어!',
      chips: [{ kind: 'say', label: '아니다, 하나만 할래' }],
      showHelp: false,
    }
  }
  if (hasAny(text, ['급식', '점심', '배고', '밥'])) {
    const lunch = context.school?.meals.find((meal) => meal.date === context.school?.date)
    const menu = lunch ? lunch.dishes.slice(0, 3).join(', ') : '오늘 급식 정보는 아직 없어'
    return {
      text: `오늘 점심은 ${menu}! 든든하게 먹고 와서 오늘 배운 거 30분만 복습하자.`,
      chips: [startChip(context.card)],
      showHelp: false,
    }
  }
  if (hasAny(text, ['시험', '중간', '기말', '모의'])) {
    const exam = context.school?.events.find((event) => event.exam)
    return {
      text: exam
        ? `${exam.name}까지 D-${exam.dDay}. 시험 날까지 계획을 같이 짜 볼까? 범위표나 교과서 사진을 넣어도 돼.`
        : '아직 30일 안에 학교 시험은 없어. 대회나 자격증이면 날짜를 알려 줘, 그날까지 계획을 짜 줄게.',
      chips: [LONG_PLAN_CHIP, startChip(context.card)],
      showHelp: false,
    }
  }
  // '못 했어' · '일부만 했어' 에도 '했어' 가 들어 있어서, '다 했어' 보다 먼저 봅니다.
  if (hasAny(text, ['일부', '조금', '못 했', '못했'])) {
    return {
      text: '괜찮아, 시작한 게 중요해. 뭐 때문에 멈췄는지 하나만 골라 줄래? 다음엔 그걸 피해서 짜 볼게.',
      chips: [
        { kind: 'say', label: '폰을 봤어' },
        { kind: 'say', label: '너무 어려웠어' },
        { kind: 'say', label: '피곤했어' },
      ],
      showHelp: false,
    }
  }
  if (hasAny(text, ['다 했', '했어', '끝냈'])) {
    return {
      text: '잘했어! 오늘 한 만큼 기록에 쌓였어. 내일도 이 시간에 내가 먼저 말 걸게.',
      chips: [],
      showHelp: false,
    }
  }
  if (hasAny(text, ['폰', '어려웠'])) {
    return {
      text: '알려 줘서 고마워. 다음 세션은 폰을 엎어 두고 한 장만 끝까지 해 보자. 들면 내가 바로 알려 줄게.',
      chips: [startChip(context.card)],
      showHelp: false,
    }
  }
  if (hasAny(text, ['좋아', '시작', '할래', '할게', '응'])) {
    return {
      text: '좋아! 타이머 켜고 폰은 엎어 두자. 끝나면 결과 들고 와.',
      chips: [startChip(context.card)],
      showHelp: false,
    }
  }
  return {
    text: '그렇구나. 그럼 오늘 할 공부를 같이 정해 볼까? 내가 먼저 짜 볼게.',
    chips: [PLAN_CHIP, startChip(context.card), { kind: 'say', label: '오늘은 쉴래' }],
    showHelp: false,
  }
}

// ---- 대화방 3개 · [이야기하기] 주제 (2026-10-18 저녁, #582) ----

/**
 * [이야기하기] 로 연 대화의 시연용 첫 말. 진짜 로그인은 서버 AI 가 사실 줄을 보고 첫 말을 씁니다.
 *
 *   demoTopicOpener('CARD_FAIL') -> { text: '괜찮아, 못 한 날도 기록이 돼. …', chips: [미루다 보니, …] }
 */
export function demoTopicOpener(kind: ChatAboutKind): CoachMessage {
  const say = (label: string): CoachChip => ({ kind: 'say', label })
  switch (kind) {
    case 'SESSION_REVIEW':
      return {
        text: '방금 공부 수고했어! 어땠어? 다 못 한 게 있으면 왜 그랬는지도 편하게 말해 줘.',
        chips: [say('폰을 자꾸 봤어'), say('너무 어려웠어'), say('피곤했어'), say('잘 됐어')],
      }
    case 'CARD_FAIL':
      return {
        text: '괜찮아, 못 한 날도 기록이 돼. 뭐 때문에 못 했는지 말해 줄래? 탓하려는 게 아니라 다음 계획에 쓰려고.',
        chips: [say('미루다 보니 못 했어'), say('너무 피곤했어'), say('갑자기 약속이 생겼어')],
      }
    case 'WEEKLY_REPORT':
      return {
        text: '이번 주 숫자 같이 봤어. 제일 아쉬운 숫자 하나만 골라 볼까? 다음 주에 바꿀 걸 하나만 정하자.',
        chips: [say('정시 시작이 아쉬워'), say('체크리스트가 아쉬워'), LONG_PLAN_CHIP],
      }
    case 'QUIZ_WRONG':
      return {
        text: '틀린 문제 같이 보자. 정답부터 말하기 전에, 왜 그 답을 골랐는지 먼저 말해 줄래?',
        chips: [say('헷갈려서 찍었어'), say('공식을 잘못 떠올렸어'), say('문제를 잘못 읽었어')],
      }
    case 'PSYCH_RESULT':
      return {
        text: '검사 결과 봤어. 결과 중에 "이건 진짜 나다" 싶은 게 있어? 아니면 "이건 아닌데" 싶은 거라도.',
        chips: [say('시작이 어려운 건 맞아'), say('폰에 잘 흔들려'), say('잘 모르겠어')],
      }
    case 'DAY_REVIEW':
      return {
        text: '이 날 기록 같이 볼까? 그날 뭐가 제일 잘 됐고, 뭐가 제일 아쉬웠어?',
        chips: [say('잘 된 게 있었어'), say('아쉬운 게 더 많아')],
      }
    case 'SCHEDULE_ADJUST':
      return {
        text: '최근 며칠 계획한 시각에 시작하기 어려웠구나. 탓하려는 게 아니야. 시작 시각을 옮기거나 양을 줄여 보면 지키기 쉬워질 수 있어. 어느 쪽이 나을 것 같아?',
        chips: [say('시작 시각을 옮기고 싶어'), say('양을 줄이고 싶어'), PLAN_CHIP],
      }
  }
}

/** 학생 말의 낱말로 이유 값을 짐작합니다. (시연용. 진짜 로그인은 서버 AI 가 짐작) */
const REVIEW_WORDS: [string, string[]][] = [
  ['phone', ['폰', 'sns', 'SNS', '유튜브', '인스타', '카톡', '게임']],
  ['tired', ['피곤', '졸', '잠']],
  ['stuck', ['어려', '막혔', '막혀', '모르겠', '이해가']],
  ['mindWander', ['딴생각', '집중이 안']],
  ['tooMuch', ['많았', '양이', '너무 많']],
  ['external', ['엄마', '아빠', '동생', '시끄', '가족', '불러']],
]
const FAIL_WORDS: [string, string[]][] = [
  ['procrastinated', ['미루', '미뤘', '나중에']],
  ['tired', ['피곤', '졸', '잠']],
  ['sick', ['아파', '아팠', '두통', '감기']],
  ['event', ['약속', '행사', '모임', '학원']],
  ['tooMuch', ['많았', '양이', '너무 많']],
  ['phone', ['폰', 'sns', 'SNS', '유튜브', '게임']],
  ['unwilling', ['하기 싫', '귀찮']],
]

/**
 * 시연용 이유 짐작
 *   guessDemoTags('SESSION_REVIEW', '폰 보다가 졸렸어') -> ['phone', 'tired']
 *   guessDemoTags('CARD_FAIL', '미루다 보니')          -> ['procrastinated']
 */
export function guessDemoTags(kind: 'SESSION_REVIEW' | 'CARD_FAIL', text: string): string[] {
  const table = kind === 'SESSION_REVIEW' ? REVIEW_WORDS : FAIL_WORDS
  return table
    .filter(([, words]) => hasAny(text, words))
    .map(([value]) => value)
    .slice(0, 3)
}

/** 과목 쌤 방의 시연용 답 */
function tutorDemo(text: string, hasPhoto: boolean): DemoReply {
  if (hasPhoto) {
    return {
      text: '사진 받았어! (시연용 답이라 사진을 실제로 읽지는 않아) 이 문제 어디까지 풀어 봤어? 막힌 줄을 말해 주면 거기서부터 같이 볼게.',
      chips: [
        { kind: 'say', label: '처음부터 모르겠어' },
        { kind: 'say', label: '중간에 막혔어' },
      ],
      showHelp: false,
    }
  }
  if (hasAny(text, ['찍', '헷갈', '잘못'])) {
    return {
      text: '그럴 수 있어. 그럼 보기를 하나씩 지워 보자. 확실히 아닌 보기부터 골라 볼래? 왜 아닌지도 한 줄로.',
      chips: [{ kind: 'say', label: '정답 설명해 줘' }, QUIZ_CHIP],
      showHelp: false,
    }
  }
  if (hasAny(text, ['모르', '이해', '설명', '처음부터'])) {
    return {
      text: '좋아, 같이 보자. 먼저 네가 아는 데까지 말해 줄래? 예를 들어 이 단원의 정의는 기억나? 거기서부터 한 단계씩 갈게.',
      chips: [
        { kind: 'say', label: '정의부터 설명해 줘' },
        { kind: 'say', label: '예시 문제 줘' },
      ],
      showHelp: false,
    }
  }
  return {
    text: '어느 과목 · 단원이야? 모르는 문제를 적어 주거나 📎 로 사진을 보내 줘. 다 보고 나면 비슷한 문제로 확인해 볼게.',
    chips: [{ kind: 'pickPhoto', label: '📎 문제 사진 보내기' }, QUIZ_CHIP],
    showHelp: false,
  }
}

/** 📅 계획 방의 시연용 답. 계획을 짜 달라는 말은 칩으로, 큰 목표는 WOOP(바람 → 최고의 결과 → 걸림돌 → 걸림돌이 오면 할 행동)로 */
function plannerDemo(text: string): DemoReply {
  if (hasAny(text, ['점검', '이번 주'])) {
    return {
      text: '좋아, 이번 주 같이 보자. 통계 탭 AI 분석에서 [📅 AI 분석 같이 볼래] 를 누르면 내 숫자를 들고 와서 볼 수 있어. 다음 주에 바꿀 걸 하나만 정하자.',
      chips: [PLAN_CHIP, { kind: 'say', label: '정시 시작이 아쉬워' }],
      showHelp: false,
    }
  }
  if (hasAny(text, ['폰', '걸림', '방해', '미루', '귀찮'])) {
    return {
      text: '그게 걸림돌이구나. 그게 오면 할 행동을 "만약 ~하면 → ~한다" 로 정해 두자. 예: 만약 폰이 보고 싶으면 → 폰을 엎고 5분만 더 한다. 그다음 날짜까지 계획으로 나눠 줄게.',
      chips: [LONG_PLAN_CHIP, { kind: 'say', label: '그렇게 해 볼게' }],
      showHelp: false,
    }
  }
  if (hasAny(text, ['등급', '점수', '합격', '대회', '자격증', '1등'])) {
    return {
      text: '멋진 목표야! 그걸 이루면 뭐가 제일 좋을 것 같아? 그다음엔 가장 큰 걸림돌을 같이 찾고, 날짜까지 계획으로 나누자.',
      chips: [
        { kind: 'say', label: '자신감이 생길 것 같아' },
        { kind: 'say', label: '걸림돌은 폰이야' },
      ],
      showHelp: false,
    }
  }
  if (hasAny(text, ['목표', '세우'])) {
    return {
      text: '좋아! 이루고 싶은 걸 한 줄로 말해 줘. 예: "11월 중간고사 수학 2등급", "정보올림피아드 본선".',
      chips: [
        { kind: 'say', label: '중간고사 수학 2등급' },
        { kind: 'say', label: '정보올림피아드 본선' },
      ],
      showHelp: false,
    }
  }
  return {
    text: '좋아, 계획으로 같이 정리해 보자. 오늘 계획부터 짤까, 시험 · 대회 날까지 길게 짤까?',
    chips: [PLAN_CHIP, LONG_PLAN_CHIP, { kind: 'say', label: '🎯 목표 세우기' }],
    showHelp: false,
  }
}

/**
 * 대화방 · 주제에 맞는 시연용 답. 위기 표현이 먼저이고, 후기 · 못 한 카드 대화면 이유를 짐작해 "맞아?" 로 묻습니다.
 *
 *   replyDemoInRoom({ room: 'coach', topicKind: 'SESSION_REVIEW', text: '폰 보다가 졸렸어', hasPhoto: false, context })
 *     -> { text: '그랬구나. 이유를 이렇게 적어 둘까?', chips: [], showHelp: false, tags: ['phone', 'tired'] }
 */
export function replyDemoInRoom(input: {
  room: ChatRoomId
  topicKind: ChatAboutKind | null
  text: string
  hasPhoto: boolean
  context: DemoContext
}): DemoReply {
  const text = input.text.trim()
  const crisis = crisisReply(text)
  if (crisis) return crisis
  if (input.topicKind === 'SESSION_REVIEW' || input.topicKind === 'CARD_FAIL') {
    const tags = guessDemoTags(input.topicKind, text)
    if (tags.length > 0) {
      return {
        text: '그랬구나, 말해 줘서 고마워. 이유를 이렇게 적어 둘까? 다음 계획 짤 때 이걸 피해서 짜 볼게.',
        chips: [],
        showHelp: false,
        tags,
      }
    }
  }
  if (input.room === 'tutor' || input.topicKind === 'QUIZ_WRONG') {
    return tutorDemo(text, input.hasPhoto)
  }
  if (input.room === 'plan') return plannerDemo(text)
  return replyDemo(text, input.context)
}
