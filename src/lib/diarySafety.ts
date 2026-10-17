/**
 * 글을 저장할 때, 도움 연결 안내(위기 표현·기분 저하)를 보여줘야 하는지 판단합니다. (#95)
 * 일기·성찰 일기·체크인·주간 회고·시험 회고·집중 모드 해제 이유를 저장할 때 씁니다.
 *
 * 안전 브레이크(getSafetyBrakeResult)에 "방금 쓴 글" 과 "최근 기분 기록" 을 넘겨서 showHelp 를 확인합니다.
 * 최근 기분 기록은 매일 체크인(#24)에 저장된 기분과, 호출하는 쪽이 넘겨 주는 일기 기분을 합쳐서 씁니다.
 */
import { loadExams } from '@/lib/exams'
import { getSafetyBrakeResult, type ExamDateInput, type MoodRecordInput } from '@/lib/safetyBrake'
import { loadData } from '@/lib/storage'
import { loadWeeklyReviews } from '@/lib/weeklyReview'
import type { CheckIn, DiaryEntry, ReflectionEntry } from '@/types'

/**
 * 날짜별로 저장된 기록({ '2026-09-28': {...} } 모양)을 배열로 꺼냅니다.
 * 저장된 값이 깨져 있거나 객체가 아니면 빈 배열을 돌려줍니다.
 */
function loadEntries<T>(key: string): T[] {
  const saved = loadData<unknown>(key, {})
  if (typeof saved !== 'object' || saved === null) return []
  return Object.values(saved as Record<string, T>)
}

/** 저장해 둔 체크인에서 날짜·기분만 꺼냅니다. (저장 이름은 useCheckIns 의 'checkins' 와 같습니다) */
function loadCheckInMoods(): MoodRecordInput[] {
  const checkIns = loadEntries<CheckIn>('checkins')
  return checkIns.map((checkIn) => ({ date: checkIn.date, mood: checkIn.mood }))
}

/** 글자만 남깁니다. 저장된 값이 깨져서 글자가 아니면 빈 글자로 봅니다. */
function textOf(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/** 집중 모드를 직접 풀 때 적은 이유들 (자동으로 풀린 안내 문구는 뺍니다). 저장 이름은 focusMode.ts 와 같습니다. */
function loadUnlockReasons(): string[] {
  const saved = loadData<unknown>('focus-unlocks', [])
  if (!Array.isArray(saved)) return []
  return saved
    .filter((record) => typeof record === 'object' && record !== null && record.isAuto !== true)
    .map((record) => textOf((record as Record<string, unknown>).reason))
}

/**
 * 지금까지 저장된 글과 기분을 모두 모아서 돌려줍니다. (알림을 보내기 전 안전 브레이크 확인용)
 *
 * - 체크인(#24): 기분 + 오늘의 약속 글 + 못 채운 이유 '기타' 에 적은 한 줄
 * - 일기(#63): 기분 + 일기 원문 (저장 이름 'diary', useDiaryEntries 와 같습니다)
 * - 성찰 일기(#70): 답변 글 (저장 이름 'reflection-entries', useReflectionEntries 와 같습니다)
 * - 주간 회고(#82) · 시험 회고(#80) · 집중 모드 해제 이유(#69): 적은 글
 */
export function loadSavedWritings(): { texts: string[]; moods: MoodRecordInput[] } {
  const checkIns = loadEntries<CheckIn>('checkins')
  const diaries = loadEntries<DiaryEntry>('diary')
  const reflections = loadEntries<ReflectionEntry>('reflection-entries')

  return {
    texts: [
      ...checkIns.flatMap((checkIn) => [
        textOf(checkIn.promiseIf),
        textOf(checkIn.promiseThen),
        textOf(checkIn.missReasonNote),
      ]),
      ...diaries.map((diary) => diary.content ?? ''),
      ...reflections.flatMap((reflection) => reflection.answers ?? []),
      ...loadWeeklyReviews().flatMap((review) => [review.best, review.regret, review.change]),
      ...loadExams().flatMap((exam) => [
        textOf(exam.reflection?.regret),
        textOf(exam.reflection?.nextChange),
      ]),
      ...loadUnlockReasons(),
    ],
    moods: [
      ...checkIns.map((checkIn) => ({ date: checkIn.date, mood: checkIn.mood })),
      ...diaries.map((diary) => ({ date: diary.date, mood: diary.mood })),
    ],
  }
}

/**
 * 저장해 둔 시험(#80)에서 날짜만 꺼냅니다. 안전 브레이크가 "시험 직전 3일·직후 2일" 을 판단하는 데 씁니다.
 * (시험 기간이면 examPeriod 가 켜져서 3단계 이상 채찍 메시지가 멈춥니다 — 상한 2단계, #384)
 */
export function loadExamDates(): ExamDateInput[] {
  return loadExams().map((exam) => ({ date: exam.date }))
}

/**
 * 방금 쓴 글에 위기 표현이 있거나 기분이 오래 낮으면 true 를 돌려줍니다.
 *
 *   const needsHelp = shouldShowCrisisHelp({ texts: [content], diaryMoods: [{ date, mood }] })
 *
 * - texts: 방금 쓴 글 원문들 (성찰 일기는 답변 여러 개)
 * - diaryMoods: 일기에 적은 기분 기록들 (오늘 고른 기분 포함). 없으면 빈 배열
 */
export function shouldShowCrisisHelp(input: {
  texts: string[]
  diaryMoods: MoodRecordInput[]
}): boolean {
  const brake = getSafetyBrakeResult({
    now: new Date(),
    recentTexts: input.texts,
    recentMoods: [...loadCheckInMoods(), ...input.diaryMoods],
    // 도움 안내(showHelp)는 위기 표현·기분 저하로만 정해지고 시험 기간에는 영향받지 않아서 시험은 넘기지 않습니다.
    exams: [],
  })
  return brake.showHelp
}
