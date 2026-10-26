/**
 * 안전 브레이크(lib/safetyBrake.ts 의 getSafetyBrakeResult)에 넘길 "저장해 둔 글 · 기분 · 시험 날짜" 를 꺼냅니다. (#95)
 * 위기 표현이나 기분 저하가 보이면 독촉·채찍을 멈추는 데 씁니다. (알림 · 전화 · 집중 모드 · 통화 카드)
 *
 * 글을 저장할 때 도움 안내 화면으로 보내던 shouldShowCrisisHelp 는 2026-10-18 에 지웠습니다. (전용 도움 화면 삭제)
 */
import { hasRecentCrisisSignal } from '@/lib/crisisSignal'
import { loadExams } from '@/lib/exams'
import type { ExamDateInput, MoodRecordInput } from '@/lib/safetyBrake'
import { loadSchoolExamDates } from '@/lib/schoolEvents'
import { loadData } from '@/lib/storage'
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
 * - 체크인(#24): 기분 + 못 채운 이유 '기타' 에 적은 한 줄
 * - 일기(#63): 기분 + 일기 원문 (저장 이름 'diary', useDiaryEntries 와 같습니다)
 * - 성찰 일기(#70): 답변 글 (저장 이름 'reflection-entries', useReflectionEntries 와 같습니다)
 * - 시험 회고(#80) · 집중 모드 해제 이유(#69): 적은 글
 * - crisisFlagged: 채팅은 글을 이 기기에서 검사하지 않고 서버가 검사합니다. 서버가 최근 7일 안에
 *   위기라고 알려 줬으면 true 입니다. (lib/crisisSignal.ts) 안전 브레이크의 crisisFlagged 에 그대로 넘깁니다.
 */
export function loadSavedWritings(): {
  texts: string[]
  moods: MoodRecordInput[]
  crisisFlagged: boolean
} {
  const checkIns = loadEntries<CheckIn>('checkins')
  const diaries = loadEntries<DiaryEntry>('diary')
  const reflections = loadEntries<ReflectionEntry>('reflection-entries')

  return {
    texts: [
      ...checkIns.map((checkIn) => textOf(checkIn.missReasonNote)),
      ...diaries.map((diary) => diary.content ?? ''),
      ...reflections.flatMap((reflection) => reflection.answers ?? []),
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
    crisisFlagged: hasRecentCrisisSignal(Date.now()),
  }
}

/**
 * 학교 학사일정(NEIS)에서 받아 둔 시험 날짜를 꺼냅니다. 안전 브레이크가 "시험 직전 3일·직후 2일" 을 판단하는 데 씁니다.
 * (시험 기간이면 examPeriod 가 켜져서 3단계 이상 채찍 메시지가 멈춥니다 — 상한 2단계, #384)
 * 학생이 직접 적던 시험 기록(#80)은 2026-10-18 에 지웠습니다. 학사일정은 카드 탭의 학교 일정 칸이 받아 옵니다.
 */
export function loadExamDates(): ExamDateInput[] {
  return loadSchoolExamDates().map((date) => ({ date }))
}
