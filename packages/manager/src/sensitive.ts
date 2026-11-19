/**
 * ffmpeg 参数里可能带有登录凭证（如 `-headers` 中的 Cookie），这些参数会被展示给用户、
 * 并随录制元信息写入与视频同名的 json 文件，用户分享弹幕文件时会一并泄露凭证。
 * 所以在持久化与对外暴露之前都要经过这里脱敏，真正执行的 ffmpeg 命令不受影响。
 */
import type { RecordExtraData } from './record_extra_data_controller'

export const REDACTED_VALUE = '<redacted>'

const SENSITIVE_HEADERS = ['cookie', 'authorization', 'proxy-authorization']

/** 脱敏 `Name: value\r\nName: value` 形式的 HTTP 头字符串 */
function redactHTTPHeaders(headers: string): string {
  return headers
    .split(/(\r?\n)/)
    .map((line) => {
      const idx = line.indexOf(':')
      if (idx === -1) return line
      const name = line.slice(0, idx)
      return SENSITIVE_HEADERS.includes(name.trim().toLowerCase()) ? `${name}: ${REDACTED_VALUE}` : line
    })
    .join('')
}

export function redactFFmpegArgs(args: string[]): string[] {
  return args.map((arg, idx) =>
    args[idx - 1] === '-headers' && typeof arg === 'string' ? redactHTTPHeaders(arg) : arg,
  )
}

/** 返回脱敏后的数据，没有需要脱敏的内容时返回原对象 */
export function redactRecordExtraData<T extends Pick<RecordExtraData, 'meta'>>(data: T): { data: T; changed: boolean } {
  const args = data.meta?.ffmpegArgs
  if (!Array.isArray(args)) return { data, changed: false }

  const redacted = redactFFmpegArgs(args)
  if (redacted.every((arg, idx) => arg === args[idx])) return { data, changed: false }

  return { data: { ...data, meta: { ...data.meta, ffmpegArgs: redacted } }, changed: true }
}
