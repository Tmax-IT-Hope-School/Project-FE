import { CHAT_ROOMS, threadStorageKey } from '@/lib/chatRooms'
import { removeData } from '@/lib/storage'

/**
 * "내 데이터 삭제" 가 무엇을 지우는지 한 곳에 모아 둔 파일입니다. (설정 화면의 "내 데이터 관리")
 *
 * 저장하는 새 기능을 만들면 그 저장 키를 여기에 꼭 추가하세요.
 * 안 그러면 "모든 기록 지우기" 를 눌러도 그 데이터가 남습니다.
 */

/** 일기 데이터의 저장 키. (일기 #63, 성찰 일기 #70, 저장 전에 쓰던 일기) */
const DIARY_KEYS = ['diary', 'reflection-entries', 'diary-draft']

/**
 * 모든 기록의 저장 키 = 공부 계획 · 공부 기록 · 타이머 기록 · 딴짓 기록 · 시험 · 일기
 * 아직 없는 기능의 키도 미리 적어 둡니다. (없는 키를 지우는 건 아무 일도 안 일어납니다)
 *
 * 일부러 넣지 않은 것(= 지우지 않고 남김)
 *   subjects    과목. 기록이 아니라 내가 정한 설정이라 남깁니다.
 *   initial-plan  온보딩 마지막에 세운 처음 계획(하루 목표 · 주당 일수). 기록이 아니라 내가 한 약속이고, 나중에 지금과 비교하는 기준이라 남깁니다. (#240)
 *   routines    루틴(요일마다 반복되는 계획의 틀). 과목처럼 내가 정한 설정이라 남깁니다. (#236)
 *   planner-view  계획 화면을 목록으로 볼지 플래너로 볼지 고른 값. 이것도 설정이라 남깁니다. (#237)
 *   timer-mode, timer-target  고른 타이머 방식(목표 정하기·뽀모도로·목표 없이)과 목표 시간. 이것도 설정입니다.
 *   (initial-plan · routines · planner-view · timer-mode · timer-target 을 쓰던 화면은 #417 에서 지웠습니다. 옛 값이 남아도 읽지 않습니다)
 *   onboarding-draft  온보딩 설문을 끝내기 전에 고르던 답(임시). 설문을 끝내면 스스로 지워집니다. 아래 onboarding-answers 와 같은 이유로 남깁니다.
 *   onboarding-answers  온보딩 설문 답. 기록이 아니라 내 정보이고, 지우면 설문을 처음부터 다시 하게 되어서 남깁니다.
 *   signup-info  가입 때 정한 닉네임과 동의 내역. 기록이 아니라 계정 정보이고, 동의한 기록은 남겨 두어야 해서 남깁니다.
 *   call-time, call-last-ring  전화 받을 시간과 마지막으로 울린 시각. 내가 정한 설정이라 남깁니다.
 *   phone-focus-enabled  체크인에서 휴대폰 집중 모드를 확인받을지 정한 설정(#106). 기록이 아니라 설정이라 남깁니다.
 *   care-limits, message-settings  관리 강도 한도 · 독설 수위 · 메시지 횟수 · 연락 금지 시간. 내가 정한 설정이라 남깁니다.
 *   diary-enabled  일기 쓰기를 켰는지. 설정이라 남깁니다.
 *   ios-install-guide-dismissed  아이폰 "홈 화면에 추가" 안내를 닫았는지. 기록이 아니라서 남깁니다.
 *   auth        로그인 정보. 지우면 로그아웃되어 버립니다.
 *   (2026-10-25 에 저장 키를 모두 견줘 보고 남기기로 한 것)
 *   goals, goal-draft, goal-sync-pending, goal-sync-rejected  목표. 지울지 남길지 아직 정하지 않았습니다. (QA "확인 필요")
 *   fixed-blocks  고정 일정(학교 · 학원 시간). 루틴처럼 내가 정한 틀이라 남깁니다.
 *   auto-settings, coach-nudges-off, mission-alerts-off  설정 값과 알림 끄기. 설정이라 남깁니다.
 *   school-class, school-day, school-exam-dates, school-replan-dismissed  우리 반 · 학교 일정(NEIS 에서 받은 것). 기록이 아니라 남깁니다.
 *   google-calendar  구글 캘린더 연결. 계정 연결이라 남깁니다.
 *   psych-test, thinking-test (+ -draft, -sent), onboarding-*, my-hypotheses, signup-done  온보딩 · 검사 답과 가입 표시. onboarding-answers 와 같은 이유로 남깁니다.
 *   demo-manifest  시연 데이터로 무엇을 넣었는지 적은 표. 이 버튼이 남기는 온보딩 답 등에도 시연 값이 들어 있어서,
 *                  설정의 [가상 데이터 지우기] 로 그것까지 뺄 수 있게 남깁니다. (lib/demoData.ts 의 removeDemoData)
 */
const RECORD_KEYS = [
  'plans',
  // 카드(#379). 지운 뒤 다시 열면 남아 있는 루틴만 반복 카드로 다시 옮겨집니다. (hooks/useCards.ts)
  'cards',
  // 서버에 아직 못 보낸 카드 목록 (#516). 카드를 지웠으니 보낼 것도 없습니다.
  'card-sync-pending',
  'sessions',
  // 서버에 보낸 공부 기록 표시 (#516). 기록을 지웠으니 표시도 지웁니다.
  'session-sync',
  'timer',
  'timer-subject',
  // 딴짓(탭 이탈) 기록과, 나갔다가 아직 돌아오지 않은 임시 기록 (#22)
  'away-records',
  'away-pending',
  // 집중 모드 중인지, 집중 모드를 해제한 시각과 이유 기록 (#69)
  'focus-mode',
  'focus-unlocks',
  // 시험 목록과 예상·실제 점수, 회고 (#80, #81)
  'exams',
  // 인사이트 카드에 누른 반응 (#84)
  'insight-responses',
  // 개선안을 날마다 지켰는지 적은 기록 (#65)
  'suggestion-checks',
  // 실험에서 효과가 확인되어 "나 사용설명서" 에 올린 항목 (#93)
  'manual-items',
  // 나 사용설명서에서 "틀렸어요" 를 누른 항목 (hooks/useManualItems.ts)
  'manual-disputes',
  // 주간 리포트에서 고른 "다음 주에 하나만 해 볼 것" (lib/weeklyPicks.ts)
  'weekly-picks',
  // 서버로 아직 못 보낸 고른 것의 주들 (#654). 고른 것을 지우면 보낼 것도 없습니다.
  // ⚠️ 서버에 이미 올라간 고른 것은 이 버튼으로 지워지지 않습니다. (서버에 지우는 주소가 없음, 탈퇴할 때 지워집니다)
  'weekly-picks-unsent',
  // 날짜마다 "이미 계획으로 넣은 루틴" 표시. 계획을 지우면 이 표시도 같이 지워야 루틴이 다시 채워집니다. (#236)
  'routine-filled',
  // 타이머가 재고 있던 계획 (timer-subject 와 같이 지웁니다)
  'timer-plan',
  // 매일 체크인(기분 · 컨디션 · 못 채운 이유)과 옛 주간 회고(#417 에서 지움 — 남아 있는 옛 기록도 지우려고 목록에 둡니다)
  'checkins',
  // 서버로 아직 못 보낸 체크인의 날짜들 (#321). 체크인을 지우면 보낼 것도 없습니다.
  // ⚠️ 서버에 이미 보낸 체크인은 이 버튼으로 지워지지 않습니다. (서버 기록은 탈퇴할 때 지워집니다)
  'checkins-unsent',
  'weekly-reviews',
  // 개선안과 도전 상태. 이행 기록(suggestion-checks)만 지우고 이것을 남기면 "도전 중" 인데 기록이 0 인 상태가 됩니다.
  'suggestions',
  // 처음의 다짐 (내 목소리 녹음과 글 한마디) (#241)과, 그 화면을 한 번 봤다는 표시
  'voice-pledge',
  'voice-pledge-seen',
  // 주마다 고른 "이번 주 목표" 와 쉬기로 한 주 (#247)
  'weekly-goals',
  // AI 가 써 준 "어제 한 줄" (그날 다시 묻지 않으려고 저장해 둔 것. lib/dailyCoach.ts)
  'daily-coach',
  // AI 자기 분석 (같은 날 같은 숫자면 다시 묻지 않으려고 저장해 둔 것. lib/aiAnalysisApi.ts)
  'ai-analysis',
  // 목표 조정 제안을 거절한 날짜, 수락한 날짜
  'goal-adjust-declined',
  'goal-adjust-accepted',
  // 받은 AI 메시지와, 알림을 보낸 기록
  'ai-messages',
  'ai-message-notified-ids',
  'ai-message-sent-today',
  // 주간 리포트에서 먼저 맞혀 본 답과 예측 정확도 (#409)
  'predictions',
  // AI 와의 대화방 (이 기기에만 남김, 2026-10-18 lib/coachThread.ts). 방마다 하나씩 ('coach-thread' 는 상담 방)
  ...CHAT_ROOMS.map((room) => threadStorageKey(room.id)),
  // 대화방 목록의 "새 말" 점 · [이야기하기] 로 맡겨 둔 요청 · 다른 방에서 넘긴 계획 칩 (lib/chatRooms.ts)
  'chat-last-seen',
  'chat-talk-request',
  'chat-plan-handoff',
  // 공부 중 폰을 든 기록 (세션별, lib/liftAlerts.ts)
  'phone-lifts',
  // 세션별 집중도 점수와, 진행 중인 세션에서 화면을 떠난 기록 (lib/focusScore.ts)
  'focus-scores',
  'session-away',
  // 확인 문제를 푼 결과 (틀린 문제를 다음 날 다시 내려고 남김, lib/studyQuiz.ts)
  'quiz-results',
  // 확인 문제 결과 중 서버로 보낸 것 · 거절된 것 (#653, lib/quizResultsApi.ts)
  // ⚠️ 서버에 이미 올라간 결과는 이 버튼으로 지워지지 않습니다. (서버에 지우는 주소가 없음, 탈퇴할 때 지워집니다)
  'quiz-result-sync',
  // 내가 준비하는 것(lib/studyFocus.ts) · 내 일정(lib/myEvents.ts) · 내 학과 · 계열(lib/schoolTrack.ts)
  'focus',
  'my-events',
  'school-track',
  // ---- 2026-10-25 QA 에서 "지운 뒤에도 남는다" 고 찾은 기록들 ----
  // 쉬는 날 (lib/restDays.ts) · 카드 하루 표시: 성공 · 실패 · 미루기 (lib/cardMarks.ts) · 그 둘을 서버로 보낸 표시 (lib/markSync.ts)
  'rest-days',
  'card-day-marks',
  'mark-sync',
  // 날마다 정한 관리 단계 (lib/careStage.ts) · 4단계에서 고른 절대 카드 (lib/stage4.ts)
  'care-stage-log',
  'stage4-absolute',
  // 자기 실험 (lib/experiments.ts) · 인사이트에 "틀렸어요" 를 누른 것 (lib/insightDisputes.ts)
  'experiments',
  'insight-disputes',
  // 오늘의 미션을 몇 개 끝냈는지 · 코치가 결과를 먼저 물어본 공부 기록 번호 (pages/ChatRoomPage.tsx)
  'coach-mission-progress',
  'coach-recapped-session',
  // 받아 둔 코치 알림 문장 (lib/coachNudges.ts). 알림을 끈 설정('coach-nudges-off')은 남깁니다.
  'coach-nudge-texts',
  // 통화 기록 (lib/callLog.ts) · 날짜별 평가 (lib/callSummary.ts)
  'call-log',
  'evaluations',
  // AI 가 바꾼 설정의 기록 (lib/settingsMapping.ts). 바뀐 설정 값('auto-settings')은 남깁니다.
  'auto-setting-changes',
  // 진행 중인 카드 세션 ('timer' 와 같이 지움) · 보낸 카드 알림 · 체크리스트를 다 한 횟수
  'card-session',
  'card-alerts-sent',
  'checklist-complete-count',
  // 테스트 로그인에서 사진 채점을 해 본 시연 결과 (lib/answerChecksApi.ts)
  'answer-checks-demo',
  // 홈의 일정 조정 제안에서 [괜찮아요] 를 누른 날짜 (lib/scheduleAdjust.ts)
  'schedule-adjust-dismissed',
  ...DIARY_KEYS,
]

/** all: 모든 기록 (일기만 지우기는 일기 기능과 함께 #417 에서 지웠습니다. 옛 일기는 모든 기록 지우기로 같이 지워집니다) */
export type DeleteKind = 'all'

export interface DeleteResult {
  /** 전부 실제로 사라졌으면 true */
  isSuccess: boolean
  /** 지우지 못한 키 이름들 (성공이면 빈 배열) */
  failedKeys: string[]
}

/**
 * 내 데이터를 지우고, 정말 사라졌는지 확인한 결과를 돌려줍니다.
 *
 *   const { isSuccess } = deleteMyData('all')
 */
export function deleteMyData(kind: DeleteKind): DeleteResult {
  // 지금은 '모든 기록' 한 가지뿐입니다. (kind 는 나중에 종류가 늘 때를 위해 남겨 둡니다)
  const keys = kind === 'all' ? RECORD_KEYS : []

  // 하나가 실패해도 나머지는 계속 지웁니다. (일부만 지워진 채로 멈추지 않게)
  const failedKeys = keys.filter((key) => !removeData(key))

  return { isSuccess: failedKeys.length === 0, failedKeys }
}
