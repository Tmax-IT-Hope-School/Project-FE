/**
 * 어떤 설정보다 먼저 적용되는 안전 규칙을 판정하는 순수 함수입니다. (기획서 v2 5장)
 *
 * 1차 타겟이 미성년자라서, 아래 4가지는 관리 강도·알림 설정보다 항상 우선합니다.
 * React 를 쓰지 않는 순수 함수라서 같은 입력이면 항상 같은 결과가 나옵니다.
 *
 * 타입 입력 중 CheckIn(#24·#78), Exam(#80) 이 아직 없어서, 지금은 이 함수가 필요한
 * 만큼만(날짜·기분, 날짜) 받는 최소 모양으로 받습니다. 그 타입들이 생기면 이 입력
 * 타입을 지우고 그쪽을 바로 쓰도록 바꾸면 됩니다.
 */

import { toDayKey } from '@/lib/date'

/** 연락 금지 시간. 시작·끝 모두 0~23 시 */
export interface QuietHours {
  /** 시작 시각 (시). 예: 23 */
  startHour: number
  /** 끝나는 시각 (시). 예: 7 */
  endHour: number
  /** 시작 시각의 분. 예: 22:30 이면 30. 없으면 0(정각) 입니다 */
  startMinute?: number
  /** 끝나는 시각의 분. 예: 07:30 이면 30. 없으면 0(정각) 입니다 */
  endMinute?: number
}

/** 시험 날짜만 받는 최소 모양. (Exam 타입은 #80 이 끝나면 생깁니다) */
export interface ExamDateInput {
  date: string
}

/** 기분 기록 날짜·점수만 받는 최소 모양. (CheckIn 타입은 #24·#78 이 끝나면 생깁니다) */
export interface MoodRecordInput {
  date: string
  /** 1(많이 처짐) ~ 5(아주 좋음) */
  mood: number
}

export interface SafetyBrakeInput {
  /** 지금 시각 */
  now: Date
  /** 최근에 쓴 글 원문 (일기·체크인 등 여러 글을 한 번에 넘깁니다) */
  recentTexts: string[]
  /** 최근 기분 기록 (순서는 상관없습니다) */
  recentMoods: MoodRecordInput[]
  /** 등록된 시험 목록 (#80) */
  exams: ExamDateInput[]
  /** 연락 금지 시간. 안 넘기면 기본값(DEFAULT_QUIET_HOURS, 23시~7시)을 씁니다. (#60) */
  quietHours?: QuietHours
  /**
   * 글 말고 다른 곳에서 온 위기 신호. true 면 글에 위기 표현이 없어도 위기로 봅니다.
   * 채팅에서 서버가 위기를 감지했거나 보호 조치 메시지를 보냈을 때입니다. (lib/crisisSignal.ts)
   */
  crisisFlagged?: boolean
}

export interface SafetyBrakeResult {
  /** 모든 채찍을 즉시 중지해야 하면 true (위기 표현을 감지했을 때만) */
  stopWhip: boolean
  /** 채찍 대신 회복 모드로 가야 하면 true (위기 표현 · 기분 저하 중 하나라도) */
  recoveryMode: boolean
  /**
   * 시험 직전 3일 ~ 직후 2일이면 true. 이 기간은 회복 모드가 아니라 **관리 단계 상한 2** 입니다.
   * (최종 기획서 「4.5 안전 브레이크」: "시험 직전 3일과 직후 2일은 채찍 상한이 2단계", #384)
   */
  examPeriod: boolean
  /** 도움 연결 안내(#96)를 보여줘야 하면 true */
  showHelp: boolean
  /** 지금은 메시지·전화를 하면 안 되면 true (연락 금지 시간) */
  quiet: boolean
}

/**
 * 위기 표현 목록입니다. 글자 포함 검사로 시작하고, 더 정확한 감지는 서버(AI)에서
 * 한 번 더 합니다. 이 목록은 Tmax-IT-Hope-School/Project#8 검토 결과로 바뀔 수 있어서
 * 상수 배열로 한 곳에 모아 둡니다. (목록을 바꾸고 싶으면 여기만 고치면 됩니다)
 *
 * ■ 적는 규칙
 * - 띄어쓰기 없이 적습니다. 검사할 때 글의 띄어쓰기를 모두 지우고 비교하기 때문입니다.
 * - 끝의 어미(다 · 어 · 었어 …)는 빼고 적습니다.
 *   '죽고싶' 하나로 '죽고 싶다' · '죽고싶어' · '죽고 싶었어' 를 모두 잡습니다.
 * - 놓치는 것보다 한 번 더 안내하는 쪽이 안전합니다. 그래서 '죽고 싶지는 않아' 처럼 부정하는 말도 잡힙니다.
 * - 서버(BE CrisisText)와 같은 목록 · 같은 규칙입니다. 한쪽을 고치면 다른 쪽도 같이 고칩니다.
 */
export const CRISIS_KEYWORDS = [
  '죽고싶',
  '사라지고싶',
  '그만살고싶',
  '살고싶지않',
  '살기싫',
  '자살',
  '자해',
  '극단적선택',
  '극단적인선택',
]

/** 연락 금지 시간 기본값. #60(AI 메시지 빈도 설정)이 아직 없어서 기본값만 둡니다. */
export const DEFAULT_QUIET_HOURS: QuietHours = { startHour: 23, endHour: 7 }

// 기분이 몇 점부터 "저하"인지 (1~5 중 2 이하)
const LOW_MOOD_THRESHOLD = 2
// "5일 넘게" 이어져야 하므로, 오늘을 포함해 6일 연속을 봅니다.
const LOW_MOOD_STREAK_DAYS = 6
// 시험 전/후 며칠을 "시험 기간"으로 볼지
const EXAM_DAYS_BEFORE = 3
const EXAM_DAYS_AFTER = 2

/** Date 를 'YYYY-MM-DD' 모양으로 만듭니다. (toISOString() 은 영국 시간 기준이라 쓰지 않습니다) */
function toDateKey(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

/** 'YYYY-MM-DD' 날짜에서 days 일 만큼 이동한 날짜를 돌려줍니다. */
function moveDateKey(dateKey: string, days: number): string {
  const [year, month, day] = dateKey.split('-').map(Number)
  return toDateKey(new Date(year, month - 1, day + days))
}

/** fromKey 부터 toKey 까지 며칠째인지 셉니다. (같은 날이면 1일째) */
function countDays(fromKey: string, toKey: string): number {
  const [fromYear, fromMonth, fromDay] = fromKey.split('-').map(Number)
  const [toYear, toMonth, toDay] = toKey.split('-').map(Number)
  const msPerDay = 24 * 60 * 60 * 1000
  const diffMs =
    new Date(toYear, toMonth - 1, toDay).getTime() -
    new Date(fromYear, fromMonth - 1, fromDay).getTime()
  return Math.round(diffMs / msPerDay) + 1
}

/** 낱말 사이에서 우연히 만들어질 수 있는 짧은 표현. 아래 ① · ② 규칙은 이 둘에만 씁니다. */
const JOIN_PRONE_KEYWORDS = ['자살', '자해']

/**
 * at 자리의 '자살' · '자해' 가 낱말 사이에서 우연히 만들어진 것인지 봅니다.
 *   ① '혼자' 뒤에 살 · 해 가 붙은 것            '혼자 해냈다'(혼자해냈다) · '혼자 살기'   -> true
 *   ② '자' 가 앞 낱말의 끝이고, 띄어 쓴 다음 낱말이 살 · 해 로 시작  '과자 살래' · '하자 해서' -> true
 *   '혼자 자해' 의 두 번째 '자' 는 앞에 빈칸이 있어서 한 낱말입니다                      -> false (위기)
 * spaceBefore[i] 는 붙여 쓴 글의 i 번째 글자 바로 앞에 빈칸이 있었는지입니다.
 */
function isJoinedByChance(
  compactText: string,
  spaceBefore: boolean[],
  keyword: string,
  at: number,
): boolean {
  if (!JOIN_PRONE_KEYWORDS.includes(keyword) || at === 0) return false
  if (compactText[at - 1] === '혼') return true
  return !spaceBefore[at] && spaceBefore[at + 1]
}

/** 글 하나에 목록의 표현이 들어 있는지 봅니다. */
function containsCrisisKeyword(text: string): boolean {
  // 빈칸(띄어쓰기 · 줄바꿈 · 탭)을 전부 지워서 붙여 씁니다. 지우면서 글자마다 앞에 빈칸이 있었는지 적어 둡니다.
  let compactText = ''
  const spaceBefore: boolean[] = []
  let sawSpace = false
  for (const letter of text.split('')) {
    if (/\s/.test(letter)) {
      sawSpace = true
      continue
    }
    compactText += letter
    spaceBefore.push(sawSpace)
    sawSpace = false
  }

  return CRISIS_KEYWORDS.some((keyword) => {
    // 같은 표현이 여러 번 나올 수 있어서, 나온 자리를 하나씩 다 봅니다.
    let at = compactText.indexOf(keyword)
    while (at !== -1) {
      if (!isJoinedByChance(compactText, spaceBefore, keyword, at)) return true
      at = compactText.indexOf(keyword, at + 1)
    }
    return false
  })
}

/**
 * 규칙 1: 위기 표현 검사
 *
 * 띄어쓰기와 줄바꿈을 모두 지운 뒤에 목록의 글자가 들어 있는지 봅니다.
 * 그래서 '죽고 싶다' 와 '죽고싶다' 를 같게 봅니다.
 * 단, 낱말 사이에서 우연히 만들어진 '자살' · '자해' 는 빼 줍니다. (isJoinedByChance)
 * 사용자가 미성년자라서, 진짜 위기 표현을 놓치는 쪽으로는 줄이지 않습니다.
 *
 *   예1) ['오늘 학원에서 힘들었다'] -> false
 *   예2) ['이제 그만 살고 싶다는 생각이 들었다'] -> true ('그만살고싶')
 *   예3) ['죽고싶다'], ['죽고 싶어'], ['사라지고 싶어'], ['자해했어'], ['극단적 선택'] -> 모두 true
 *   예4) ['오래오래 살고 싶다'] -> false ('살고싶' 만으로는 잡지 않습니다)
 *   예5) ['숙제를 혼자 해냈다'], ['과자 살래'] -> false   ['혼자 자해했어'], ['자 살 하 고 싶 다'] -> true
 */
export function hasCrisisText(texts: string[]): boolean {
  return texts.some((text) => containsCrisisKeyword(text))
}

/**
 * 규칙 2: 연락 금지 시간 검사. 자정을 넘는 범위(예: 23시~7시)도 처리합니다.
 *
 *   예1) 지금 23시 30분, 23시~7시  -> true (자정을 넘는 범위 안)
 *   예2) 지금 8시,      23시~7시  -> false (범위 밖)
 *   예3) 지금 10시,     9시~18시  -> true (자정을 안 넘는 범위)
 *   예4) 지금 22시 40분, 22:30~07:30 -> true (분까지 봅니다. 예전에는 22시~7시로만 봐서 22:10 도 금지였습니다)
 *   예5) 지금 23시 20분, 23:00~23:45 -> true (같은 "시" 안의 범위도 됩니다)
 *   예6) 시작과 끝이 같은 시각       -> false (금지 시간이 없는 것으로 봅니다)
 */
export function isWithinQuietHours(now: Date, quietHours: QuietHours): boolean {
  // 시와 분을 "자정부터 몇 분째인지" 하나의 숫자로 바꿔서 비교합니다. (23:30 -> 1410)
  const nowMinutes = now.getHours() * 60 + now.getMinutes()
  const startMinutes = quietHours.startHour * 60 + (quietHours.startMinute ?? 0)
  const endMinutes = quietHours.endHour * 60 + (quietHours.endMinute ?? 0)

  if (startMinutes < endMinutes) {
    // 자정을 넘지 않는 범위 (예: 9시 ~ 18시)
    return nowMinutes >= startMinutes && nowMinutes < endMinutes
  }
  // 자정을 넘는 범위 (예: 23시 ~ 7시). 시작과 끝이 같으면(설정 없음) false 입니다.
  return startMinutes !== endMinutes && (nowMinutes >= startMinutes || nowMinutes < endMinutes)
}

/**
 * 규칙 3: 시험 직전 3일 ~ 직후 2일인지 검사.
 *
 *   예1) 오늘이 시험 3일 전  -> true
 *   예2) 오늘이 시험 당일    -> true
 *   예3) 오늘이 시험 2일 후  -> true
 *   예4) 오늘이 시험 4일 전  -> false
 *   예5) 오늘이 시험 3일 후  -> false
 */
function isNearExam(todayKey: string, exams: ExamDateInput[]): boolean {
  return exams.some((exam) => {
    // countDays 는 1일째부터 세므로, -1 을 해서 "시험까지 남은 날"(0 = 오늘)로 바꿉니다.
    const daysUntilExam = countDays(todayKey, exam.date) - 1
    return daysUntilExam <= EXAM_DAYS_BEFORE && daysUntilExam >= -EXAM_DAYS_AFTER
  })
}

/**
 * 규칙 4: 기분 저하가 5일 넘게(= 6일 연속) 이어졌는지 검사.
 * 기록이 없는 날이 하루라도 끼어 있으면 "이어졌다"고 보지 않습니다.
 *
 *   예1) 오늘 포함 6일 모두 기분 1~2  -> true
 *   예2) 오늘 포함 5일만 기분 1~2 (6일째는 기록 없음)  -> false
 *   예3) 6일 중 하루라도 기분 3 이상  -> false
 */
function hasLowMoodStreak(todayKey: string, moods: MoodRecordInput[]): boolean {
  // 같은 날에 기분 기록이 여러 개면(체크인과 일기) 가장 낮은 것을 그날의 기분으로 봅니다.
  // (나중에 적은 것으로 덮어쓰면, 체크인에서 1점을 줬어도 일기의 3점 때문에 "괜찮은 날" 이 됩니다)
  const moodByDate = new Map<string, number>()
  for (const record of moods) {
    const previous = moodByDate.get(record.date)
    moodByDate.set(
      record.date,
      previous === undefined ? record.mood : Math.min(previous, record.mood),
    )
  }

  for (let i = 0; i < LOW_MOOD_STREAK_DAYS; i++) {
    const dateKey = moveDateKey(todayKey, -i)
    const mood = moodByDate.get(dateKey)
    if (mood === undefined || mood > LOW_MOOD_THRESHOLD) return false
  }
  return true
}

/**
 * 안전 브레이크 결과를 계산합니다.
 *
 * #28(관리 강도)의 `isSafetyBrakeOn` 에는 `stopWhip || recoveryMode` 를 넘기면 됩니다.
 *
 *   const brake = getSafetyBrakeResult(input)
 *   getCareLevel({ ..., isSafetyBrakeOn: brake.stopWhip || brake.recoveryMode })
 */
export function getSafetyBrakeResult(input: SafetyBrakeInput): SafetyBrakeResult {
  const todayKey = toDayKey(input.now)
  const quietHours = input.quietHours ?? DEFAULT_QUIET_HOURS

  const crisisDetected = input.crisisFlagged === true || hasCrisisText(input.recentTexts)
  const examIsNear = isNearExam(todayKey, input.exams)
  const moodIsLow = hasLowMoodStreak(todayKey, input.recentMoods)

  return {
    stopWhip: crisisDetected,
    recoveryMode: crisisDetected || moodIsLow,
    examPeriod: examIsNear,
    showHelp: crisisDetected || moodIsLow,
    quiet: isWithinQuietHours(input.now, quietHours),
  }
}
