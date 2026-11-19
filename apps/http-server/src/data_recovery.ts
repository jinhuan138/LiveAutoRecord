import type { JSONFileRecoveryResult } from '@autorecord/core'
import { ServerOpts } from './types'

export type DataFileKind = 'database' | 'managerConfig'

export interface DataRecoveryNotice {
  file: DataFileKind
  status: 'restored' | 'reset'
  corruptedPath?: string
  restoredFrom?: string
  restoredFromTime?: number
}

// 只在内存中保留本次运行期间的提示，用户确认后清空
let notices: DataRecoveryNotice[] = []

export function reportDataRecovery(
  file: DataFileKind,
  result: JSONFileRecoveryResult<unknown>,
  { logger }: Pick<ServerOpts, 'logger'>,
): void {
  if (result.status === 'ok' || result.status === 'missing') return

  logger.error(`Failed to read ${file}:`, result.error)
  if (result.status === 'restored') {
    logger.warn(`${file} restored from ${result.restoredFrom}, corrupted file kept at ${result.corruptedPath}`)
  } else {
    logger.warn(`${file} reset to empty because no valid backup found, corrupted file kept at ${result.corruptedPath}`)
  }

  notices.push({
    file,
    status: result.status,
    corruptedPath: result.corruptedPath,
    restoredFrom: result.restoredFrom,
    restoredFromTime: result.restoredFromTime,
  })
}

export function getDataRecoveryNotices(): DataRecoveryNotice[] {
  return notices
}

export function clearDataRecoveryNotices(): void {
  notices = []
}
