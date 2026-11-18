/**
 * 弹幕压制任务的管理：排队、进度、取消。
 * 视频编码很吃 CPU / GPU，所以任务串行执行，同一时间只压制一个视频。
 * 任务状态只保存在内存里，程序重启后丢失（已经生成的文件不受影响）。
 */
import fs from 'fs'
import path from 'path'
import {
  burnDanmaku,
  DanmakuBurnError,
  generateDanmakuASS,
  getDanmakuVideoPath,
  probeVideo,
  type DanmakuBurnErrorCode,
} from '@autorecord/core'
import type { RecordExtraData } from '@autorecord/manager'
import type { DanmakuBurnEncoder } from '@autorecord/shared'
import { ServerOpts } from './types'
import { replaceExtName } from './utils'

export type DanmakuBurnTaskStatus = 'queued' | 'running' | 'success' | 'failed' | 'canceled'

export interface DanmakuBurnTask {
  recordId: string
  status: DanmakuBurnTaskStatus
  /** 0 ~ 1 */
  progress: number
  /** 实际使用的编码器，压制成功后才有值 */
  encoder?: DanmakuBurnEncoder
  /** 考虑到服务端安全，只返回文件名 */
  outputFileName?: string
  totalComments?: number
  renderedComments?: number
  errorCode?: DanmakuBurnErrorCode
  error?: string
  createdAt: number
  finishedAt?: number
}

interface TaskContext {
  task: DanmakuBurnTask
  savePath: string
  /** 录制刚结束时，ffmpeg 可能还在收尾写文件，需要等文件稳定后再开始 */
  waitForFileStable: boolean
  abortController: AbortController
}

let serverOpts: ServerOpts | undefined
const tasks = new Map<string, TaskContext>()
const queue: TaskContext[] = []
let running: TaskContext | undefined
const listeners = new Set<(task: DanmakuBurnTask) => void>()

export function initDanmakuBurn(opts: ServerOpts): void {
  serverOpts = opts
}

function getServerOpts(): ServerOpts {
  if (serverOpts == null) throw new Error('Must call initDanmakuBurn before using it')
  return serverOpts
}

export function onDanmakuBurnTaskUpdate(listener: (task: DanmakuBurnTask) => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function notify(ctx: TaskContext) {
  const task = { ...ctx.task }
  listeners.forEach((listener) => listener(task))
}

export function getDanmakuBurnTasks(): DanmakuBurnTask[] {
  return [...tasks.values()].map((ctx) => ({ ...ctx.task }))
}

export function getDanmakuBurnTask(recordId: string): DanmakuBurnTask | undefined {
  const ctx = tasks.get(recordId)
  return ctx && { ...ctx.task }
}

export function enqueueDanmakuBurn(opts: {
  recordId: string
  savePath: string
  waitForFileStable?: boolean
}): DanmakuBurnTask {
  const existing = tasks.get(opts.recordId)
  if (existing && (existing.task.status === 'queued' || existing.task.status === 'running')) {
    return { ...existing.task }
  }

  const ctx: TaskContext = {
    task: {
      recordId: opts.recordId,
      status: 'queued',
      progress: 0,
      createdAt: Date.now(),
    },
    savePath: opts.savePath,
    waitForFileStable: opts.waitForFileStable ?? false,
    abortController: new AbortController(),
  }
  tasks.set(opts.recordId, ctx)
  queue.push(ctx)
  notify(ctx)
  void runNext()

  return { ...ctx.task }
}

export function cancelDanmakuBurn(recordId: string): DanmakuBurnTask | undefined {
  const ctx = tasks.get(recordId)
  if (ctx == null) return undefined

  if (ctx.task.status === 'queued') {
    queue.splice(queue.indexOf(ctx), 1)
    finish(ctx, { status: 'canceled' })
  } else if (ctx.task.status === 'running') {
    // 实际的状态变更在 burnDanmaku 抛出 ABORTED 后处理
    ctx.abortController.abort()
  }
  return { ...ctx.task }
}

/** 生成与录像同名的 .ass 文件，返回文件名 */
export async function generateRecordASS(savePath: string): Promise<string> {
  const { danmakuStyle } = await getServerOpts().getSettings()
  const extraData = await readExtraData(savePath)
  const videoInfo = await probeVideo(savePath).catch(() => ({ width: undefined, height: undefined }))
  const ass = generateDanmakuASS(extraData, {
    videoWidth: videoInfo.width,
    videoHeight: videoInfo.height,
    style: danmakuStyle,
  })

  const assPath = replaceExtName(savePath, '.ass')
  await fs.promises.writeFile(assPath, ass.content)
  return path.basename(assPath)
}

async function runNext(): Promise<void> {
  if (running != null) return
  const ctx = queue.shift()
  if (ctx == null) return

  running = ctx
  try {
    await runTask(ctx)
  } finally {
    running = undefined
    void runNext()
  }
}

async function runTask(ctx: TaskContext): Promise<void> {
  const { logger, getSettings } = getServerOpts()
  const { task, savePath, abortController } = ctx

  task.status = 'running'
  notify(ctx)

  try {
    if (ctx.waitForFileStable) {
      await waitForFileStable(savePath, abortController.signal)
    }

    const { danmakuBurnEncoder, danmakuStyle } = await getSettings()
    const extraData = await readExtraData(savePath)

    let lastNotifyTime = 0
    const result = await burnDanmaku({
      videoPath: savePath,
      outputPath: getDanmakuVideoPath(savePath),
      extraData,
      encoder: danmakuBurnEncoder,
      style: danmakuStyle,
      signal: abortController.signal,
      onProgress: (progress) => {
        task.progress = progress
        // 进度会通过 SSE 推送，这里限制下频率
        const now = Date.now()
        if (now - lastNotifyTime < 1000) return
        lastNotifyTime = now
        notify(ctx)
      },
      onLog: (text) => logger.warn(`[DanmakuBurn][${task.recordId}] ${text}`),
    })

    finish(ctx, {
      status: 'success',
      progress: 1,
      encoder: result.encoder,
      outputFileName: path.basename(result.outputPath),
      totalComments: result.totalComments,
      renderedComments: result.renderedComments,
    })
    logger.info(`[DanmakuBurn][${task.recordId}] done, output: ${result.outputPath}`)
  } catch (err) {
    if (err instanceof DanmakuBurnError && err.code === 'ABORTED') {
      finish(ctx, { status: 'canceled' })
      return
    }

    const errorCode = err instanceof DanmakuBurnError ? err.code : undefined
    const error = err instanceof Error ? err.message : String(err)
    finish(ctx, { status: 'failed', errorCode, error })
    logger.error(`[DanmakuBurn][${task.recordId}] failed: ${error}`)
  }
}

function finish(ctx: TaskContext, patch: Partial<DanmakuBurnTask>) {
  Object.assign(ctx.task, patch, { finishedAt: Date.now() })
  notify(ctx)
}

async function readExtraData(savePath: string): Promise<RecordExtraData> {
  const buffer = await fs.promises.readFile(replaceExtName(savePath, '.json'))
  return JSON.parse(buffer.toString()) as RecordExtraData
}

/** 等到文件大小连续两次检查都不再变化 */
async function waitForFileStable(filePath: string, signal: AbortSignal, maxWait = 60e3): Promise<void> {
  const startTime = Date.now()
  let lastSize = -1
  while (Date.now() - startTime < maxWait) {
    if (signal.aborted) throw new DanmakuBurnError('ABORTED', 'Aborted')
    await new Promise((resolve) => setTimeout(resolve, 3e3))
    if (signal.aborted) throw new DanmakuBurnError('ABORTED', 'Aborted')
    const size = fs.existsSync(filePath) ? fs.statSync(filePath).size : -1
    if (size > 0 && size === lastSize) return
    lastSize = size
  }
  throw new DanmakuBurnError('FFMPEG_FAILED', 'Video file did not become stable within 60 seconds')
}
