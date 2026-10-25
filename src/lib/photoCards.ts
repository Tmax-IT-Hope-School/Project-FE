/**
 * "시험 범위 사진 → 공부 카드" 의 함수들입니다. 화면은 pages/CardsFromPhotoPage.tsx 입니다. (2026-10-18)
 *
 * 학생이 시험 범위표 · 학습지를 찍거나 앨범에서 고르면, 사진을 줄여서 서버에 보내고 AI 가 만든 카드 초안을 받습니다.
 *
 * 서버와 정한 약속 (BE POST /api/v1/ai/cards/from-photo, 로그인 필요)
 *   요청 { image: 'data:image/jpeg;base64,…', date: '2026-10-18', examDate: '2026-11-02' | null, note: '1~3단원' | null }
 *   응답 200 { showHelp, drafts: Draft[] | null, durationEvidence, scopeText }
 *     - drafts 가 null 이면 AI 가 못 만든 것 (AI 꺼짐 · 하루 한도 · 범위표가 아닌 사진). 에러가 아니라 200 입니다.
 *     - 카드 날짜는 date ~ 시험 전날에 나눠 줍니다. 시험 날짜가 없으면 2주. 초안은 14장까지.
 *   400 = 사진 모양 · 종류 · 너무 큼(4MB) · 날짜가 이상함
 *
 * ⚠️ 사진은 어디에도 저장하지 않습니다. 브라우저 저장소에도 넣지 않고, 서버도 AI 에 보낸 뒤 버립니다.
 *    남는 것은 학생이 골라서 저장한 카드뿐입니다.
 */
import { api, ApiError } from '@/lib/api'
import type { Card } from '@/types'

/** 줄인 사진의 긴 변 (px). 글씨를 읽을 수 있을 만큼만 남기고 크기를 줄입니다. */
const MAX_SIDE = 1600
/** JPEG 품질 (0 ~ 1) */
const JPEG_QUALITY = 0.8
/** AI 가 사진을 읽는 데 시간이 걸려서 넉넉하게 기다립니다. */
const REQUEST_TIMEOUT_MS = 40_000

/** AI 가 만든 카드 초안 한 장 (서버의 CardParseResponse.Draft 와 같은 모양) */
export interface PhotoCardDraft {
  /** 'YYYY-MM-DD' */
  date: string
  /** 'HH:MM'. null 이면 AI 가 시각을 정하지 못한 것이라 화면에서 고르게 합니다. */
  startTime: string | null
  durationMinutes: number
  title: string
  checklist: string[]
  /** 서버가 고른 내 과목 번호 (하루 계획, BE #457). 없으면 카드도 과목 없이 만듭니다 */
  subjectId?: string
}

export interface PhotoCardsResult {
  /** true 면 사진의 글에 위기 표현이 있어서 AI 를 쓰지 않은 것입니다. */
  showHelp: boolean
  /** null 이면 AI 가 만들지 못한 것입니다. */
  drafts: PhotoCardDraft[] | null
  /** AI 가 읽은 시험 범위 한 줄 (예: '미적분Ⅰ 3~4단원 · 문학 …'). 없으면 null */
  scopeText: string | null
}

/**
 * 고른 사진을 긴 변 1600px · JPEG 로 줄여 data URL 로 돌려줍니다. 폰 사진(3~12MB)이 보통 0.3~0.7MB 가 됩니다.
 * 사진이 아니거나 읽지 못하면 에러를 던집니다.
 */
export async function shrinkPhoto(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('사진 파일만 고를 수 있어요.')
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  const context = canvas.getContext('2d')
  if (context === null) throw new Error('이 브라우저에서는 사진을 줄일 수 없어요.')
  // 투명한 PNG 도 글씨가 보이게 흰 바탕을 먼저 칠합니다.
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  return canvas.toDataURL('image/jpeg', JPEG_QUALITY)
}

function isText(value: unknown): value is string {
  return typeof value === 'string'
}

/**
 * 서버가 준 초안 하나를 확인합니다. 모양이 틀리면 null (서버 응답도 그대로 믿지 않습니다)
 * 코치의 계획 말풍선(lib/coachPlan.ts)도 같은 모양의 초안을 받아서 이 함수로 확인합니다.
 */
export function toDraft(value: unknown): PhotoCardDraft | null {
  if (typeof value !== 'object' || value === null) return null
  const draft = value as Record<string, unknown>
  if (!isText(draft.date) || !/^\d{4}-\d{2}-\d{2}$/.test(draft.date)) return null
  if (!isText(draft.title) || draft.title.trim() === '') return null
  const minutes = draft.durationMinutes
  if (typeof minutes !== 'number' || !Number.isFinite(minutes) || minutes < 5) return null
  const startTime =
    isText(draft.startTime) && /^\d{2}:\d{2}$/.test(draft.startTime) ? draft.startTime : null
  const checklist = Array.isArray(draft.checklist)
    ? draft.checklist.filter(isText).map((item) => item.trim())
    : []
  return {
    date: draft.date,
    startTime,
    durationMinutes: Math.min(180, Math.round(minutes)),
    title: draft.title.trim().slice(0, 40),
    checklist: checklist.filter((item) => item !== '').slice(0, 8),
    // 서버 과목 번호는 숫자 글자입니다. 모양이 틀리면 버립니다.
    ...(isText(draft.subjectId) && /^\d{1,18}$/.test(draft.subjectId)
      ? { subjectId: draft.subjectId }
      : {}),
  }
}

/** 시험 범위 사진을 보내 카드 초안을 받습니다. (진짜 로그인일 때만 부릅니다) */
export async function requestCardsFromPhoto(input: {
  image: string
  date: string
  examDate: string | null
  note: string | null
}): Promise<PhotoCardsResult> {
  const result = await api<unknown>('/ai/cards/from-photo', {
    method: 'POST',
    body: JSON.stringify(input),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  if (typeof result !== 'object' || result === null) {
    throw new ApiError('서버 응답 모양이 올바르지 않습니다', 502)
  }
  const record = result as Record<string, unknown>
  const drafts = Array.isArray(record.drafts)
    ? record.drafts.map(toDraft).filter((draft): draft is PhotoCardDraft => draft !== null)
    : null
  return {
    showHelp: record.showHelp === true,
    drafts,
    scopeText: isText(record.scopeText) && record.scopeText.trim() !== '' ? record.scopeText : null,
  }
}

/** 'YYYY-MM-DD' 에 며칠을 더합니다. */
function addDays(dateKey: string, days: number): string {
  const [year, month, day] = dateKey.split('-').map(Number)
  const date = new Date(year, month - 1, day + days)
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const dd = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${mm}-${dd}`
}

/**
 * 테스트 로그인(서버 없음) 시연용 정해진 초안입니다. 화면에 "시연용 예시" 라고 붙입니다.
 * 날짜는 오늘부터 하루씩 나눕니다.
 */
export function getDemoPhotoCards(todayKey: string): PhotoCardsResult {
  return {
    showHelp: false,
    scopeText: '2학기 2차 정기시험 범위 — 미적분Ⅰ 3~4단원 · 문학 작품 3개 · 영어Ⅰ 4~5과',
    drafts: [
      {
        date: todayKey,
        startTime: '19:00',
        durationMinutes: 30,
        title: '미적분Ⅰ 3단원 개념 정리',
        checklist: ['교과서 개념 다시 읽기', '예제 5개 풀기'],
      },
      {
        date: addDays(todayKey, 1),
        startTime: '19:00',
        durationMinutes: 40,
        title: '미적분Ⅰ 4단원 문제 풀기',
        checklist: ['문제집 42~45쪽', '틀린 문제 표시'],
      },
      {
        date: addDays(todayKey, 2),
        startTime: '20:00',
        durationMinutes: 30,
        title: '문학 작품 3개 다시 읽기',
        checklist: ['작품별 주제 한 줄 쓰기', '선생님 필기 확인'],
      },
      {
        date: addDays(todayKey, 3),
        startTime: null,
        durationMinutes: 25,
        title: '영어Ⅰ 4~5과 본문 암기',
        checklist: ['4과 본문 소리 내어 읽기', '5과 단어 30개'],
      },
    ],
  }
}

/**
 * 고른 초안을 카드로 바꿉니다. 시각이 없으면 startTime 으로 받은 값을 씁니다.
 * 나머지 칸(우선순위 · 유형 · 알림)은 카드 만들기 화면의 기본값과 같습니다. (lib/cardForm.ts 의 createEmptyForm)
 */
export function draftToCard(
  draft: PhotoCardDraft,
  options: { id: string; now: number; startTime: string },
): Card {
  const checklistTexts = draft.checklist.length > 0 ? draft.checklist : [draft.title]
  return {
    id: options.id,
    title: draft.title,
    date: draft.date,
    startTime: draft.startTime ?? options.startTime,
    durationMinutes: draft.durationMinutes,
    checklist: checklistTexts.map((text, index) => ({ id: `${options.id}-item-${index}`, text })),
    priority: 'flexible',
    type: 'self',
    expectedDone: checklistTexts.length,
    alert: { method: 'message', minutesBefore: 0 },
    planningMs: 0,
    createdAt: options.now,
    // 과목이 있어야 이 카드로 한 공부가 통계에서 "삭제된 과목" 으로 뜨지 않습니다. (#746)
    ...(draft.subjectId ? { subjectId: draft.subjectId } : {}),
  }
}
