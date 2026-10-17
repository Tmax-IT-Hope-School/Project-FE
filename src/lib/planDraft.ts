/**
 * 말로 계획 세우기(#248)의 "초안" 을 다루는 순수 함수와 겹침 확인입니다.
 * AI 가 만든 초안(lib/planParseApi.ts 의 PlanDraft)을 화면에서 고칠 수 있는 모양(EditableDraft)으로 바꾸고,
 * 저장하기 전에 줄마다 문제가 없는지 확인한 뒤 진짜 계획(StudyPlan)으로 바꿉니다.
 */
import { PLAN_CONTENT_MAX_LENGTH, PLAN_MAX_MINUTES, PLAN_MIN_MINUTES } from '@/lib/plansApi'
import type { PlanDraft } from '@/lib/planParseApi'
import { checkPlanSlot } from '@/lib/planSlotCheck'
import type { PlanKind, StudyPlan } from '@/types'

/** 미리보기에서 고치는 초안 한 줄. 입력칸에 쓰기 좋게 값이 빈 글자('')로 정리돼 있습니다. */
export interface EditableDraft {
  /** 줄을 구분하는 값 (화면에서 고치고 빼는 데 씁니다) */
  key: string
  kind: PlanKind
  /** 내 과목의 id. 공부 계획인데 과목을 못 정했으면 '' */
  subjectId: string
  content: string
  targetMinutes: number
  /** 'HH:MM'. 시각이 없으면 '' */
  startTime: string
}

/**
 * 서버의 초안을 고칠 수 있는 줄로 바꿉니다.
 * 내 과목에 없는 과목 번호가 오면(서버가 거르지만 혹시 몰라서) 과목을 비워서, 학생이 고르게 합니다. 새 과목을 만들지 않습니다.
 *
 *   toEditableDrafts([{ subjectId: '3', … }], ['3', '4'])  -> subjectId '3'
 *   toEditableDrafts([{ subjectId: '99', … }], ['3', '4']) -> subjectId '' (과목을 골라 주세요)
 *   노는 계획(kind: 'play')은 과목을 항상 '' 로 둡니다.
 */
export function toEditableDrafts(drafts: PlanDraft[], subjectIds: string[]): EditableDraft[] {
  return drafts.map((draft, index) => ({
    key: `draft-${index}`,
    kind: draft.kind,
    subjectId:
      draft.kind === 'play' || draft.subjectId === null || !subjectIds.includes(draft.subjectId)
        ? ''
        : draft.subjectId,
    content: draft.content,
    targetMinutes: draft.targetMinutes,
    startTime: draft.startTime ?? '',
  }))
}

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/

/**
 * 초안 한 줄에 저장할 수 없는 문제가 있는지 확인하고, 있으면 화면에 보여 줄 문장을 돌려줍니다. 문제가 없으면 null 입니다.
 *
 *   공부 계획인데 과목이 없음  -> '과목을 골라 주세요.'
 *   할 일이 비었거나 200자 초과 -> '할 일을 1 ~ 200자로 적어 주세요.'
 *   목표 시간이 1 ~ 600 밖(소수 포함) -> '목표 시간은 1 ~ 600분 사이의 숫자로 적어 주세요.'
 *   시작 시각이 '19:00' 모양이 아님 -> '시작 시각을 다시 확인해 주세요.'
 */
export function getDraftProblem(draft: EditableDraft): string | null {
  if (draft.kind === 'study' && draft.subjectId === '') return '과목을 골라 주세요.'
  const content = draft.content.trim()
  if (content === '' || content.length > PLAN_CONTENT_MAX_LENGTH) {
    return `할 일을 1 ~ ${PLAN_CONTENT_MAX_LENGTH}자로 적어 주세요.`
  }
  if (
    !Number.isInteger(draft.targetMinutes) ||
    draft.targetMinutes < PLAN_MIN_MINUTES ||
    draft.targetMinutes > PLAN_MAX_MINUTES
  ) {
    return `목표 시간은 ${PLAN_MIN_MINUTES} ~ ${PLAN_MAX_MINUTES}분 사이의 숫자로 적어 주세요.`
  }
  if (draft.startTime !== '' && !TIME_PATTERN.test(draft.startTime)) {
    return '시작 시각을 다시 확인해 주세요.'
  }
  return null
}

/**
 * 확인을 마친 초안들을 진짜 계획(StudyPlan)으로 바꿉니다. 모두 같은 날짜의 새 계획이고, 아직 안 한 상태입니다.
 * id 는 시각(now)과 줄 번호를 붙여서 서로 겹치지 않게 만듭니다.
 */
export function toStudyPlans(drafts: EditableDraft[], date: string, now: number): StudyPlan[] {
  return drafts.map((draft, index) => {
    const plan: StudyPlan = {
      id: `plan-${now}-${index}`,
      date,
      subjectId: draft.kind === 'play' ? '' : draft.subjectId,
      content: draft.content.trim(),
      targetMinutes: draft.targetMinutes,
      done: false,
      kind: draft.kind,
    }
    if (draft.startTime !== '') plan.startTime = draft.startTime
    return plan
  })
}

/** 줄마다 겹침을 확인한 결과 */
export interface DraftConflicts {
  /** 줄의 key → 겹쳐서 저장하면 안 될 때 보여 줄 안내. 겹치지 않는 줄은 들어 있지 않습니다 */
  messages: Record<string, string>
  /** 구글 캘린더를 못 읽었을 때의 안내. 아니면 null */
  googleNotice: string | null
}

/**
 * 초안들이 그날의 기존 계획 · 구글 일정 · 다른 초안과 시간이 겹치는지 줄마다 확인합니다. (#315 의 checkPlanSlot 을 그대로 씁니다)
 * 앞 줄부터 차례로 보면서, 앞 줄들을 이미 놓인 계획으로 치고 다음 줄을 확인합니다. 겹치면 뒤쪽 줄이 걸립니다.
 * 시작 시각이 없는 줄은 확인하지 않습니다.
 */
export async function checkDraftConflicts(
  drafts: EditableDraft[],
  date: string,
  existingPlans: StudyPlan[],
): Promise<DraftConflicts> {
  const messages: Record<string, string> = {}
  let googleNotice: string | null = null
  const placed: StudyPlan[] = [...existingPlans]
  const planned = toStudyPlans(drafts, date, 0)

  for (let index = 0; index < drafts.length; index++) {
    const draft = drafts[index]
    // 문제가 있는 줄(과목 없음 등)은 시각을 믿을 수 없어서 겹침을 확인하지 않습니다. 그 줄의 문제를 먼저 고치게 합니다.
    if (getDraftProblem(draft) !== null) continue
    const check = await checkPlanSlot({
      dayKey: date,
      startTime: draft.startTime,
      targetMinutes: draft.targetMinutes,
      plans: placed,
    })
    if (check.googleNotice !== null) googleNotice = check.googleNotice
    if (check.conflictMessage !== null) messages[draft.key] = check.conflictMessage
    placed.push(planned[index])
  }
  return { messages, googleNotice }
}
