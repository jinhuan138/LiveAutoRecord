import {
  Recorder,
  RecorderCreateOpts,
  RecorderManagerCreateOpts,
  RecordExtraData,
  RecordHandle,
  ProviderAuthField,
  ProviderAuthStatus,
} from '@autorecord/manager'
import { Settings } from '@autorecord/shared'
import type { RecordModel, RecordSortKey } from '../db'
import { RecorderExtra } from '../manager'
import type { DanmakuBurnTask } from '../danmaku_burn'
import type { DataRecoveryNotice } from '../data_recovery'

export type { DanmakuBurnTask, DanmakuBurnTaskStatus } from '../danmaku_burn'
export type { DataRecoveryNotice, DataFileKind } from '../data_recovery'

export interface PagedArgs {
  page: number
  pageSize: number
}
export interface PagedResp extends PagedArgs {
  total: number
  totalPage: number
}

export type ClientRecorder = Omit<
  Recorder<RecorderExtra>,
  // TODO: 可以改成排除所有方法 & EmitterProps
  'all' | 'getChannelURL' | 'checkLiveStatusAndRecord' | 'recordHandle' | 'toJSON'
> & {
  channelURL: string
  recordHandle?: Omit<RecordHandle, 'stop'>
}

export type ClientRecord = RecordModel & { isFileExists?: boolean }

type GlobalSettings = Omit<Settings, 'autoGenerateSRTOnRecordStop' | 'autoBurnDanmakuOnRecordStop'>

export namespace API {
  export namespace getRecorders {
    export interface Args extends PagedArgs {}

    export interface Resp extends PagedResp {
      items: ClientRecorder[]
    }
  }

  export namespace getRecorder {
    export interface Args {
      id: Recorder['id']
    }

    export type Resp = ClientRecorder
  }

  export namespace addRecorder {
    export type Args = Omit<RecorderCreateOpts, 'id'>

    export type Resp = ClientRecorder
  }

  export namespace updateRecorder {
    export type Args = Pick<
      RecorderCreateOpts,
      | 'id'
      | 'remarks'
      | 'disableAutoCheck'
      | 'disableProvideCommentsWhenRecording'
      | 'autoGenerateSRTOnRecordStop'
      | 'autoBurnDanmakuOnRecordStop'
      | 'quality'
      | 'streamPriorities'
      | 'sourcePriorities'
    >

    export type Resp = ClientRecorder
  }

  export namespace removeRecorder {
    export interface Args {
      id: Recorder['id']
    }

    export type Resp = null
  }

  export namespace startRecord {
    export interface Args {
      id: Recorder['id']
    }

    export type Resp = ClientRecorder
  }

  export namespace stopRecord {
    export interface Args {
      id: Recorder['id']
    }

    export type Resp = ClientRecorder
  }

  export namespace getManager {
    export interface Args {}

    export type Resp = Omit<RecorderManagerCreateOpts, 'providers'>
  }

  export namespace updateManager {
    export type Args = Omit<RecorderManagerCreateOpts, 'providers'>

    export type Resp = Omit<RecorderManagerCreateOpts, 'providers'>
  }

  export namespace previewSavePath {
    export interface Args {
      savePathRule: string
      autoRemoveSystemReservedChars: boolean
    }

    export type Resp = string
  }

  export namespace resolveChannel {
    export interface Args {
      channelURL: string
    }

    export type Resp = {
      providerId: string
      channelId: string
      owner: string
    } | null
  }

  export namespace getManagerDefault {
    export interface Args {}

    export type Resp = Omit<RecorderManagerCreateOpts, 'providers'>
  }

  export namespace clearInvalidRecords {
    export interface Args {
      recorderId?: Recorder['id']
    }

    export type Resp = number
  }

  export namespace getRecords {
    export interface Args extends PagedArgs {
      recorderId?: Recorder['id']
      search?: string
      timeZone?: string
      locale?: string
      sortBy?: RecordSortKey
      sortOrder?: 'asc' | 'desc'
    }

    export interface Resp extends PagedResp {
      items: ClientRecord[]
    }
  }

  export namespace getRecord {
    export interface Args {
      id: RecordModel['id']
    }

    export type Resp = ClientRecord
  }

  export namespace getRecordExtraData {
    export interface Args {
      id: RecordModel['id']
    }

    export type Resp = RecordExtraData
  }

  export namespace createRecordSRT {
    export interface Args {
      id: RecordModel['id']
    }

    export type Resp = string
  }

  export namespace createRecordASS {
    export interface Args {
      id: RecordModel['id']
    }

    /** 生成的 ass 文件名 */
    export type Resp = string
  }

  export namespace getDanmakuBurnTasks {
    export interface Args {}

    export type Resp = DanmakuBurnTask[]
  }

  export namespace getDanmakuBurnTask {
    export interface Args {
      id: RecordModel['id']
    }

    export type Resp = DanmakuBurnTask | null
  }

  export namespace startDanmakuBurn {
    export interface Args {
      id: RecordModel['id']
    }

    export type Resp = DanmakuBurnTask
  }

  export namespace cancelDanmakuBurn {
    export interface Args {
      id: RecordModel['id']
    }

    export type Resp = DanmakuBurnTask | null
  }

  export namespace getSettings {
    export interface Args {}

    export type Resp = GlobalSettings
  }

  export namespace setSettings {
    export type Args = GlobalSettings

    export type Resp = GlobalSettings
  }

  export namespace logMethod {
    export type Args = {
      text: string
    }

    export type Resp = null
  }

  export namespace getProviders {
    export interface Args {}
    export type Resp = {
      id: string
      name: string
      siteURL: string
      authFields?: ProviderAuthField[]
      hasAuthFlow?: boolean
    }[]
  }

  export namespace getProviderAuth {
    export interface Args {
      id: string
    }
    export type Resp = ProviderAuthStatus
  }

  export namespace setProviderAuth {
    export interface Args {
      id: string
      config: Record<string, string>
    }
    export type Resp = ProviderAuthStatus
  }

  export namespace performProviderLogin {
    export interface Args {
      id: string
    }
    export type Resp = {
      authConfig: Record<string, string>
      status: ProviderAuthStatus
    }
  }

  export namespace clearProviderAuth {
    export interface Args {
      id: string
    }
    export type Resp = null
  }

  export namespace getDataRecoveryNotices {
    export interface Args {}
    export type Resp = DataRecoveryNotice[]
  }

  export namespace clearDataRecoveryNotices {
    export interface Args {}
    export type Resp = null
  }
}

export interface UpdateRecorder {
  event: 'update_recorder'
  recorder: ClientRecorder
}

export interface AddRecorder {
  event: 'add_recorder'
  recorder: ClientRecorder
}

export interface RemoveRecorder {
  event: 'remove_recorder'
  id: ClientRecorder['id']
}

export interface RecordStart {
  event: 'record_start'
  recorder: ClientRecorder
}

export interface SettingsChange {
  event: 'settings_change'
  settings: GlobalSettings
}

export interface DanmakuBurnTaskUpdate {
  event: 'danmaku_burn_task_update'
  task: DanmakuBurnTask
}

export type SSEMessage =
  | UpdateRecorder
  | AddRecorder
  | RemoveRecorder
  | RecordStart
  | SettingsChange
  | DanmakuBurnTaskUpdate
