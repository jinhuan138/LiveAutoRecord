/**
 * JSON 数据文件的多份备份与损坏恢复。
 *
 * 写入本身已经由 TextFile / TextFileSync 做了原子化处理，这里只负责：
 * - 把通过校验的主文件轮转保存为 `<file>.bak.1` ~ `<file>.bak.N`（1 为最新）
 * - 主文件读取或校验失败时保留损坏文件，并按从新到旧的顺序找到第一份通过校验的备份恢复
 */

import { copyFileSync, existsSync, readFileSync, renameSync, rmSync, statSync, utimesSync } from 'node:fs'

import { TextFileSync } from './jsonfile'

export const DEFAULT_MAX_BACKUPS = 3

export type JSONFileRecoveryStatus =
  /** 主文件正常 */
  | 'ok'
  /** 主文件不存在（如首次启动） */
  | 'missing'
  /** 主文件损坏，已从备份恢复 */
  | 'restored'
  /** 主文件损坏，且没有可用的备份 */
  | 'reset'

export interface JSONFileRecoveryResult<T> {
  status: JSONFileRecoveryStatus
  /** status 为 missing / reset 时为 null */
  data: T | null
  /** 主文件读取或校验失败的原因 */
  error?: unknown
  /** 损坏的主文件被保留到的路径 */
  corruptedPath?: string
  /** 用于恢复的备份文件路径 */
  restoredFrom?: string
  /** 用于恢复的备份的创建时间 */
  restoredFromTime?: number
}

export interface ReadJSONFileWithRecoveryOpts<T> {
  /** 校验解析后的数据结构，返回 false 时视为损坏 */
  validate?: (data: unknown) => data is T
  maxBackups?: number
}

export function getBackupPath(filePath: string, index: number): string {
  return `${filePath}.bak.${index}`
}

function getCorruptedPath(filePath: string): string {
  const time = new Date().toISOString().replace(/[:.]/g, '-')
  return `${filePath}.corrupt-${time}`
}

function parseAndValidate<T>(content: string, validate?: (data: unknown) => data is T): T {
  const data: unknown = JSON.parse(content)
  if (validate && !validate(data)) {
    throw new Error('Invalid data structure')
  }
  return data as T
}

export function readJSONFileWithRecovery<T>(
  filePath: string,
  opts: ReadJSONFileWithRecoveryOpts<T> = {},
): JSONFileRecoveryResult<T> {
  const { validate, maxBackups = DEFAULT_MAX_BACKUPS } = opts
  if (!existsSync(filePath)) return { status: 'missing', data: null }

  let error: unknown
  try {
    return { status: 'ok', data: parseAndValidate(readFileSync(filePath, 'utf-8'), validate) }
  } catch (err) {
    error = err
  }

  // 先把损坏的文件挪走保留下来，避免之后的写入把它覆盖掉
  const corruptedPath = getCorruptedPath(filePath)
  renameSync(filePath, corruptedPath)

  for (let i = 1; i <= maxBackups; i++) {
    const backupPath = getBackupPath(filePath, i)
    if (!existsSync(backupPath)) continue

    let content: string
    let data: T
    try {
      content = readFileSync(backupPath, 'utf-8')
      data = parseAndValidate(content, validate)
    } catch {
      continue
    }

    new TextFileSync(filePath).write(content)
    return {
      status: 'restored',
      data,
      error,
      corruptedPath,
      restoredFrom: backupPath,
      restoredFromTime: statSync(backupPath).mtimeMs,
    }
  }

  return { status: 'reset', data: null, error, corruptedPath }
}

export interface RotateBackupsOpts {
  maxBackups?: number
  /** 距离最新一份备份不足这个时间时跳过，用于限制频繁写入场景下的备份次数 */
  minIntervalMs?: number
}

/**
 * 把当前主文件保存为最新的一份备份，调用方需要保证主文件此时是有效的。
 * 主文件内容与最新一份备份相同时不会轮转，避免多份备份变成同一份内容。
 * @returns 是否生成了新的备份
 */
export function rotateBackups(filePath: string, opts: RotateBackupsOpts = {}): boolean {
  const { maxBackups = DEFAULT_MAX_BACKUPS, minIntervalMs = 0 } = opts
  if (maxBackups <= 0 || !existsSync(filePath)) return false

  const latestBackupPath = getBackupPath(filePath, 1)
  if (existsSync(latestBackupPath)) {
    if (Date.now() - statSync(latestBackupPath).mtimeMs < minIntervalMs) return false
    if (readFileSync(latestBackupPath).equals(readFileSync(filePath))) return false
  }

  rmSync(getBackupPath(filePath, maxBackups), { force: true })
  for (let i = maxBackups - 1; i >= 1; i--) {
    const from = getBackupPath(filePath, i)
    if (existsSync(from)) renameSync(from, getBackupPath(filePath, i + 1))
  }

  copyFileSync(filePath, latestBackupPath)
  // 部分平台的 copy 会保留源文件的修改时间，这里统一改成备份时间，供间隔判断与恢复提示使用
  const now = new Date()
  utimesSync(latestBackupPath, now, now)
  return true
}
