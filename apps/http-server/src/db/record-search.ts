import type { RecordModel } from '@autorecord/core'
import { formatDuration, intervalToDuration } from 'date-fns'
import { enUS } from 'date-fns/locale/en-US'
import { ru } from 'date-fns/locale/ru'
import { zhCN } from 'date-fns/locale/zh-CN'

export function createRecordSearch(search: string, timeZone?: string, language?: string) {
  const query = search.toLocaleLowerCase()
  const locale = language === 'zh' ? zhCN : language === 'ru' ? ru : enUS
  const dateTime = createDateTimeFormatter(timeZone)
  const matches = (value: string) => value.toLocaleLowerCase().includes(query)
  const matchesTimestamp = (timestamp: number) => matches(dateTime.format(timestamp).replaceAll('-', '/'))

  return ({ savePath, stopReason, startTimestamp, stopTimestamp }: RecordModel) => {
    if (matches(savePath) || matches(stopReason ?? '/') || matchesTimestamp(startTimestamp)) return true
    if (!stopTimestamp) return matches('/')
    if (matchesTimestamp(stopTimestamp)) return true

    const duration = intervalToDuration({ start: startTimestamp, end: Math.max(startTimestamp + 1000, stopTimestamp) })
    if (stopTimestamp - startTimestamp >= 60_000) duration.seconds = 0
    return matches(formatDuration(duration, { locale }))
  }
}

function createDateTimeFormatter(timeZone?: string) {
  const options = { dateStyle: 'short', timeStyle: 'medium', hourCycle: 'h23' } as const
  try {
    return new Intl.DateTimeFormat('sv-SE', { ...options, timeZone })
  } catch {
    return new Intl.DateTimeFormat('sv-SE', options)
  }
}
