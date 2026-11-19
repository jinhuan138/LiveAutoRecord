import { Router } from 'express'
import { clearDataRecoveryNotices, getDataRecoveryNotices } from '../data_recovery'
import { API } from './api_types'

const router = Router()

function getNotices(args: API.getDataRecoveryNotices.Args): API.getDataRecoveryNotices.Resp {
  return getDataRecoveryNotices()
}

function clearNotices(args: API.clearDataRecoveryNotices.Args): API.clearDataRecoveryNotices.Resp {
  clearDataRecoveryNotices()
  return null
}

router
  .route('/data_recovery_notices')
  .get((req, res) => {
    res.json({ payload: getNotices({}) })
  })
  .delete((req, res) => {
    res.json({ payload: clearNotices({}) })
  })

export { router }
