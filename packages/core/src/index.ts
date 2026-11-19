export { appName, paths } from './env'
export { Low, MissingAdapterError } from './lowdb'
export { assert, pick, ensureFileFolderExists, readJSONFileSync, writeJSONFileSync } from './utils'
export type {
  RecorderExtra,
  DatabaseSchema,
  RecordModel,
  RecorderModel,
  QueryRecordsOpts,
  ManagerConfig,
} from './types'
export { managerConfigKeys } from './types'
export {
  DATA_BACKUP_INTERVAL,
  createEmptyDatabase,
  isDatabaseSchema,
  isManagerConfig,
  readManagerConfigFile,
  updateManagerConfigFile,
  updateProviderAuthConfig,
} from './data-file'
export { redactRecordExtraDataFiles } from './record-extra-data'
export {
  readJSONFileWithRecovery,
  rotateBackups,
  type JSONFileRecoveryResult,
  type JSONFileRecoveryStatus,
} from '@autorecord/shared'
export {
  generateDanmakuASS,
  resolveDanmakuStyle,
  getDefaultDanmakuFontName,
  type GenerateDanmakuASSOpts,
  type GenerateDanmakuASSResult,
} from './danmaku/ass'
export {
  burnDanmaku,
  probeVideo,
  getDanmakuVideoPath,
  DanmakuBurnError,
  type DanmakuBurnErrorCode,
  type BurnDanmakuOpts,
  type BurnDanmakuResult,
  type VideoInfo,
} from './danmaku/burn'

// Re-export shared adapters for convenience
export { JSONFile, JSONFileSync, Adapter } from './lowdb'
