import fs from 'fs'
import path from 'path'
import { redactRecordExtraData } from '@autorecord/manager'
import type { RecordExtraData } from '@autorecord/manager'
import { TextFile } from '@autorecord/shared'

/** meta 总是序列化在文件开头，只读取开头这部分就能判断是否需要脱敏，避免把大量弹幕整个读进来 */
const HEAD_BYTES = 64 * 1024
/** 未脱敏的凭证头，已脱敏的 `Cookie: <redacted>` 不会匹配，所以处理过的文件之后只读文件头 */
const UNREDACTED_PATTERN = /(?:cookie|authorization):(?!\s*<redacted>)/i

async function readHead(filePath: string): Promise<string> {
  const handle = await fs.promises.open(filePath, 'r')
  try {
    const buffer = Buffer.alloc(HEAD_BYTES)
    const { bytesRead } = await handle.read(buffer, 0, HEAD_BYTES, 0)
    return buffer.toString('utf8', 0, bytesRead)
  } finally {
    await handle.close()
  }
}

/** @returns 文件是否被改写 */
async function redactRecordExtraDataFile(filePath: string): Promise<boolean> {
  if (!fs.existsSync(filePath)) return false
  if (!UNREDACTED_PATTERN.test(await readHead(filePath))) return false

  const content = await fs.promises.readFile(filePath, 'utf8')
  const { data, changed } = redactRecordExtraData(JSON.parse(content) as RecordExtraData)
  if (!changed) return false

  await new TextFile(filePath).write(JSON.stringify(data))
  return true
}

/**
 * 旧版本写入的录制元信息 json 里可能带有明文 Cookie，对这些视频对应的 json 做脱敏。
 * @returns 被改写的文件数
 */
export async function redactRecordExtraDataFiles(
  videoPaths: string[],
  onError: (filePath: string, error: unknown) => void,
): Promise<number> {
  let redacted = 0
  for (const videoPath of videoPaths) {
    const filePath = path.join(path.dirname(videoPath), path.basename(videoPath, path.extname(videoPath)) + '.json')
    try {
      if (await redactRecordExtraDataFile(filePath)) redacted++
    } catch (error) {
      onError(filePath, error)
    }
  }
  return redacted
}
