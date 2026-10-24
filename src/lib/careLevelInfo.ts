/**
 * 관리 강도 0~4 단계의 이름·설명·색을 한 곳에 모아 둔 파일입니다. (#94)
 * 홈의 "지금 관리 모드" 배너와 설정 화면의 "관리 강도 최대 한도"가 같은 문구를 쓰도록 모았습니다.
 *
 *   0 회복 · 1 당근 · 2 넛지 · 3 심리적 채찍 · 4 강제적 채찍(집중 모드, #69)
 *
 * 색은 Tailwind 가 완성된 클래스 이름만 읽어서, 조각을 붙이지 않고 통째로 적습니다.
 */
import type { CareLevel } from '@/types'

export interface CareLevelInfo {
  level: CareLevel
  /** 단계 이름 (예: '넛지') */
  name: string
  /** 한 줄 설명 (#28 의 단계 표와 같은 문구) */
  description: string
  /**
   * 오늘 이 단계일 때 이유 문구가 따로 없으면 보여줄 기본 한 줄.
   * 이유를 모르는 채로 혼내는 말투가 되면 안 되어서, 모두 지금 어떻게 대하는지만 담담하게 알려 줍니다.
   */
  defaultReason: string
  /** 단계 이름표(배지)의 배경·글자 색 */
  badgeClass: string
  /** 배너 상자의 배경·테두리 색 */
  panelClass: string
}

export const careLevelInfos: CareLevelInfo[] = [
  {
    level: 0,
    name: '회복',
    description: '위로만. "오늘은 하나만"',
    defaultReason: '지금은 쉬어 가는 중이야. 오늘은 부담 없이 할 수 있는 만큼만 해 보자.',
    badgeClass: 'bg-teal-700 text-white',
    panelClass: 'border-teal-200 bg-teal-50',
  },
  {
    level: 1,
    name: '당근',
    description: '구체적 칭찬, 예상 성장 곡선',
    defaultReason: '요즘 잘 해내고 있어서, 잘한 점을 구체적으로 알려주는 중이야.',
    badgeClass: 'bg-amber-700 text-white',
    panelClass: 'border-amber-200 bg-amber-50',
  },
  {
    level: 2,
    name: '넛지',
    description: '담백한 알림. "계획 시간 10분 지났어"',
    defaultReason: '계획 시간마다 가볍게 챙기는 중이야.',
    badgeClass: 'bg-brand text-white',
    panelClass: 'border-indigo-200 bg-indigo-50',
  },
  {
    level: 3,
    name: '심리적 채찍',
    description: '팩폭 말투, 독촉 메시지',
    defaultReason: '계획이 자꾸 미뤄져서, 조금 더 따끔하게 말하는 중이야.',
    badgeClass: 'bg-rose-700 text-white',
    panelClass: 'border-rose-200 bg-rose-50',
  },
  {
    level: 4,
    name: '강제적 채찍',
    description: '공부 시간에 집중 모드 잠금',
    defaultReason: '공부 시간에는 집중 모드로 화면을 잠그는 중이야.',
    badgeClass: 'bg-red-900 text-white',
    panelClass: 'border-red-300 bg-red-50',
  },
]

/** 단계 번호로 정보를 찾습니다. (0~4 밖의 값이 들어오면 가장 약한 0 단계로 봅니다) */
export function getCareLevelInfo(level: CareLevel): CareLevelInfo {
  return careLevelInfos.find((info) => info.level === level) ?? careLevelInfos[0]
}
