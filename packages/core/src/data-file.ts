import { readJSONFileWithRecovery, rotateBackups } from '@autorecord/shared'
import type { JSONFileRecoveryResult } from '@autorecord/shared'
import { writeJSONFileSync } from './utils'
import type { DatabaseSchema, ManagerConfig } from './types'

/** 运行期间两次备份之间的最小间隔，避免录制时频繁写库导致频繁备份 */
export const DATA_BACKUP_INTERVAL = 6 * 60 * 60 * 1000

function isPlainObject(data: unknown): data is Record<string, unknown> {
  return data != null && typeof data === 'object' && !Array.isArray(data)
}

export function createEmptyDatabase(): DatabaseSchema {
  return { records: [], recorders: [], nextRecorderId: 1 }
}

export function isDatabaseSchema(data: unknown): data is DatabaseSchema {
  if (!isPlainObject(data)) return false
  if (!Array.isArray(data.records)) return false
  // v4.0.0 之前的数据没有 recorders 与 nextRecorderId，由调用方做 schema 升级
  if (data.recorders != null && !Array.isArray(data.recorders)) return false
  if (data.nextRecorderId != null && typeof data.nextRecorderId !== 'number') return false
  return true
}

export function isManagerConfig(data: unknown): data is ManagerConfig {
  if (!isPlainObject(data)) return false
  if (data.savePathRule != null && typeof data.savePathRule !== 'string') return false
  if (data.providerAuthConfigs != null && !isPlainObject(data.providerAuthConfigs)) return false
  return true
}

/**
 * 读取 manager.json，损坏时自动从备份恢复。
 * 文件不存在或没有可用备份时返回 defaults 的拷贝，不会返回 defaults 本身，避免调用方修改到默认值。
 */
export function readManagerConfigFile(
  filePath: string,
  defaults: ManagerConfig,
): { config: ManagerConfig; recovery: JSONFileRecoveryResult<ManagerConfig> } {
  const recovery = readJSONFileWithRecovery<ManagerConfig>(filePath, { validate: isManagerConfig })
  const config = recovery.data ?? { ...defaults }
  return { config, recovery }
}

/**
 * manager.json 的统一保存入口：读取文件中的完整配置，合并 patch 后原子写入，
 * 保证只改动 patch 中的字段，不会丢失 providerAuthConfigs 等其他字段。
 */
export function updateManagerConfigFile(
  filePath: string,
  defaults: ManagerConfig,
  patch: Partial<ManagerConfig> | ((config: ManagerConfig) => void),
): ManagerConfig {
  const { config } = readManagerConfigFile(filePath, defaults)
  if (typeof patch === 'function') {
    patch(config)
  } else {
    Object.assign(config, patch)
  }

  writeJSONFileSync(filePath, config)
  rotateBackups(filePath, { minIntervalMs: DATA_BACKUP_INTERVAL })
  return config
}

export function updateProviderAuthConfig(
  filePath: string,
  defaults: ManagerConfig,
  providerId: string,
  authConfig: Record<string, string> | null,
): ManagerConfig {
  return updateManagerConfigFile(filePath, defaults, (config) => {
    const providerAuthConfigs = { ...config.providerAuthConfigs }
    if (authConfig) {
      providerAuthConfigs[providerId] = authConfig
    } else {
      delete providerAuthConfigs[providerId]
    }
    config.providerAuthConfigs = providerAuthConfigs
  })
}
