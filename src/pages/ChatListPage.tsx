import { useAuth } from '@/hooks/useAuth'
import { useCards } from '@/hooks/useCards'
import { localCheckCall } from '@/lib/checkCall'
import { CALL_ENTRY, CHAT_ROOMS, chatRoomPath, loadLastSeen } from '@/lib/chatRooms'
import { lastTalkBubble, loadCoachThread, type ThreadBubble } from '@/lib/coachThread'
import { loadAllSessions } from '@/lib/dailyRecords'
import { getTodayKey, toDayKey } from '@/lib/date'
import { cn } from '@/lib/cn'
import { useState } from 'react'
import { Link } from 'react-router-dom'

/**
 * 채팅 탭("/chat") — 대화방 목록입니다. (2026-10-18 저녁, #582)
 * 사용자 결정: "맨 위 📞 매일 통화 카드 + 채팅방 3개 📅 계획 · 💬 상담 · 📚 과목 쌤", "채팅 탭은 하나 있어야 됨 무조건"
 *
 * - 맨 위 📞 매일 통화: 언제든 걸 수 있습니다. 오늘 끝낸 공부가 있으면 그걸 설명하는 확인 통화(#584)라고 알려 줍니다.
 *   여기서는 이 기기의 기록으로만 미리 보여 줍니다. (서버에 묻지 않아서 열기만 해서는 아무 요청도 안 감)
 *   "잠김" 표시는 2026-10-22 에 통화의 공부 조건과 함께 뺐습니다.
 * - 방마다 마지막 말 한 줄과, 마지막으로 열어 본 뒤에 AI 가 한 말이 있으면 파란 점을 보여 줍니다.
 * - 방 이름 · 아이콘 · 설명은 lib/chatRooms.ts 의 CHAT_ROOMS 한 곳에서 읽습니다.
 */
export function ChatListPage() {
  const { user } = useAuth()
  const { cards } = useCards()
  // 화면을 열 때 한 번만 읽습니다. (대화방 기록 · 마지막으로 본 시각 · 공부 기록)
  const [threads] = useState(() =>
    CHAT_ROOMS.map((room) => lastTalkBubble(loadCoachThread(user?.id ?? 'unknown', room.id))),
  )
  const [lastSeen] = useState(loadLastSeen)
  const [sessions] = useState(loadAllSessions)
  const [todayKey] = useState(getTodayKey)
  const call = localCheckCall(sessions, cards, todayKey)

  return (
    // 홈과 같이 모바일은 연회색 바탕 위에 흰 묶음을 올립니다. (-mx-4 -mt-3 -mb-6 으로 Layout 의 여백까지 덮음)
    <div className="-mx-4 -mt-3 -mb-6 flex flex-col gap-4 bg-slate-100 px-4 pt-3 pb-6 sm:mx-0 sm:my-0 sm:rounded-2xl sm:p-6">
      {/* 알림 종은 2026-10-22 에 헤더로 올렸습니다. (같은 종이 두 번 보이지 않게 여기서는 뺐습니다) */}
      <div className="min-w-0 px-1">
        <h1 className="text-[28px] leading-snug font-bold tracking-tight text-slate-900">채팅</h1>
        {/* 설명이 잘리지 않게 줄바꿈을 허용하고, 낱말 중간에서는 끊지 않습니다. */}
        <p className="text-[15px] break-keep text-slate-500">
          AI 랑 계획 · 상담 · 공부 질문을 나눠서 해요
        </p>
      </div>

      {CALL_ENTRY && (
        <Link
          to={CALL_ENTRY.path}
          // 오늘 끝낸 공부가 있으면(확인 통화) 테두리를 brand 로 바꿔 "오늘 할 일" 임을 눈에 띄게 합니다. (폰 레스토프 — 채운 버튼은 쓰지 않음)
          className={cn(
            'flex min-h-16 items-center gap-3 rounded-2xl border bg-white px-4 py-3 transition-transform active:scale-[0.99]',
            call.studied ? 'border-brand' : 'border-transparent',
          )}
        >
          <span
            aria-hidden
            className="bg-brand-light flex size-12 shrink-0 items-center justify-center rounded-full text-2xl"
          >
            {CALL_ENTRY.emoji}
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span
                className={cn(
                  'text-[17px] font-bold',
                  call.studied ? 'text-brand-dark' : 'text-slate-900',
                )}
              >
                {CALL_ENTRY.name}
              </span>
              {call.studied && (
                // "지금 할 것" 표시는 앱 전체에서 형광펜 색(bg-now) 하나로 맞춥니다.
                <span className="bg-now rounded-full px-2 py-0.5 text-xs font-semibold text-slate-900">
                  오늘 확인 통화
                </span>
              )}
            </span>
            <span className="mt-0.5 block text-sm leading-relaxed break-keep text-slate-500">
              {call.studied
                ? `방금 한 ${call.studied.title ? `'${call.studied.title}'` : '공부'}(${call.studied.minutes}분)를 코치한테 3분 설명해 봐`
                : 'AI 선생님이랑 3분 동안 오늘 이야기를 나눠 봐'}
            </span>
          </span>
          <span aria-hidden className="shrink-0 text-xl text-slate-400">
            ›
          </span>
        </Link>
      )}

      {/* 지난 통화 정리를 다시 보는 곳 (STARFLOW D19). 통화 카드 바로 아래에 작게 둡니다. h-10: 누르기 쉬운 높이 */}
      {CALL_ENTRY && (
        <Link
          to="/call/history"
          className="-mt-2 inline-flex h-10 items-center self-end px-1 text-sm font-medium text-slate-600 hover:underline"
        >
          지난 통화 보기 <span aria-hidden>›</span>
        </Link>
      )}

      <ul className="flex flex-col divide-y divide-slate-100 overflow-hidden rounded-2xl bg-white">
        {CHAT_ROOMS.map((room, index) => {
          const last = threads[index]
          const seenAt = lastSeen[room.id] ?? 0
          // 마지막 말이 AI 의 말이고, 마지막으로 열어 본 뒤에 생겼으면 "새 말" 점을 보여 줍니다.
          const hasNew = last !== null && last.speaker === 'ai' && last.at > seenAt
          return (
            <li key={room.id}>
              {/* 행 전체가 누르는 곳입니다. (높이 64px 이상) */}
              <Link
                to={chatRoomPath(room.id)}
                className="flex min-h-16 items-center gap-3 px-4 py-3 hover:bg-slate-50 active:bg-slate-100"
              >
                <span
                  aria-hidden
                  className="flex size-12 shrink-0 items-center justify-center rounded-full bg-slate-100 text-2xl"
                >
                  {room.emoji}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-[17px] font-bold text-slate-900">
                      {room.name}
                    </span>
                    {last && (
                      <span className="shrink-0 text-xs text-slate-500 tabular-nums">
                        {timeLabel(last, todayKey)}
                      </span>
                    )}
                  </span>
                  {/* 아직 대화가 없으면 방의 역할 한 줄을, 있으면 마지막 말 한 줄을 보여 줍니다. */}
                  <span className="block truncate text-sm text-slate-500">
                    {last ? previewText(last) : room.role}
                  </span>
                </span>
                {hasNew && (
                  <span className="bg-brand size-2.5 shrink-0 rounded-full">
                    <span className="sr-only">새 말</span>
                  </span>
                )}
                <span aria-hidden className="shrink-0 text-xl text-slate-400">
                  ›
                </span>
              </Link>
            </li>
          )
        })}
      </ul>

      <p className="px-1 text-xs break-keep text-slate-500">
        대화는 이 기기에만 남아요. 설정의 "모든 기록 지우기" 로 지울 수 있어요.
      </p>
    </div>
  )
}

/** 목록에 보일 마지막 말 한 줄. 사진을 보냈으면 앞에 📎 */
function previewText(bubble: ThreadBubble): string {
  const text = bubble.text.replace(/\s+/g, ' ')
  return bubble.hasPhoto ? `📎 ${text}` : text
}

/** 마지막 말의 때: 오늘이면 '오후 7:40' 처럼 시각, 아니면 '10/17' 처럼 날짜 */
function timeLabel(bubble: ThreadBubble, todayKey: string): string {
  const date = new Date(bubble.at)
  if (toDayKey(bubble.at) === todayKey) {
    return date.toLocaleTimeString('ko-KR', { hour: 'numeric', minute: '2-digit' })
  }
  return `${date.getMonth() + 1}/${date.getDate()}`
}
