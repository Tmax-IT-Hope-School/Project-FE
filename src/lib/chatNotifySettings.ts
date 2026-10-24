import {
  applySettingsProposal,
  getSettingsChangeRows,
  type SettingsChangeRow,
  type SettingsProposal,
  type TalkableSettings,
} from '@/lib/aiSettingsApi'
import { CALL_TIME_STORAGE_KEY, parseCallTime } from '@/lib/callReminder'
import { loadNudgeSettings, NUDGE_LABELS, setNudgeOn, type NudgeKind } from '@/lib/coachNudges'
import { getMessageSettings, saveMessageSettings } from '@/lib/messageSettings'
import { loadData, saveData } from '@/lib/storage'

/**
 * 채팅에서 "알림 좀 줄여 줘" 처럼 말하면 코치 알림 설정을 바꿉니다. (#594)
 * 상담 방에서만 알아듣고, 바로 바꾸지 않고 [✅ 바꿀게] 를 눌러야 바꿉니다.
 *
 * 누가 알아듣나요?
 *   - 코드(이 파일): "알림 줄여 줘" · "알림 늘려 줘" · "알림 다 꺼 줘" · "아침 알림 꺼 줘" 처럼 모양이 뻔한 말
 *   - 서버 AI(POST /ai/settings-from-text): "밤 10시 이후엔 연락하지 마" 처럼 시각이 들어간 말 (lib/aiSettingsApi.ts)
 */

/** 알림 이야기인지 보는 낱말 */
const NOTIFY_WORDS = /알림|메시지|연락|말\s*걸/
/** 시각이 들어 있는지 ("10시", "9시 반", "22:00") — 이런 말은 서버 AI 에게 맡깁니다. */
const TIME_WORDS = /\d+\s*시|\d{1,2}:\d{2}/
const REDUCE_WORDS = /줄여|줄이|줄였|적게|덜\s|조금만|너무\s*많|귀찮/
const INCREASE_WORDS = /늘려|늘리|더\s*많이|자주/
const OFF_WORDS = /꺼|끄|끌|그만|하지\s*마|보내지\s*마|안\s*받|없애/
const ON_WORDS = /켜|켤|다시\s*보내|받을래|받고\s*싶/

/** 알림 종류마다 알아듣는 낱말 (밤은 "밤 정리" 만 — "밤에는 연락하지 마" 는 연락 금지 시간 이야기라서) */
const NUDGE_WORDS: Record<NudgeKind, RegExp> = {
  morning: /아침/,
  evening: /밤\s*정리|저녁\s*정리/,
  review: /복습|틀린\s*문제/,
  dday: /디데이|d-?day|시험/i,
  weekly: /주간|일주일|일요일/,
}

/**
 * 학생의 말이 무슨 부탁인지
 *   nudge:    알림 한 종류를 켜거나 끔 ("아침 알림 꺼 줘")
 *   count:    하루 메시지 수를 바꿈 ("알림 줄여 줘" · "알림 늘려 줘" · "알림 다 꺼 줘")
 *   ai:       알림 이야기지만 모양이 뻔하지 않아 서버 AI 에게 물어봄 ("밤 10시 이후엔 연락하지 마")
 */
export type NotifyRequest =
  | { type: 'nudge'; kind: NudgeKind; isOn: boolean }
  | { type: 'count'; direction: 'reduce' | 'increase' | 'off' }
  | { type: 'ai' }

/**
 * 알림 설정을 바꿔 달라는 말인지 봅니다. 아니면 null (그냥 AI 와 이야기)
 *
 *   parseNotifyRequest('알림 좀 줄여 줘')            -> { type: 'count', direction: 'reduce' }
 *   parseNotifyRequest('아침 알림 꺼 줘')            -> { type: 'nudge', kind: 'morning', isOn: false }
 *   parseNotifyRequest('밤 10시 이후엔 연락하지 마') -> { type: 'ai' }
 *   parseNotifyRequest('알림이 안 와')               -> null   (바꿔 달라는 말이 아님)
 */
export function parseNotifyRequest(text: string): NotifyRequest | null {
  if (!NOTIFY_WORDS.test(text)) return null
  const isReduce = REDUCE_WORDS.test(text)
  const isIncrease = INCREASE_WORDS.test(text)
  const isOff = OFF_WORDS.test(text)
  const isOn = ON_WORDS.test(text)
  // 바꿔 달라는 낱말이 하나도 없으면 알림에 대한 질문 · 불평이라 AI 와 이야기합니다.
  if (!isReduce && !isIncrease && !isOff && !isOn) return null
  if (TIME_WORDS.test(text)) return { type: 'ai' }

  const kinds = (Object.keys(NUDGE_WORDS) as NudgeKind[]).filter((kind) =>
    NUDGE_WORDS[kind].test(text),
  )
  // 한 종류만 말했고 켜기 · 끄기가 분명하면 그 종류만 바꿉니다.
  if (kinds.length === 1 && isOff !== isOn) {
    return { type: 'nudge', kind: kinds[0], isOn }
  }
  if (kinds.length > 0) return { type: 'ai' }
  if (isReduce && !isIncrease) return { type: 'count', direction: 'reduce' }
  if (isIncrease && !isReduce) return { type: 'count', direction: 'increase' }
  if (isOff && !isOn) return { type: 'count', direction: 'off' }
  return { type: 'ai' }
}

/** 바꿀 내용. 값이 null 인 쪽은 바꾸지 않습니다. */
export interface NotifyChange {
  /** 전화 시간 · 하루 메시지 수 · 연락 금지 시간 (서버 AI 변경안과 같은 모양) */
  settings: SettingsProposal | null
  /** 알림 한 종류 켜기 · 끄기 */
  nudge: { kind: NudgeKind; isOn: boolean } | null
}

/** 이 기기에 저장된 전화 시간 · 메시지 설정 */
export function loadTalkableSettings(): TalkableSettings {
  const saved = loadData<unknown>(CALL_TIME_STORAGE_KEY, '')
  return {
    callTime: typeof saved === 'string' && parseCallTime(saved) !== null ? saved : '',
    messageSettings: getMessageSettings(),
  }
}

/** 하루 메시지 수 하나만 바꾸는 변경안 */
function countChange(dailyCount: number, summary: string): NotifyChange {
  return {
    settings: { callTime: null, dailyCount, quietStart: null, quietEnd: null, summary },
    nudge: null,
  }
}

/**
 * 코드가 알아들은 부탁을 변경안으로 바꿉니다. (서버 AI 에게 묻는 'ai' 는 여기서 다루지 않습니다)
 * 하루 메시지 수는 한 번에 1씩 바꿉니다. (1 ~ 5, '다 꺼 줘' 만 0)
 *
 *   지금 하루 3번일 때 buildNotifyChange({ type: 'count', direction: 'reduce' }) -> 하루 2번으로
 *   buildNotifyChange({ type: 'nudge', kind: 'morning', isOn: false })              -> 아침 한마디 끄기
 */
export function buildNotifyChange(
  request: Exclude<NotifyRequest, { type: 'ai' }>,
  current: TalkableSettings,
): NotifyChange {
  if (request.type === 'nudge') {
    return { settings: null, nudge: { kind: request.kind, isOn: request.isOn } }
  }
  const count = current.messageSettings.dailyCount
  if (request.direction === 'off') return countChange(0, '코치 알림을 모두 끌게.')
  if (request.direction === 'reduce') {
    return countChange(Math.max(1, count - 1), '코치 알림을 하루 1개 줄일게.')
  }
  return countChange(Math.min(5, Math.max(1, count + 1)), '코치 알림을 하루 1개 늘릴게.')
}

/**
 * 변경안 중 지금 값과 **다른** 칸만 "지금 → 바꿀 값" 줄로 고릅니다. 모두 같으면 []
 *
 *   getNotifyChangeRows({ settings: null, nudge: { kind: 'morning', isOn: false } }, …)
 *     -> [{ label: '아침 한마디', from: '켬', to: '끔' }]   (지금 켜져 있을 때)
 */
export function getNotifyChangeRows(
  change: NotifyChange,
  current: TalkableSettings,
): SettingsChangeRow[] {
  const rows = change.settings ? getSettingsChangeRows(change.settings, current) : []
  if (change.nudge) {
    const isOnNow = loadNudgeSettings()[change.nudge.kind]
    if (isOnNow !== change.nudge.isOn) {
      rows.push({
        label: NUDGE_LABELS[change.nudge.kind].title,
        from: isOnNow ? '켬' : '끔',
        to: change.nudge.isOn ? '켬' : '끔',
      })
    }
  }
  return rows
}

/** 변경안을 이 기기에 저장합니다. (설정 화면에서 직접 바꾼 것과 같은 곳에 저장해서, 다음 알림 예약부터 바로 반영됩니다) */
export function applyNotifyChange(change: NotifyChange): void {
  if (change.settings) {
    const current = loadTalkableSettings()
    const next = applySettingsProposal(change.settings, current)
    if (next.callTime !== '' && next.callTime !== current.callTime) {
      saveData(CALL_TIME_STORAGE_KEY, next.callTime)
    }
    saveMessageSettings(next.messageSettings)
  }
  if (change.nudge) setNudgeOn(change.nudge.kind, change.nudge.isOn)
}

/**
 * 코치가 변경안을 보여 주는 말
 *
 *   notifyProposalText('코치 알림을 하루 1개 줄일게.', [{ label: '하루 메시지 수', from: '하루 3번', to: '하루 2번' }])
 *     -> '코치 알림을 하루 1개 줄일게.\n• 하루 메시지 수: 하루 3번 → 하루 2번\n이렇게 바꿀까?'
 */
export function notifyProposalText(summary: string, rows: SettingsChangeRow[]): string {
  const lines = rows.map((row) => `• ${row.label}: ${row.from} → ${row.to}`)
  return [summary, ...lines, '이렇게 바꿀까?'].join('\n')
}

/** 바꾼 뒤 코치가 알려 주는 한 줄 */
export function notifyDoneText(rows: SettingsChangeRow[]): string {
  const changed = rows.map((row) => `${row.label} ${row.to}`).join(' · ')
  return `바꿨어! ${changed}. 설정 → 알림에서 언제든 다시 바꿀 수 있어.`
}

/** 변경안의 첫 줄 (알림 종류를 켜고 끌 때는 코드가 씁니다) */
export function notifySummaryOf(change: NotifyChange): string {
  if (change.settings) return change.settings.summary
  if (change.nudge) {
    const title = NUDGE_LABELS[change.nudge.kind].title
    return change.nudge.isOn ? `'${title}' 알림을 다시 켤게.` : `'${title}' 알림을 끌게.`
  }
  return ''
}
