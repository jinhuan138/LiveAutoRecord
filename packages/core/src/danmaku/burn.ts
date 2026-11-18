/**
 * 用 ffmpeg 的 ass 滤镜把弹幕烧录进视频，生成一份新的“弹幕版”视频，原视频保持不变。
 */
import fs from 'fs'
import os from 'os'
import path from 'path'
import crypto from 'crypto'
import { createFFMPEGBuilder } from '@autorecord/manager'
import type { RecordExtraData } from '@autorecord/manager'
import type { DanmakuBurnEncoder, DanmakuStyle } from '@autorecord/shared'
import { generateDanmakuASS } from './ass'

export type DanmakuBurnErrorCode =
  /** 没有可以压制的弹幕 */
  | 'NO_DANMAKU'
  /** 当前 ffmpeg 没有编译 libass，不支持 ass 滤镜 */
  | 'NO_LIBASS'
  | 'ABORTED'
  | 'PROBE_FAILED'
  | 'FFMPEG_FAILED'

export class DanmakuBurnError extends Error {
  constructor(
    public code: DanmakuBurnErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'DanmakuBurnError'
  }
}

export interface VideoInfo {
  width?: number
  height?: number
  /** 秒 */
  duration?: number
}

const encoderArgs: Record<DanmakuBurnEncoder, string[]> = {
  libx264: ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23'],
  h264_nvenc: ['-c:v', 'h264_nvenc', '-preset', 'p4', '-rc', 'vbr', '-cq', '23', '-b:v', '0'],
  h264_qsv: ['-c:v', 'h264_qsv', '-preset', 'veryfast', '-global_quality', '23'],
  h264_amf: ['-c:v', 'h264_amf', '-quality', 'balanced', '-rc', 'cqp', '-qp_i', '23', '-qp_p', '23'],
}

/** 弹幕版视频的保存路径：与原视频同目录，xxx.mp4 -> xxx.弹幕版.mp4 */
export function getDanmakuVideoPath(videoPath: string): string {
  return path.join(path.dirname(videoPath), path.basename(videoPath, path.extname(videoPath)) + '.弹幕版.mp4')
}

/** 通过 ffmpeg 解码第一帧时输出的信息来获取分辨率与时长，避免额外依赖 ffprobe */
export function probeVideo(videoPath: string): Promise<VideoInfo> {
  return new Promise((resolve, reject) => {
    const info: VideoInfo = {}
    const stderrLines: string[] = []

    createFFMPEGBuilder(videoPath)
      .outputOptions('-frames:v', '1', '-an')
      .format('null')
      .output('-')
      .on('stderr', (line: string) => {
        stderrLines.push(line)
        const duration = /Duration: (\d+:\d+:\d+(?:\.\d+)?)/.exec(line)
        if (duration && info.duration == null) {
          info.duration = parseTimemark(duration[1])
        }
        const resolution = /Video:.*?\b(\d{2,5})x(\d{2,5})\b/.exec(line)
        if (resolution && info.width == null) {
          info.width = Number(resolution[1])
          info.height = Number(resolution[2])
        }
      })
      .on('error', (err: Error) => {
        // 只要拿到了分辨率就够用了，比如录制中断的 fmp4 尾部可能不完整导致报错
        if (info.width != null) return resolve(info)
        reject(new DanmakuBurnError('PROBE_FAILED', `${err.message}\n${stderrLines.slice(-10).join('\n')}`))
      })
      .on('end', () => resolve(info))
      .run()
  })
}

export interface BurnDanmakuOpts {
  videoPath: string
  extraData: RecordExtraData
  /** 缺省为 getDanmakuVideoPath(videoPath) */
  outputPath?: string
  encoder?: DanmakuBurnEncoder
  style?: DanmakuStyle
  /** 硬件编码失败时是否自动改用 libx264 重试，默认为 true */
  fallbackToSoftwareEncoder?: boolean
  /** 进度，0 ~ 1 */
  onProgress?: (progress: number) => void
  /** 编码器回退等信息 */
  onLog?: (text: string) => void
  signal?: AbortSignal
}

export interface BurnDanmakuResult {
  outputPath: string
  /** 实际使用的编码器，硬件编码失败回退时与传入的不同 */
  encoder: DanmakuBurnEncoder
  totalComments: number
  renderedComments: number
}

export async function burnDanmaku(opts: BurnDanmakuOpts): Promise<BurnDanmakuResult> {
  const { extraData, signal } = opts
  const videoPath = path.resolve(opts.videoPath)
  const outputPath = path.resolve(opts.outputPath ?? getDanmakuVideoPath(videoPath))
  const normalizePath = (value: string) => (process.platform === 'win32' ? value.toLowerCase() : value)
  if (normalizePath(videoPath) === normalizePath(outputPath)) {
    throw new DanmakuBurnError('FFMPEG_FAILED', 'Output path must differ from the original video path')
  }
  const encoder =
    opts.encoder != null && Object.prototype.hasOwnProperty.call(encoderArgs, opts.encoder) ? opts.encoder : 'libx264'
  throwIfAborted(signal)

  const videoInfo = await probeVideo(videoPath)
  throwIfAborted(signal)

  const ass = generateDanmakuASS(extraData, {
    videoWidth: videoInfo.width,
    videoHeight: videoInfo.height,
    style: opts.style,
  })
  if (ass.rendered === 0) {
    throw new DanmakuBurnError('NO_DANMAKU', 'No danmaku to burn')
  }

  const { recordStartTimestamp, recordStopTimestamp } = extraData.meta
  const duration =
    videoInfo.duration ?? (recordStopTimestamp != null ? (recordStopTimestamp - recordStartTimestamp) / 1e3 : undefined)

  // ass 滤镜的参数需要按 ffmpeg 的规则转义，Windows 路径里的盘符冒号尤其麻烦，
  // 所以把 ass 写到临时目录下一个只含安全字符的文件名，再以临时目录作为 cwd 用相对路径引用。
  const tmpDir = os.tmpdir()
  const assFileName = `lar-danmaku-${crypto.randomBytes(8).toString('hex')}.ass`
  const assPath = path.join(tmpDir, assFileName)
  // 先输出到临时文件，完成后再改名，避免半成品被当成可用的视频
  const tmpOutputPath = `${outputPath}.${crypto.randomBytes(8).toString('hex')}.part`
  await fs.promises.writeFile(assPath, ass.content)

  try {
    let usedEncoder = encoder
    try {
      await runBurn({ ...opts, videoPath, encoder, assFileName, cwd: tmpDir, tmpOutputPath, duration })
    } catch (err) {
      const canFallback =
        encoder !== 'libx264' &&
        (opts.fallbackToSoftwareEncoder ?? true) &&
        err instanceof DanmakuBurnError &&
        err.code === 'FFMPEG_FAILED'
      if (!canFallback) throw err

      opts.onLog?.(`Encoder ${encoder} failed, fallback to libx264. ${err.message}`)
      usedEncoder = 'libx264'
      opts.onProgress?.(0)
      await runBurn({ ...opts, videoPath, encoder: usedEncoder, assFileName, cwd: tmpDir, tmpOutputPath, duration })
    }

    throwIfAborted(signal)
    await fs.promises.rename(tmpOutputPath, outputPath)
    return {
      outputPath,
      encoder: usedEncoder,
      totalComments: ass.total,
      renderedComments: ass.rendered,
    }
  } catch (err) {
    await fs.promises.rm(tmpOutputPath, { force: true }).catch(noop)
    throw err
  } finally {
    await fs.promises.rm(assPath, { force: true }).catch(noop)
  }
}

function runBurn(
  opts: Pick<BurnDanmakuOpts, 'videoPath' | 'onProgress' | 'signal'> & {
    encoder: DanmakuBurnEncoder
    assFileName: string
    cwd: string
    tmpOutputPath: string
    duration?: number
  },
): Promise<void> {
  const { signal, duration } = opts
  throwIfAborted(signal)

  return new Promise((resolve, reject) => {
    const stderrLines: string[] = []
    let noLibass = false

    const command = createFFMPEGBuilder(opts.videoPath, { cwd: opts.cwd })
      .videoFilters(`ass=${opts.assFileName}`)
      .outputOptions(
        '-map',
        '0:v:0',
        '-map',
        '0:a?',
        ...encoderArgs[opts.encoder],
        '-c:a',
        'copy',
        '-max_muxing_queue_size',
        '1024',
        '-movflags',
        '+faststart',
      )
      .format('mp4')
      .output(opts.tmpOutputPath)
      .on('start', () => {
        // 取消可能发生在 ffmpeg 子进程真正启动之前。
        if (signal?.aborted) onAbort()
      })
      .on('stderr', (line: string) => {
        stderrLines.push(line)
        if (stderrLines.length > 50) stderrLines.shift()
        if (/No such filter: 'ass'/.test(line)) noLibass = true
      })
      .on('progress', (progress: { timemark?: string }) => {
        if (!duration || !progress.timemark) return
        opts.onProgress?.(Math.max(0, Math.min(1, parseTimemark(progress.timemark) / duration)))
      })
      .on('error', (err: Error) => {
        signal?.removeEventListener('abort', onAbort)
        if (signal?.aborted) {
          reject(new DanmakuBurnError('ABORTED', 'Aborted'))
        } else if (noLibass) {
          reject(new DanmakuBurnError('NO_LIBASS', 'The ffmpeg in use was built without libass'))
        } else {
          reject(new DanmakuBurnError('FFMPEG_FAILED', `${err.message}\n${stderrLines.slice(-10).join('\n')}`))
        }
      })
      .on('end', () => {
        signal?.removeEventListener('abort', onAbort)
        if (signal?.aborted) {
          reject(new DanmakuBurnError('ABORTED', 'Aborted'))
          return
        }
        opts.onProgress?.(1)
        resolve()
      })

    function onAbort() {
      command.kill('SIGKILL')
    }
    signal?.addEventListener('abort', onAbort)

    command.run()
  })
}

function parseTimemark(timemark: string): number {
  const [h, m, s] = timemark.split(':').map(Number)
  return h * 3600 + m * 60 + s
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new DanmakuBurnError('ABORTED', 'Aborted')
}

function noop() {}
