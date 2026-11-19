import fs from 'fs'
import path from 'path'
import { createRecorderManager, Recorder, RecorderCreateOpts, RecordExtraData } from '@autorecord/manager'
import { provider as providerForDouYu } from '@autorecord/douyu-recorder'
import { provider as providerForBilibili } from '@autorecord/bilibili-recorder'
import { provider as providerForHuYa } from '@autorecord/huya-recorder'
import { provider as providerForDouYin } from '@autorecord/douyin-recorder'
import {
  paths,
  managerConfigKeys,
  readManagerConfigFile,
  rotateBackups,
  updateManagerConfigFile,
  updateProviderAuthConfig,
} from '@autorecord/core'
import type { RecorderExtra, ManagerConfig } from '@autorecord/core'
import { pick, replaceExtName } from './utils'
import {
  genRecorderIdInDB,
  getRecorders,
  insertRecord,
  insertRecorder,
  removeRecord,
  removeRecorder,
  updateRecorder,
  updateRecordStopData,
} from './db'
import { ServerOpts } from './types'
import { enqueueDanmakuBurn, initDanmakuBurn } from './danmaku_burn'
import { reportDataRecovery } from './data_recovery'
import { parseSync, stringifySync } from 'subtitle'

export type { RecorderExtra, ManagerConfig }

const managerConfigPath = path.join(paths.config, 'manager.json')

export const recorderManager = createRecorderManager<RecorderExtra>({
  providers: [providerForDouYu, providerForBilibili, providerForHuYa, providerForDouYin],
})

export const defaultManagerConfig: ManagerConfig = {
  savePathRule: path.join(paths.data, '{platform}/{owner}/{year}-{month}-{date} {hour}-{min}-{sec} {title}.mp4'),
  autoRemoveSystemReservedChars: true,
  autoCheckLiveStatusAndRecord: true,
  autoCheckInterval: 1000,
  ffmpegOutputArgs: recorderManager.ffmpegOutputArgs,
}

export function addRecorderWithAutoIncrementId(args: RecorderCreateOpts<RecorderExtra>): Recorder<RecorderExtra> {
  return recorderManager.addRecorder({
    ...args,
    id: genRecorderIdInDB().toString(),
  })
}

export async function initRecorderManager(serverOpts: ServerOpts): Promise<void> {
  const { logger } = serverOpts
  initDanmakuBurn(serverOpts)

  const { config: managerConfig, recovery } = readManagerConfigFile(managerConfigPath, defaultManagerConfig)
  reportDataRecovery('managerConfig', recovery, serverOpts)
  if (recovery.status === 'ok') {
    try {
      rotateBackups(managerConfigPath)
    } catch (error) {
      logger.error('Failed to backup manager config:', error)
    }
  }

  // 这里做一些旧版本 schema 升级的处理
  if (managerConfig.ffmpegOutputArgs == null) {
    // v0.0.2 -> v1.0.0
    managerConfig.ffmpegOutputArgs = recorderManager.ffmpegOutputArgs
    managerConfig.savePathRule += '.mp4'
  }
  if (managerConfig.autoRemoveSystemReservedChars == null) {
    // v1.0.0 -> v1.1.0
    managerConfig.autoRemoveSystemReservedChars = true
  }

  // 鉴权配置只交给 provider，不挂到 recorderManager 上
  const { providerAuthConfigs, ...managerOpts } = managerConfig
  Object.assign(recorderManager, managerOpts)

  // 加载并应用各 Provider 的鉴权配置
  if (providerAuthConfigs) {
    for (const provider of recorderManager.providers) {
      const authConfig = providerAuthConfigs[provider.id]
      if (authConfig && provider.setAuth) {
        provider.setAuth(authConfig)
      }
    }
  }

  recorderManager.on('error', ({ source, err }) => {
    const errText = err instanceof Error ? (err.stack ?? err.message) : JSON.stringify(err)
    logger.error(`[RecorderManager][${source}]: ${errText}`)
  })

  recorderManager.on('Updated', () => {
    try {
      // 只合并 recorderManager 上的录制配置，文件中的 providerAuthConfigs 等其他字段会被保留
      updateManagerConfigFile(managerConfigPath, defaultManagerConfig, pickManagerOpts(recorderManager))
    } catch (error) {
      logger.error('Failed to save manager config:', error)
    }
  })

  // TODO: 目前持久化的实现方式是不支持多实例同时运行的，考虑在程序运行期间把数据文件持续占用防止意外操作
  const serializedRecorders = getRecorders()
  for (let i = 0; i < serializedRecorders.length; i++) {
    const serialized = serializedRecorders[i]
    recorderManager.addRecorder(serialized)
  }

  if (recorderManager.autoCheckLiveStatusAndRecord) {
    recorderManager.startCheckLoop()
  }

  recorderManager.on('RecordStart', ({ recorder, recordHandle }) => {
    const recordId = recordHandle.id

    insertRecord({
      id: recordId,
      recorderId: recorder.id,
      savePath: recordHandle.savePath,
      startTimestamp: Date.now(),
    })

    const updateRecordOnceRecordStop: Parameters<typeof recorderManager.on<'RecordStop'>>[1] = async ({
      recordHandle,
      reason,
    }) => {
      if (recordHandle.id !== recordId) return
      recorderManager.off('RecordStop', updateRecordOnceRecordStop)

      const { autoGenerateSRTOnRecordStop, autoBurnDanmakuOnRecordStop, autoRemoveRecordWhenTinySize } =
        await serverOpts.getSettings()
      if (
        autoRemoveRecordWhenTinySize &&
        (!fs.existsSync(recordHandle.savePath) || fs.statSync(recordHandle.savePath).size === 0)
      ) {
        const extraDataPath = replaceExtName(recordHandle.savePath, '.json')
        // 直接把错误吞掉，影响不大
        function noop(): void {}
        fs.promises.rm(extraDataPath).catch(noop)
        fs.promises.rm(recordHandle.savePath).catch(noop)

        removeRecord(recordId)
        return
      }

      updateRecordStopData({
        id: recordId,
        stopTimestamp: Date.now(),
        stopReason: reason,
      })

      const extraDataPath = replaceExtName(recordHandle.savePath, '.json')
      if (!fs.existsSync(extraDataPath)) return

      if (autoBurnDanmakuOnRecordStop) {
        enqueueDanmakuBurn({ recordId, savePath: recordHandle.savePath, waitForFileStable: true })
      }

      if (autoGenerateSRTOnRecordStop) {
        await genSRTFile(extraDataPath, replaceExtName(recordHandle.savePath, '.srt'))
      }
    }

    recorderManager.on('RecordStop', updateRecordOnceRecordStop)
  })

  recorderManager.on('RecorderDebugLog', async ({ recorder, ...log }) => {
    const { debugMode } = await serverOpts.getSettings()
    if (!debugMode) return

    if (log.type === 'ffmpeg' && recorder.recordHandle) {
      const logFilePath = replaceExtName(`${recorder.recordHandle.savePath}_${recorder.id}`, '.ffmpeg.log')
      fs.appendFileSync(logFilePath, log.text + '\n')
      return
    }

    logger.debug(`[${recorder.id}][${log.type}]: ${log.text}`)
  })

  recorderManager.on('RecorderAdded', (recorder) => insertRecorder(recorder.toJSON()))
  recorderManager.on('RecorderRemoved', (recorder) => removeRecorder(recorder.id))
  recorderManager.on('RecorderUpdated', ({ recorder }) => updateRecorder(recorder.toJSON()))
}

/** recorderManager 上需要持久化的录制配置，鉴权配置单独由 saveProviderAuthConfig 保存 */
const managerOptKeys = managerConfigKeys.filter(
  (key): key is Exclude<keyof ManagerConfig, 'providerAuthConfigs'> => key !== 'providerAuthConfigs',
)

function pickManagerOpts(source: Partial<ManagerConfig>): Partial<ManagerConfig> {
  return pick(source, ...managerOptKeys)
}

export function saveProviderAuthConfig(providerId: string, authConfig: Record<string, string> | null): void {
  updateProviderAuthConfig(managerConfigPath, defaultManagerConfig, providerId, authConfig)
}

export function getProviderAuthConfigs(): Record<string, Record<string, string>> {
  const { config } = readManagerConfigFile(managerConfigPath, defaultManagerConfig)
  return config.providerAuthConfigs ?? {}
}

// ass 看起来只有序列化和反序列化的库（如 ass-compiler），没有支持帮助排列弹幕的库，
// 要自己实现，成本较高。所以先只简单实现个 srt 的，后面有需要的话再加个 ass 的版本。
export async function genSRTFile(extraDataPath: string, srtPath: string): Promise<void> {
  // TODO: 这里要不要考虑用 RecordExtraDataController 去操作？
  const buffer = await fs.promises.readFile(extraDataPath)
  const recordExtraData = JSON.parse(buffer.toString()) as RecordExtraData

  const parsedSRT = parseSync('')

  recordExtraData.messages.forEach((msg) => {
    switch (msg.type) {
      case 'comment':
        const start = msg.timestamp - recordExtraData.meta.recordStartTimestamp
        // TODO: 先简单写个固定值
        const life = 4500
        parsedSRT.push({
          type: 'cue',
          data: {
            start: start,
            end: start + life,
            text: msg.text,
          },
        })
        break
    }
  })

  await fs.promises.writeFile(srtPath, stringifySync(parsedSRT, { format: 'SRT' }))
}
