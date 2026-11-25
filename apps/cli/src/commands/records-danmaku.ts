import fs from 'fs'
import path from 'path'
import { Command, Option } from 'commander'
import {
  burnDanmaku,
  DanmakuBurnError,
  generateDanmakuASS,
  getDanmakuVideoPath,
  paths,
  probeVideo,
  readJSONFileSync,
} from '@autorecord/core'
import { readRecordExtraData } from '@autorecord/manager'
import { DanmakuBurnEncoders, type DanmakuBurnEncoder, type Settings } from '@autorecord/shared'
import { initManager } from '../core/manager-init'
import { getRecords, type RecordModel } from '../core/db'
import { isJsonMode, logger, outputError, outputSuccess } from '../core/output'

/** 与桌面端 / http-server 共用同一份设置，弹幕样式和编码器默认取自这里 */
function getSettings(): Partial<Settings> {
  return readJSONFileSync<Partial<Settings>>(path.join(paths.config, 'settings.json'), {})
}

/** 支持完整 ID 或 `lar records` 中显示的 ID 前缀 */
function findRecord(idOrPrefix: string): RecordModel {
  const { items } = getRecords()
  const exact = items.find((r) => r.id === idOrPrefix)
  if (exact) return exact

  const matched = items.filter((r) => r.id.startsWith(idOrPrefix))
  if (matched.length === 0) throw new Error(`Record "${idOrPrefix}" not found`)
  if (matched.length > 1) throw new Error(`Record ID prefix "${idOrPrefix}" is ambiguous, please use a longer one`)
  return matched[0]
}

function readExtraData(savePath: string) {
  const extraDataPath = path.join(path.dirname(savePath), path.basename(savePath, path.extname(savePath)) + '.json')
  return readRecordExtraData(extraDataPath)
}

export function createRecordsASSCommand(): Command {
  return new Command('ass')
    .description('Generate an ASS danmaku subtitle file next to the video')
    .argument('<id>', 'Record ID (or ID prefix)')
    .addHelpText(
      'after',
      `
Examples:
  $ lar records ass 1a2b3c4d            # generate xxx.ass next to xxx.mp4`,
    )
    .action(async (id: string) => {
      await initManager()

      try {
        const record = findRecord(id)
        const extraData = await readExtraData(record.savePath)
        const videoInfo = await probeVideo(record.savePath).catch(() => ({ width: undefined, height: undefined }))
        const ass = generateDanmakuASS(extraData, {
          videoWidth: videoInfo.width,
          videoHeight: videoInfo.height,
          style: getSettings().danmakuStyle,
        })

        const assPath = path.join(
          path.dirname(record.savePath),
          path.basename(record.savePath, path.extname(record.savePath)) + '.ass',
        )
        fs.writeFileSync(assPath, ass.content)

        outputSuccess(
          { recordId: record.id, assPath, total: ass.total, rendered: ass.rendered },
          `ASS generated: ${assPath} (${ass.rendered} / ${ass.total} danmaku)`,
        )
      } catch (err) {
        outputError(err instanceof Error ? err.message : String(err))
        process.exitCode = 1
      }
    })
}

export function createRecordsBurnCommand(): Command {
  return new Command('burn')
    .description('Burn danmaku into a new video (xxx.弹幕版.mp4), the original video is kept')
    .argument('<id>', 'Record ID (or ID prefix)')
    .addOption(
      new Option('--encoder <encoder>', 'Video encoder, defaults to the one in app settings').choices(
        DanmakuBurnEncoders,
      ),
    )
    .option('--output <path>', 'Output path, defaults to xxx.弹幕版.mp4 next to the video')
    .addHelpText(
      'after',
      `
Examples:
  $ lar records burn 1a2b3c4d                       # burn with encoder in app settings (default libx264)
  $ lar records burn 1a2b3c4d --encoder h264_nvenc  # use NVIDIA hardware encoder
  $ lar records burn 1a2b3c4d --json                # JSON output`,
    )
    .action(async (id: string, opts: { encoder?: DanmakuBurnEncoder; output?: string }) => {
      await initManager()

      try {
        const record = findRecord(id)
        const extraData = await readExtraData(record.savePath)
        const settings = getSettings()

        let lastPercent = -1
        const result = await burnDanmaku({
          videoPath: record.savePath,
          outputPath: opts.output ?? getDanmakuVideoPath(record.savePath),
          extraData,
          encoder: opts.encoder ?? settings.danmakuBurnEncoder,
          style: settings.danmakuStyle,
          onProgress: (progress) => {
            if (isJsonMode()) return
            const percent = Math.floor(progress * 100)
            if (percent === lastPercent) return
            lastPercent = percent
            process.stderr.write(`\rBurning danmaku... ${percent}%`)
          },
          onLog: (text) => logger.warn(text),
        })
        if (!isJsonMode()) process.stderr.write('\n')

        outputSuccess(
          { recordId: record.id, ...result },
          `Danmaku video generated: ${result.outputPath} (encoder: ${result.encoder}, ${result.renderedComments} / ${result.totalComments} danmaku)`,
        )
      } catch (err) {
        if (!isJsonMode()) process.stderr.write('\n')
        const code = err instanceof DanmakuBurnError ? err.code : undefined
        outputError(err instanceof Error ? err.message : String(err), code ? { code } : undefined)
        process.exitCode = 1
      }
    })
}
