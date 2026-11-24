import fs from 'fs'
import type { Message } from './common'
import { redactFFmpegArgs } from './sensitive'

export interface RecordExtraData {
  meta: {
    title?: string
    recordStartTimestamp: number
    recordStopTimestamp?: number
    ffmpegArgs?: string[]
  }
  messages: Message[]
}

export interface RecordExtraDataController {
  readonly data: RecordExtraData
  addMessage: (message: Message) => void
  setMeta: (meta: Partial<RecordExtraData['meta']>) => void
  flush: () => Promise<void>
}

type LogEntry = { meta: RecordExtraData['meta'] } | Message
type WriteBatch = { buffer: Buffer; messages: Message[] }

const maxBatchSize = 500
const maxBatchDelay = 30_000

export function getRecordExtraDataLogPath(legacyPath: string): string {
  return legacyPath.endsWith('.json') ? `${legacyPath}l` : `${legacyPath}.jsonl`
}

export function recordExtraDataExists(legacyPath: string): boolean {
  return fs.existsSync(getRecordExtraDataLogPath(legacyPath)) || fs.existsSync(legacyPath)
}

export async function readRecordExtraData(legacyPath: string): Promise<RecordExtraData> {
  let meta: RecordExtraData['meta'] | undefined
  const messages: Message[] = []
  let remaining = ''
  try {
    const stream = fs.createReadStream(getRecordExtraDataLogPath(legacyPath), { encoding: 'utf8' })
    for await (const chunk of stream) {
      const lines = (remaining + chunk).split('\n')
      remaining = lines.pop() ?? ''
      for (const line of lines) {
        const entry: LogEntry = JSON.parse(line)
        if ('meta' in entry) meta = entry.meta
        else messages.push(entry)
      }
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }

  // The last line can be incomplete if the recording is still writing or was interrupted.
  if (meta != null) return { meta, messages }
  return JSON.parse(await fs.promises.readFile(legacyPath, 'utf8')) as RecordExtraData
}

export function createRecordExtraDataController(legacyPath: string): RecordExtraDataController {
  const logPath = getRecordExtraDataLogPath(legacyPath)
  let meta: RecordExtraData['meta'] = { recordStartTimestamp: Date.now() }
  let metaDirty = true
  const pending: Message[] = []
  let batch: WriteBatch | undefined
  let committedBytes = 0
  let timer: NodeJS.Timeout | undefined
  let writing: Promise<void> | undefined

  function createBatch(): WriteBatch {
    const messages = pending.slice(0, maxBatchSize)
    const entries: LogEntry[] = metaDirty ? [{ meta }, ...messages] : messages
    const buffer = Buffer.from(entries.map((entry) => JSON.stringify(entry)).join('\n') + '\n')
    pending.splice(0, messages.length)
    metaDirty = false
    return { buffer, messages }
  }

  async function writePending() {
    while (batch != null || metaDirty || pending.length > 0) {
      batch ??= createBatch()
      const { buffer } = batch
      const handle = await fs.promises.open(logPath, committedBytes === 0 ? 'w' : 'r+')
      try {
        // Retry an interrupted batch at the same offset so a partial write cannot duplicate messages.
        let written = 0
        while (written < buffer.length) {
          const { bytesWritten } = await handle.write(
            buffer,
            written,
            buffer.length - written,
            committedBytes + written,
          )
          if (bytesWritten === 0) throw new Error('Could not write recording metadata')
          written += bytesWritten
        }
      } finally {
        await handle.close()
      }
      committedBytes += buffer.length
      batch = undefined
    }
  }

  function flush() {
    clearTimeout(timer)
    timer = undefined
    writing ??= writePending().finally(() => {
      writing = undefined
      if (batch == null && (metaDirty || pending.length > 0)) schedule(pending.length >= maxBatchSize)
    })
    return writing
  }

  function runScheduledFlush() {
    void flush().catch((error) => console.error('Failed to write recording metadata:', error))
  }

  function schedule(immediate: boolean) {
    if (writing != null) return
    if (immediate && batch == null) {
      runScheduledFlush()
      return
    }
    timer ??= setTimeout(runScheduledFlush, maxBatchDelay)
  }

  return {
    get data() {
      const messages: Message[] = []
      if (committedBytes > 0) {
        const content = fs.readFileSync(logPath).subarray(0, committedBytes).toString('utf8')
        for (const line of content.trimEnd().split('\n')) {
          const entry: LogEntry = JSON.parse(line)
          if (!('meta' in entry)) messages.push(entry)
        }
      }
      return { meta: { ...meta }, messages: messages.concat(batch?.messages ?? [], pending) }
    },
    addMessage(message) {
      pending.push(message)
      schedule(pending.length >= maxBatchSize)
    },
    setMeta(update) {
      meta = { ...meta, ...update }
      if (update.ffmpegArgs) meta.ffmpegArgs = redactFFmpegArgs(update.ffmpegArgs)
      metaDirty = true
      schedule(committedBytes === 0)
    },
    flush,
  }
}
