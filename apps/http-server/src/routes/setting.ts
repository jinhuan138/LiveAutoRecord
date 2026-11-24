import { Router } from 'express'
import { Settings } from '@autorecord/shared'
import { API } from './api_types'
import { ServerOpts } from '../types'
import { scheduleBroadcastMessage } from './event'
import { asyncRouteHandler } from './utils'

function splitLegacyDanmakuSettings(settings: Settings) {
  const { autoGenerateSRTOnRecordStop, autoBurnDanmakuOnRecordStop, ...globalSettings } = settings
  return {
    globalSettings,
    legacyDanmakuSettings: { autoGenerateSRTOnRecordStop, autoBurnDanmakuOnRecordStop },
  }
}

export function createRouter(serverOpts: ServerOpts) {
  const router = Router()

  async function getSettings(args: API.getSettings.Args): Promise<API.getSettings.Resp> {
    return splitLegacyDanmakuSettings(await serverOpts.getSettings()).globalSettings
  }

  async function setSettings(args: API.setSettings.Args): Promise<API.setSettings.Resp> {
    // 保留旧值，恢复迁移前的录制任务备份时仍可使用。
    const { legacyDanmakuSettings } = splitLegacyDanmakuSettings(await serverOpts.getSettings())
    const { globalSettings } = splitLegacyDanmakuSettings(args)
    const newSettings = await serverOpts.setSettings({ ...globalSettings, ...legacyDanmakuSettings })
    return splitLegacyDanmakuSettings(newSettings).globalSettings
  }

  router
    .route('/settings')
    .get(
      asyncRouteHandler(async (req, res) => {
        res.json({ payload: await getSettings({}) })
      }),
    )
    .put(
      asyncRouteHandler(async (req, res) => {
        // TODO: 这里先不做 schema 校验，以后再加
        const args = req.body as API.setSettings.Args
        const newSettings = await setSettings(args)

        res.json({ payload: newSettings })

        scheduleBroadcastMessage({
          event: 'settings_change',
          settings: newSettings,
        })
      }),
    )

  return router
}
