import fs from 'fs'
import path from 'path'
import { Router } from 'express'
import { readRecordExtraData, recordExtraDataExists } from '@autorecord/manager'
import { API } from './api_types'
import { asyncRouteHandler, createPagedResultGetter, getNumberFromQuery } from './utils'
import * as db from '../db'
import { assertStringType, replaceExtName } from '../utils'
import { genSRTFile, recorderManager } from '../manager'
import { ServerOpts } from '../types'
import {
  cancelDanmakuBurn,
  enqueueDanmakuBurn,
  generateRecordASS,
  getDanmakuBurnTask,
  getDanmakuBurnTasks,
} from '../danmaku_burn'

const router = Router()

async function checkRecordFiles(items: db.RecordModel[]) {
  const checked: (db.RecordModel & { isFileExists: boolean })[] = []
  const batchSize = 32
  for (let start = 0; start < items.length; start += batchSize) {
    const batch = await Promise.all(
      items.slice(start, start + batchSize).map(async (item) => ({
        ...item,
        isFileExists: await fs.promises.access(item.savePath).then(
          () => true,
          () => false,
        ),
      })),
    )
    checked.push(...batch)
  }
  return checked
}

async function getRecords({ page, pageSize, ...query }: API.getRecords.Args): Promise<API.getRecords.Resp> {
  const pagedGetter = createPagedResultGetter(async (startIdx, count) => {
    const { items, total } = db.getRecords({
      ...query,
      start: startIdx,
      count,
    })
    return { items: await checkRecordFiles(items), total }
  })
  return pagedGetter(page, pageSize)
}

function getRecord(args: API.getRecord.Args): API.getRecord.Resp {
  const record = db.getRecord(args.id)
  if (record == null) throw new Error('404')

  return record
}

router.route('/records').get(
  asyncRouteHandler(async (req, res) => {
    const { recorderId, search, timeZone, locale, sortBy, sortOrder } = req.query
    if (recorderId != null) {
      assertStringType(recorderId)
    }
    const page = getNumberFromQuery(req, 'page', { defaultValue: 1, min: 1 })
    const pageSize = getNumberFromQuery(req, 'pageSize', {
      defaultValue: 10,
      min: 1,
      max: 9999,
    })

    if (
      (sortBy != null && !db.isRecordSortKey(sortBy)) ||
      (sortOrder != null && sortOrder !== 'asc' && sortOrder !== 'desc')
    ) {
      res.status(400).json({ payload: null, error: 'Invalid record sort' })
      return
    }

    const payload = await getRecords({
      recorderId,
      page: Number.isSafeInteger(page) ? page : 1,
      pageSize: Math.trunc(pageSize),
      search: typeof search === 'string' ? search : undefined,
      timeZone: typeof timeZone === 'string' ? timeZone : undefined,
      locale: typeof locale === 'string' ? locale : undefined,
      sortBy,
      sortOrder,
    })
    res.json({ payload })
  }),
)

router.route('/records/clear_invalid').post(
  asyncRouteHandler(async (req, res) => {
    const { recorderId } = req.body
    if (recorderId != null) {
      assertStringType(recorderId)
    }

    const { items } = db.getRecords({ recorderId })
    const checked = await checkRecordFiles(items.slice())
    const invalidIds = checked.filter((item) => !item.isFileExists).map((item) => item.id)
    db.removeRecords(invalidIds)

    res.json({ payload: invalidIds.length })
  }),
)

router.route('/records/:id').get((req, res) => {
  const { id } = req.params
  res.json({ payload: getRecord({ id }) })
})

router.route('/records/:id/video').get((req, res) => {
  const { id } = req.params
  const record = db.getRecord(id)
  if (record == null) {
    res.json({ payload: null }).status(404)
    return
  }

  if (!fs.existsSync(record.savePath)) {
    res.json({ payload: null }).status(404)
    return
  }

  res.download(record.savePath)
})

router.route('/records/:id/extra_data').get(
  asyncRouteHandler(async (req, res) => {
    const record = db.getRecord(req.params.id)
    if (record == null) {
      res.status(404).json({ payload: null })
      return
    }

    try {
      const payload = await readRecordExtraData(replaceExtName(record.savePath, '.json'))
      res.json({ payload })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      res.status(404).json({ payload: null })
    }
  }),
)

router.route('/records/:id/ass').post(
  asyncRouteHandler(async (req, res) => {
    const { id } = req.params
    const record = db.getRecord(id)
    if (record == null || !recordExtraDataExists(replaceExtName(record.savePath, '.json'))) {
      res.status(404).json({ payload: null })
      return
    }

    const payload: API.createRecordASS.Resp = await generateRecordASS(record.savePath)
    res.json({ payload })
  }),
)

router.route('/danmaku_burn_tasks').get((req, res) => {
  const payload: API.getDanmakuBurnTasks.Resp = getDanmakuBurnTasks()
  res.json({ payload })
})

router
  .route('/records/:id/danmaku_burn')
  .get((req, res) => {
    const payload: API.getDanmakuBurnTask.Resp = getDanmakuBurnTask(req.params.id) ?? null
    res.json({ payload })
  })
  .post((req, res) => {
    const { id } = req.params
    const record = db.getRecord(id)
    if (
      record == null ||
      !fs.existsSync(record.savePath) ||
      !recordExtraDataExists(replaceExtName(record.savePath, '.json'))
    ) {
      res.status(404).json({ payload: null })
      return
    }
    // 异常退出的录制不会有 stopTimestamp，所以这里用是否有正在进行的录制来判断
    if (recorderManager.recorders.some((recorder) => recorder.recordHandle?.id === id)) {
      res.status(409).json({ payload: null, error: 'Record is still in progress' })
      return
    }

    const payload: API.startDanmakuBurn.Resp = enqueueDanmakuBurn({ recordId: id, savePath: record.savePath })
    res.json({ payload })
  })
  .delete((req, res) => {
    const payload: API.cancelDanmakuBurn.Resp = cancelDanmakuBurn(req.params.id) ?? null
    res.json({ payload })
  })

export function createRouter(serverOpts: Pick<ServerOpts, 'getSettings'>) {
  const recordRouter = Router()
  recordRouter.use(router)

  recordRouter.route('/records/:id/srt').post(
    asyncRouteHandler(async (req, res) => {
      const { id } = req.params
      const record = db.getRecord(id)
      if (record == null) {
        res.json({ payload: null }).status(404)
        return
      }

      const extraDataPath = replaceExtName(record.savePath, '.json')
      if (!recordExtraDataExists(extraDataPath)) {
        res.json({ payload: null }).status(404)
        return
      }

      // 感觉不用做什么优化，这里直接覆盖旧文件
      const srtPath = replaceExtName(record.savePath, '.srt')
      const { srtShowSender } = await serverOpts.getSettings()
      await genSRTFile(extraDataPath, srtPath, srtShowSender)

      res.json({
        // 考虑到服务端安全，这里就先只返回 filename
        payload: path.basename(srtPath),
      })
    }),
  )

  return recordRouter
}
