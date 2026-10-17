import { moveDateKey } from '@/lib/date'

/**
 * 체크인의 "오늘의 약속" (#79)을 다루는 순수 함수와 값들입니다.
 *
 * 약속은 "만약 ~하면 → ~한다" 한 문장을 칸 두 개로 받습니다.
 *   만약 [학원에서 돌아오면] → [씻기 전에 영어 단어 20개를 본다]
 * "열심히 하기" 같은 약속은 지켰는지 알 수 없지만, 이 문장은 다음 날 "지켰어 / 못 지켰어" 로 물을 수 있습니다.
 */

/** 칸 하나에 적을 수 있는 글자 수 */
export const PROMISE_MAX_LENGTH = 40

/** 눌러서 칸을 채우는 예시 문장들 */
export const PROMISE_EXAMPLES = [
  { ifText: '책상에 앉으면', thenText: '타이머부터 켠다' },
  { ifText: '폰을 보고 싶으면', thenText: '한 문제만 더 푼다' },
  { ifText: '학원에서 돌아오면', thenText: '씻기 전에 영어 단어 20개를 본다' },
]

/** 체크인에 저장되는 약속 */
export interface PromiseText {
  promiseIf: string
  promiseThen: string
}

/**
 * 입력칸에 적은 글자로 저장할 약속을 만듭니다.
 * 앞뒤 빈칸은 떼고, 두 칸이 모두 채워졌을 때만 약속으로 봅니다. 하나라도 비었으면 null 입니다.
 * (한 칸만 있는 약속은 "~하면 → ~한다" 문장이 아니라서, 다음 날 지켰는지 물을 수 없습니다)
 *
 *   makePromiseText('학원에서 돌아오면', '영어 단어 20개를 본다') -> { promiseIf: '학원에서 돌아오면', promiseThen: '영어 단어 20개를 본다' }
 *   makePromiseText('  책상에 앉으면  ', ' 타이머부터 켠다 ')      -> { promiseIf: '책상에 앉으면', promiseThen: '타이머부터 켠다' }
 *   makePromiseText('학원에서 돌아오면', '')                      -> null   (뒤 칸이 비었음)
 *   makePromiseText('', '')                                        -> null   (안 정했음)
 *   makePromiseText('   ', '타이머부터 켠다')                      -> null   (앞 칸이 빈칸뿐)
 */
export function makePromiseText(ifText: string, thenText: string): PromiseText | null {
  const promiseIf = ifText.trim()
  const promiseThen = thenText.trim()
  if (promiseIf === '' || promiseThen === '') return null
  return { promiseIf, promiseThen }
}

/**
 * 한 칸만 채워서 아직 약속으로 저장되지 않는 상태인지 알려줍니다. (안내 문구를 보여줄지 정할 때 씁니다)
 *
 *   isHalfFilledPromise('학원에서 돌아오면', '')  -> true
 *   isHalfFilledPromise('', '타이머부터 켠다')    -> true
 *   isHalfFilledPromise('', '')                   -> false  (아직 안 적음)
 *   isHalfFilledPromise('A', 'B')                 -> false  (둘 다 적음)
 */
export function isHalfFilledPromise(ifText: string, thenText: string): boolean {
  const hasIf = ifText.trim() !== ''
  const hasThen = thenText.trim() !== ''
  return hasIf !== hasThen
}

/**
 * 어제 정한 약속이 있는지 보고, 있으면 "지켰어?" 로 물을 문장을 돌려줍니다. 약속이 없으면 null 입니다.
 * 저장된 값이 한쪽만 비어 있어도 약속이 아니므로 null 입니다.
 *
 *   getAskedPromise({ promiseIf: '책상에 앉으면', promiseThen: '타이머부터 켠다' }) -> { promiseIf: '책상에 앉으면', promiseThen: '타이머부터 켠다' }
 *   getAskedPromise({ promiseIf: '책상에 앉으면' })                                -> null
 *   getAskedPromise(undefined)                                                      -> null   (어제 체크인을 안 했음)
 */
export function getAskedPromise(
  checkIn: { promiseIf?: string; promiseThen?: string } | undefined,
): PromiseText | null {
  if (checkIn === undefined) return null
  return makePromiseText(checkIn.promiseIf ?? '', checkIn.promiseThen ?? '')
}

/** 약속을 지켰는지 답한 횟수와, 그중 지킨 횟수 */
export interface PromiseKeptCount {
  /** "지켰어 / 못 지켰어" 로 답한 약속 수 */
  answered: number
  /** 그중 "지켰어" 라고 답한 수 */
  kept: number
}

/**
 * 최근 며칠 동안 "지켰어 / 못 지켰어" 로 답한 약속이 몇 개이고 그중 몇 개를 지켰는지 셉니다.
 * 오늘은 빼고, 오늘 앞의 days 일을 봅니다. (약속은 다음 날 체크인에서 답하므로 오늘 날짜의 약속은 아직 답이 없습니다)
 * 약속을 정하지 않았거나 답하지 않은 체크인은 세지 않습니다. ("못 지킴" 이 아니라 "모름")
 * 날짜는 'YYYY-MM-DD' 글자라서 크기 비교로 앞뒤를 알 수 있습니다.
 *
 *   오늘 '2026-10-17', days 7 → 10-10 ~ 10-16 의 체크인만 봅니다.
 *   [10-15 약속 + 지켰어, 10-16 약속 + 못 지켰어, 10-14 약속만(답 없음)] -> { answered: 2, kept: 1 }
 *   [10-09 약속 + 지켰어] -> { answered: 0, kept: 0 }   (7일보다 오래됨)
 */
export function countKeptPromises(
  checkIns: { date: string; promiseIf?: string; promiseThen?: string; promiseKept?: boolean }[],
  todayKey: string,
  days = 7,
): PromiseKeptCount {
  const startKey = moveDateKey(todayKey, -days)
  let answered = 0
  let kept = 0
  for (const checkIn of checkIns) {
    if (checkIn.date < startKey || checkIn.date >= todayKey) continue
    if (getAskedPromise(checkIn) === null) continue
    if (typeof checkIn.promiseKept !== 'boolean') continue
    answered += 1
    if (checkIn.promiseKept) kept += 1
  }
  return { answered, kept }
}
