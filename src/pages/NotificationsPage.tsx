import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAiMessages } from '@/hooks/useAiMessages'
import { useQueryParam } from '@/hooks/useQueryParam'
import { countUnreadAiMessages, loadAiMessages, markAllAiMessagesRead } from '@/lib/aiMessages'
import type { CareLevel } from '@/lib/careLevel'
import { cn } from '@/lib/cn'
import { getMessageSettings } from '@/lib/messageSettings'
import type { AiMessage } from '@/types'

interface CareLevelStyle {
  /** 범례·시각 옆에 보이는 짧은 이름 */
  name: string
  /** 말풍선(과 범례 네모)의 배경·테두리. Tailwind 는 완성된 클래스 이름만 읽어서 통째로 적습니다. */
  bubble: string
  /** 이벤트 이름(예: '계획 시간 지남') 글자 색 */
  eventText: string
}

// 관리 강도마다 말풍선 색을 다르게 합니다. 색은 시안(당근 초록 · 넛지 파랑 · 채찍 주황)을 따랐습니다.
const careLevelStyles: Record<CareLevel, CareLevelStyle> = {
  0: {
    name: '회복',
    bubble: 'bg-teal-50 border-teal-200',
    eventText: 'text-teal-700',
  },
  1: {
    name: '당근',
    bubble: 'bg-green-50 border-green-200',
    eventText: 'text-green-700',
  },
  2: {
    name: '넛지',
    bubble: 'bg-blue-50 border-blue-200',
    eventText: 'text-blue-700',
  },
  3: {
    name: '채찍',
    bubble: 'bg-orange-50 border-orange-200',
    eventText: 'text-orange-700',
  },
  4: {
    name: '강제 채찍',
    bubble: 'bg-rose-50 border-rose-200',
    eventText: 'text-rose-700',
  },
}

// 목록 위의 탭. 어느 탭을 보는지는 주소의 ?tab= 에 담습니다. (전체는 주소에 적지 않습니다)
type TabKey = 'all' | 'ai' | 'app'

const TABS: { key: TabKey; label: string }[] = [
  { key: 'all', label: '전체' },
  { key: 'ai', label: 'AI 메시지' },
  { key: 'app', label: '앱 알림' },
]

// 그 탭에 보여줄 것이 하나도 없을 때의 안내
const emptyTexts: Record<TabKey, string> = {
  all: '아직 온 알림이 없어요.',
  ai: '아직 AI 가 보낸 메시지가 없어요.',
  app: '아직 앱 알림이 없어요.',
}

// 빈 안내 아래에 붙이는 한 줄: 앱 알림이 언제 오는지 (lib/appAlertCheck.ts). AI 메시지 탭에는 붙이지 않습니다.
const APP_ALERT_HINT = '계획한 시작 시각이 되거나 목표를 채우면 여기에 알려 줄게요.'

/** 앱이 정해 둔 문장으로 만든 알림이면 true, AI 가 쓴 메시지면 false 입니다. */
function isAppAlert(message: AiMessage): boolean {
  return message.source === 'app'
}

/** 시각(밀리초)을 '07:30' 처럼 바꿉니다. */
function formatTime(time: number): string {
  const date = new Date(time)
  const hour = String(date.getHours()).padStart(2, '0')
  const minute = String(date.getMinutes()).padStart(2, '0')
  return `${hour}:${minute}`
}

/** 두 시각이 같은 날인지 확인합니다. */
function isSameDay(a: number, b: number): boolean {
  return new Date(a).toDateString() === new Date(b).toDateString()
}

/** 날짜 구분선에 쓸 글자를 만듭니다. 예) '오늘 · 10월 5일', '어제 · 10월 4일', '10월 3일' */
function formatDayLabel(time: number): string {
  const date = new Date(time)
  const monthDay = `${date.getMonth() + 1}월 ${date.getDate()}일`

  const yesterday = new Date()
  yesterday.setDate(yesterday.getDate() - 1)

  if (isSameDay(time, Date.now())) return `오늘 · ${monthDay}`
  if (isSameDay(time, yesterday.getTime())) return `어제 · ${monthDay}`
  return monthDay
}

/**
 * 알림 화면입니다. (주소: /notifications · 헤더의 종 아이콘)
 * AI 가 보낸 메시지와 앱이 만든 알림을 한 목록에 시간 순서로 보여줍니다. 탭으로 한 종류만 골라 볼 수 있습니다. (#61, #255)
 * 예전 이름은 "메시지함"(주소 /messages)이었습니다. 예전 주소로 들어오면 여기로 넘어옵니다. (router.tsx)
 */
export function NotificationsPage() {
  // 이 화면을 보는 동안 새 알림이 쌓여도 바로 목록에 보입니다. (hooks/useAiMessages.ts)
  const messages = useAiMessages()
  // 아래 안내 문구에 보여 줄, 사용자가 정한 연락 금지 시간과 하루 횟수입니다.
  const settings = getMessageSettings()

  // 보고 있는 탭. /notifications?tab=ai 처럼 주소에 담겨서, 새로고침하거나 뒤로 가도 그대로입니다.
  const [tabParam, setTab] = useQueryParam('tab', 'all')
  // 주소는 누구나 고칠 수 있어서, 모르는 값이면 '전체' 로 봅니다.
  const tab: TabKey = tabParam === 'ai' || tabParam === 'app' ? tabParam : 'all'

  const aiMessages = messages.filter((message) => !isAppAlert(message))
  const appAlerts = messages.filter(isAppAlert)
  const countByTab: Record<TabKey, number> = {
    all: messages.length,
    ai: aiMessages.length,
    app: appAlerts.length,
  }
  // 지금 탭에서 보여줄 목록
  const visibleMessages = tab === 'ai' ? aiMessages : tab === 'app' ? appAlerts : messages

  // 화면을 연 순간에 안 읽은 상태였던 알림들의 id.
  // 그때의 값을 기억해 두어야, 아래에서 읽음 처리를 해도 "여기부터 안 읽음" 선이 사라지지 않습니다.
  const [unreadIdsAtOpen] = useState(
    () => new Set(messages.filter((message) => !message.read).map((message) => message.id)),
  )
  // 선은 지금 탭에 보이는 것 중 첫 번째 안 읽은 알림 위에 긋습니다.
  const firstUnreadId = visibleMessages.find((message) => unreadIdsAtOpen.has(message.id))?.id

  // 알림 화면을 열었으면 전부 읽은 것으로 저장합니다. (헤더의 빨간 점이 사라집니다)
  // 안 읽은 것이 있을 때만 저장합니다. 저장하면 화면이 다시 그려지는데, 그때는 0개라서 다시 저장하지 않습니다.
  const unreadCount = countUnreadAiMessages(messages)
  useEffect(() => {
    if (unreadCount > 0) markAllAiMessagesRead(loadAiMessages())
  }, [unreadCount])

  // 지금 보이는 알림에 나오는 관리 강도만 범례에 보여줍니다. (작은 단계부터)
  const usedLevels = [...new Set(visibleMessages.map((message) => message.careLevel))].sort(
    (a, b) => a - b,
  )

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">알림</h1>
        <p className="mt-1 text-sm break-keep text-slate-500">
          앱에서 생긴 일과 AI 선생님이 보낸 메시지가 여기에 쌓여.
        </p>
      </div>

      {/* 전체 / AI 메시지 / 앱 알림 탭. 옆의 숫자는 그 종류가 몇 개 쌓였는지입니다. */}
      {/* max-w-full: 좁은 화면에서 탭 묶음이 화면보다 넓어지지 않게 합니다. */}
      <div className="inline-flex max-w-full self-start rounded-lg bg-slate-100 p-1">
        {TABS.map((item) => (
          <button
            key={item.key}
            type="button"
            aria-pressed={tab === item.key}
            onClick={() => setTab(item.key)}
            className={cn(
              'h-10 cursor-pointer rounded-md px-3 text-sm font-medium whitespace-nowrap transition-colors',
              tab === item.key ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500',
            )}
          >
            {item.label} <span className="tabular-nums">{countByTab[item.key]}</span>
          </button>
        ))}
      </div>

      {usedLevels.length > 0 && (
        <ul aria-label="말풍선 색 안내" className="flex flex-wrap gap-x-4 gap-y-2">
          {usedLevels.map((level) => (
            <li key={level} className="flex items-center gap-1.5 text-sm text-slate-600">
              <span
                aria-hidden
                className={cn('h-3.5 w-3.5 rounded border', careLevelStyles[level].bubble)}
              />
              {careLevelStyles[level].name}
            </li>
          ))}
        </ul>
      )}

      {visibleMessages.length === 0 ? (
        <div className="flex flex-col gap-1 py-10 text-center text-sm break-keep text-slate-500">
          <p>{emptyTexts[tab]}</p>
          {tab !== 'ai' && <p>{APP_ALERT_HINT}</p>}
        </div>
      ) : (
        <ol className="flex flex-col gap-5">
          {visibleMessages.map((message, index) => {
            const previous = visibleMessages[index - 1]
            // 첫 메시지이거나, 바로 앞 메시지와 날짜가 다르면 날짜 구분선을 그립니다.
            const isNewDay = !previous || !isSameDay(previous.sentAt, message.sentAt)

            return (
              <li key={message.id} className="flex flex-col gap-5">
                {isNewDay && <Divider>{formatDayLabel(message.sentAt)}</Divider>}
                {message.id === firstUnreadId && (
                  <Divider className="font-semibold text-red-600">여기부터 안 읽음</Divider>
                )}
                <MessageBubble message={message} />
              </li>
            )
          })}
        </ol>
      )}

      <div className="flex flex-col gap-3 rounded-xl bg-slate-50 p-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
        <p className="text-sm text-slate-600">
          {settings.dailyCount === 0
            ? '지금은 메시지를 보내지 않도록 꺼 두었어. 설정에서 바꿀 수 있어.'
            : `${settings.quietStart} ~ ${settings.quietEnd} 에는 보내지 않아. 횟수와 시간은 설정에서 바꿀 수 있어.`}
        </p>
        <Link
          to="/settings"
          className="text-brand flex h-10 shrink-0 items-center self-start text-sm font-semibold underline sm:self-auto"
        >
          알림 설정
        </Link>
      </div>
    </div>
  )
}

interface DividerProps {
  children: string
  className?: string
}

/** 가운데에 글자가 있는 가로선 (날짜 구분, "여기부터 안 읽음") */
function Divider({ children, className }: DividerProps) {
  return (
    <div className={cn('flex items-center gap-3 text-xs text-slate-500', className)}>
      <span aria-hidden className="h-px flex-1 bg-slate-200" />
      {children}
      <span aria-hidden className="h-px flex-1 bg-slate-200" />
    </div>
  )
}

interface MessageBubbleProps {
  message: AiMessage
}

/** 아바타 + 말풍선 + 보낸 시각 · 종류 */
function MessageBubble({ message }: MessageBubbleProps) {
  const style = careLevelStyles[message.careLevel]
  // 앱이 정해 둔 문장으로 만든 알림인지, AI 가 쓴 메시지인지. 아바타와 아래 글자로 구분해 줍니다.
  const isApp = isAppAlert(message)

  return (
    <div className="flex items-start gap-2.5 sm:gap-3">
      <div
        aria-hidden
        className={cn(
          'flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold',
          isApp ? 'bg-slate-100 text-slate-600' : 'bg-brand-light text-brand',
        )}
      >
        {isApp ? '앱' : 'AI'}
      </div>

      {/* min-w-0: 긴 글자가 있어도 화면 밖으로 밀려나지 않게 합니다. */}
      <div className="flex max-w-[85%] min-w-0 flex-col gap-1.5 sm:max-w-xl">
        <p
          className={cn(
            'rounded-2xl border px-4 py-2.5 text-sm break-words text-slate-900 sm:text-base',
            style.bubble,
          )}
        >
          {message.text}
        </p>
        <p className="flex flex-wrap items-center gap-x-3 text-xs text-slate-500">
          <span>
            <time dateTime={new Date(message.sentAt).toISOString()}>
              {formatTime(message.sentAt)}
            </time>
            {` · ${style.name} · ${isApp ? '앱 알림' : 'AI 메시지'}`}
          </span>
          {message.kind === 'event' && message.eventLabel && (
            <span className={cn('font-semibold', style.eventText)}>{message.eventLabel}</span>
          )}
        </p>
      </div>
    </div>
  )
}
