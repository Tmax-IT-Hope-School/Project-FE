import type { AutoSettingKey, AutoSettingValues, SettingSource } from '@/lib/settingsMapping'

/**
 * 설정 화면에 보여 줄 "AI 가 맞춘 설정" 의 이름과 고를 수 있는 값 (#390, 최종 기획서 「4.8 설정」·「6.3」)
 * 값 자체와 기본값은 lib/settingsMapping.ts 에 있습니다. 여기는 화면에 쓰는 글자만 둡니다.
 */

/** 고를 수 있는 값 하나 */
export interface AutoSettingOption<K extends AutoSettingKey = AutoSettingKey> {
  value: AutoSettingValues[K]
  label: string
}

/** 설정 한 줄 */
export interface AutoSettingRow<K extends AutoSettingKey = AutoSettingKey> {
  key: K
  title: string
  options: AutoSettingOption<K>[]
}

// 줄마다 key 와 값의 모양이 맞는지 TypeScript 가 확인하게 하는 도우미입니다.
function row<K extends AutoSettingKey>(
  key: K,
  title: string,
  options: AutoSettingOption<K>[],
): AutoSettingRow {
  return { key, title, options } as AutoSettingRow
}

const onOff = (on: string, off: string) => [
  { value: false, label: off },
  { value: true, label: on },
]

/** 화면에 보이는 순서 (이슈 #390 의 목록 순서) */
export const AUTO_SETTING_ROWS: AutoSettingRow[] = [
  row('countdown', '5초 카운트다운', onOff('켬', '끔')),
  row('earlyAlertMinutes', '알림 시점', [
    { value: 0, label: '정각에만' },
    { value: 10, label: '10분 전에도' },
  ]),
  row('timerMode', '타이머 화면', [
    { value: 'minimal', label: '시계만' },
    { value: 'checklist', label: '체크리스트' },
  ]),
  row('parkingLot', '딴생각 주차장', onOff('켬', '끔')),
  row('checklistWriter', '체크리스트 쓰기', [
    { value: 'ai', label: 'AI 가 채움' },
    { value: 'suggestSelf', label: '2주 뒤 직접' },
  ]),
  row('optionalFieldsOpen', '선택 입력칸', onOff('펼침', '접음')),
  row('failCauseRequired', '예상 실패 원인', onOff('꼭 적기', '선택')),
  row('planPatternHint', '계획 패턴 안내', [
    { value: 'show', label: '보여 주기만' },
    { value: 'suggestCount', label: '개수 제안' },
  ]),
  row('proof', '산출물 증빙', [
    { value: 'optional', label: '선택' },
    { value: 'suggestRequired', label: '권하기' },
  ]),
  row('goodReasonEvery', '잘 된 이유 묻기', [
    { value: 3, label: '3번에 1번' },
    { value: 2, label: '2번에 1번' },
  ]),
  row('distortionFeedbackPerWeek', '생각 습관 피드백', [
    { value: 1, label: '주 1회' },
    { value: 2, label: '주 2회' },
  ]),
  row('recoverySensitivityDays', '회복 모드 민감도', [
    { value: 2, label: '2일' },
    { value: 3, label: '3일' },
    { value: 4, label: '4일' },
  ]),
  row('failedCardTiming', '실패 카드 처리', [
    { value: 'call', label: '통화 때' },
    { value: 'rightAfter', label: '실패 직후' },
  ]),
  row('postponeLimitRoutine', '루틴 미루기 한도', [
    { value: 5, label: '월 5회' },
    { value: 3, label: '월 3회' },
  ]),
]

/** 근거 배지 글자. 색만으로 구분하지 않도록 글자로 씁니다. */
export const SOURCE_LABELS: Record<SettingSource, string> = {
  test: '검사 기준',
  data: '최근 데이터 기준',
  user: '내가 정함',
  default: '기본값',
}

/** 값의 글자를 찾습니다. 표에 없는 값이면 그대로 글자로 바꿉니다. */
export function getOptionLabel(settingRow: AutoSettingRow, value: unknown): string {
  return settingRow.options.find((option) => option.value === value)?.label ?? String(value)
}
