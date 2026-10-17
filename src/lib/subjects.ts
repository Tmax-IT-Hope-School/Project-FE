import { isServerDataMode } from '@/lib/dataMode'
import { mockSubjects } from '@/lib/mock'
import { queryClient } from '@/lib/queryClient'
import { loadData } from '@/lib/storage'
import type { Subject, SubjectColor } from '@/types'

/**
 * 과목에 쓸 수 있는 색과 그 한국어 이름입니다. 적힌 순서대로 색 고르기 버튼에 보입니다.
 * 서버(BE)가 받는 5가지와 같습니다. (red · orange · green · blue · purple. 나머지 색을 보내면 서버가 400 으로 거절합니다)
 * Record<SubjectColor, ...> 라서, 타입에 색을 더하고 여기에 안 적으면 타입 검사가 바로 알려 줍니다.
 */
export const SUBJECT_COLOR_LABELS: Record<SubjectColor, string> = {
  red: '빨강',
  orange: '주황',
  green: '초록',
  blue: '파랑',
  purple: '보라',
}

/**
 * 쓸 수 있는 색 전체입니다. (위 이름표에 적힌 순서 그대로)
 * 이 밖의 색이 저장돼 있으면 태그 색을 못 찾아서 화면이 깨지기 때문에, 불러올 때 이 목록으로 걸러냅니다.
 */
export const SUBJECT_COLORS = Object.keys(SUBJECT_COLOR_LABELS) as SubjectColor[]

/**
 * 예전에 12가지 색을 쓸 때 저장된 색을, 지금 쓰는 5가지 중 가장 가까운 색으로 바꿉니다.
 *   toSupportedColor('pink')   -> 'red'      toSupportedColor('sky')  -> 'blue'
 *   toSupportedColor('blue')   -> 'blue'     toSupportedColor('???')  -> null (모르는 색)
 */
const LEGACY_COLOR_MAP: Record<string, SubjectColor> = {
  yellow: 'orange',
  lime: 'green',
  teal: 'green',
  sky: 'blue',
  indigo: 'purple',
  pink: 'red',
  slate: 'blue',
}

export function toSupportedColor(value: unknown): SubjectColor | null {
  if (typeof value !== 'string') return null
  if (SUBJECT_COLORS.includes(value as SubjectColor)) return value as SubjectColor
  return LEGACY_COLOR_MAP[value] ?? null
}

/** 저장소에서 꺼낸 값이 과목 모양({ id, name, color })이면 과목으로 돌려줍니다. 예전 색은 가까운 색으로 바꿉니다. 아니면 null. */
function toSubject(value: unknown): Subject | null {
  if (typeof value !== 'object' || value === null) return null
  const subject = value as Record<string, unknown>
  const color = toSupportedColor(subject.color)
  if (typeof subject.id !== 'string' || typeof subject.name !== 'string' || color === null) {
    return null
  }
  return { id: subject.id, name: subject.name, color }
}
/**
 * 저장해 둔 과목 목록을 불러옵니다. 계획 · 타이머 · 기록 · 시험 화면이 모두 이 함수로 읽습니다.
 *
 * - 한 번도 저장한 적이 없으면 예시 과목(국어 · 수학 …)으로 시작합니다.
 * - 저장된 값이 배열이 아니면(깨졌으면) 예시 과목을 돌려줍니다.
 * - 배열 안에 모양이 틀린 것이 섞여 있으면 그것만 빼고 돌려줍니다.
 * - 과목을 전부 지워서 빈 배열이 저장돼 있으면 빈 목록 그대로입니다.
 */
export function loadSubjects(): Subject[] {
  const saved = loadData<unknown>('subjects', mockSubjects)
  if (!Array.isArray(saved)) return mockSubjects
  return saved.map(toSubject).filter((subject): subject is Subject => subject !== null)
}

/**
 * 지금 과목 목록을 "지금 바로" 돌려줍니다. 화면(React) 밖의 함수가 과목 이름이 필요할 때 씁니다. (알림 확인 등)
 *   진짜 로그인   -> 서버에서 받아 보관해 둔 과목 (아직 못 받았으면 빈 목록)
 *   테스트 로그인 -> 이 기기에 저장된 과목 (loadSubjects)
 * 화면에서는 이 함수 대신 hooks/useSubjects.ts 의 useSubjects 를 씁니다. (목록이 바뀌면 화면이 다시 그려집니다)
 */
export function getSubjectsSnapshot(): Subject[] {
  if (isServerDataMode()) return queryClient.getQueryData<Subject[]>(['subjects']) ?? []
  return loadSubjects()
}
