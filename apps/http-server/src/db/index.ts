/**
 * 预期上这里要选一个轻量级的文件数据库，从调研结果看，sqlite 的库基本都要 native 模块，
 * 这会提升 node / electron 混合的项目的复杂度，因为需要经常切换 electron-build & node-gyp 编译。
 * 所以最后选了其他的文件类型，目前使用 json 库来尝试看看，缺点是这些字符串类型的库
 * 都需要数据库全量载入到内存，对于内存占用和文件空间占用都会偏大。
 *
 * 之后记录条数多了性能有问题的话，可以考虑分表、限制表条数上限等方案。
 */
import path from 'path'
import {
  Low,
  JSONFile,
  paths,
  assert,
  ensureFileFolderExists,
  createEmptyDatabase,
  isDatabaseSchema,
  readJSONFileWithRecovery,
  rotateBackups,
  DATA_BACKUP_INTERVAL,
} from '@autorecord/core'
import type { DatabaseSchema, RecordModel, RecorderModel, QueryRecordsOpts } from '@autorecord/core'
import { asyncThrottle } from '../utils'
import { ServerOpts } from '../types'
import { reportDataRecovery } from '../data_recovery'

export type { DatabaseSchema, RecordModel, RecorderModel, QueryRecordsOpts }

const dbPath = path.join(paths.data, 'data.json')
const adapter = new JSONFile<DatabaseSchema>(dbPath)
const db = new Low(adapter)
let logger: ServerOpts['logger'] = console

export async function initDB(serverOpts: ServerOpts) {
  logger = serverOpts.logger

  // 理论上这个文件的保存过程是原子化的不会损坏，但根据 https://github.com/WhiteMinds/LiveAutoRecord/issues/193 的反馈仍然出现了损坏的情况，
  // 所以读取时会校验数据结构，损坏时保留损坏文件并从最近一份有效的备份恢复。
  const recovery = readJSONFileWithRecovery<DatabaseSchema>(dbPath, { validate: isDatabaseSchema })
  reportDataRecovery('database', recovery, serverOpts)
  if (recovery.status === 'ok') {
    backupDB(0)
  }
  db.data = recovery.data ?? createEmptyDatabase()

  // 这里做一些旧版本 schema 升级的处理
  if (db.data.recorders == null) {
    // v4.0.0 -> v4.0.1
    db.data.recorders = []
    db.data.nextRecorderId = 1
  }

  const legacyRecorders = db.data.recorders.filter(
    (recorder) => recorder.autoGenerateSRTOnRecordStop == null || recorder.autoBurnDanmakuOnRecordStop == null,
  )
  if (legacyRecorders.length > 0) {
    const settings = await serverOpts.getSettings()
    for (const recorder of legacyRecorders) {
      recorder.autoGenerateSRTOnRecordStop ??= settings.autoGenerateSRTOnRecordStop === true
      recorder.autoBurnDanmakuOnRecordStop ??= settings.autoBurnDanmakuOnRecordStop === true
    }
    ensureFileFolderExists(dbPath)
    await db.write()
  }
}

function assertDBReady<T>(db: Low<T>): asserts db is Low<T> & { data: T } {
  return assert(db.data, 'Must initialize the db before using it')
}

function backupDB(minIntervalMs: number) {
  try {
    rotateBackups(dbPath, { minIntervalMs })
  } catch (error) {
    logger.error('Failed to backup db:', error)
  }
}

// TODO: 测试暂时用 1s
const scheduleSave = asyncThrottle(async () => {
  ensureFileFolderExists(dbPath)
  await db.write()
  backupDB(DATA_BACKUP_INTERVAL)
}, 1e3)

export function getRecord(id: RecordModel['id']): RecordModel | undefined {
  assertDBReady(db)

  return db.data.records.find((item) => item.id === id)
}

export function getRecords(opts: QueryRecordsOpts = {}): {
  items: RecordModel[]
  total: number
} {
  assertDBReady(db)

  // TODO: 之后性能有问题的话应该可以用 transduce 做优化
  let items = db.data.records
  if (opts.recorderId != null) {
    items = items.filter((item) => item.recorderId === opts.recorderId)
  }
  const count = items.length
  if (opts.start != null) {
    items = items.slice(opts.start)
  }
  if (opts.count != null) {
    items = items.slice(0, opts.count)
  }

  return { items, total: count }
}

export type InsertRecordProps = RecordModel
export function insertRecord(props: InsertRecordProps): void {
  assertDBReady(db)
  const model: RecordModel = props
  db.data.records.push(model)
  scheduleSave()
}

export function removeRecord(id: RecordModel['id']): void {
  assertDBReady(db)
  const idx = db.data.records.findIndex((record) => record.id === id)
  if (idx === -1) return

  db.data.records.splice(idx, 1)
  scheduleSave()
}

export function removeRecords(ids: RecordModel['id'][]): void {
  assertDBReady(db)
  db.data.records = db.data.records.filter((record) => !ids.includes(record.id))
  scheduleSave()
}

export function updateRecordStopData(
  props: Required<Pick<RecordModel, 'id' | 'stopTimestamp'>> & Pick<RecordModel, 'stopReason'>,
): void {
  assertDBReady(db)
  // TODO: 性能有问题的话可以在 insert 时做个索引表
  const record = db.data.records.find((record) => record.id === props.id)
  if (record == null) return

  record.stopTimestamp = props.stopTimestamp
  record.stopReason = props.stopReason
  scheduleSave()
}

export function getRecorders(): RecorderModel[] {
  assertDBReady(db)

  return db.data.recorders
}

export type InsertRecorderProps = RecorderModel
export function insertRecorder(props: InsertRecorderProps): void {
  assertDBReady(db)
  const model: RecorderModel = props
  db.data.recorders.push(model)
  scheduleSave()
}

export function removeRecorder(id: RecorderModel['id']): void {
  assertDBReady(db)
  const idx = db.data.recorders.findIndex((recorder) => recorder.id === id)
  if (idx === -1) return

  db.data.recorders.splice(idx, 1)
  scheduleSave()
}

export function updateRecorder(props: RecorderModel): void {
  assertDBReady(db)
  const { id, ...data } = props
  const recorder = db.data.recorders.find((recorder) => recorder.id === id)
  if (recorder == null) return

  Object.assign(recorder, data)
  scheduleSave()
}

export function genRecorderIdInDB() {
  assertDBReady(db)
  const id = db.data.nextRecorderId++
  scheduleSave()
  return id
}
