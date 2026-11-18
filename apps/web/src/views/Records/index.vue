<template>
  <v-card class="m-4" flat>
    <v-card-title class="my-2 flex items-center justify-between gap-4">
      <div class="flex items-center">
        <v-icon icon="mdi-arrow-left" size="24" class="mr-2" @click="$router.back" />
        <span>{{ $t('records.record_history') }}</span>
        <v-btn class="ml-4" size="small" variant="tonal" @click="clearInvalidWarnVisible = true">
          {{ $t('records.clean_invalid_record') }}
        </v-btn>

        <v-dialog v-model="clearInvalidWarnVisible">
          <v-card :title="$t('records.note')" :text="$t('records.clean_invalid_record_tip')">
            <template v-slot:actions>
              <v-spacer></v-spacer>

              <v-btn v-if="!requestingClearInvalid" @click="clearInvalidWarnVisible = false">
                {{ $t('common.cancel') }}
              </v-btn>
              <v-btn @click="clearInvalid" :loading="requestingClearInvalid">{{ $t('common.confirm') }}</v-btn>
            </template>
          </v-card>
        </v-dialog>
      </div>

      <v-text-field
        class="w-96 flex-none"
        v-model="search"
        :label="$t('records.search')"
        prepend-inner-icon="mdi-magnify"
        variant="outlined"
        hide-details
        density="compact"
      />
    </v-card-title>

    <v-alert
      v-if="alert"
      class="m-4"
      :type="alert.type"
      :text="alert.text"
      closable
      @click:close="alert = false"
    ></v-alert>

    <div v-if="loading" class="text-center p-4">
      <v-progress-circular indeterminate color="primary" />
    </div>

    <v-data-table
      v-else
      item-key="id"
      items-per-page="25"
      :items="records"
      :headers="[
        {
          title: $t('records.field_start_time'),
          key: 'startTimestamp',
          value: (record: ClientRecord) => format(record.startTimestamp, 'yyyy/MM/dd HH:mm:ss'),
          sortable: true,
          sortRaw(a: ClientRecord, b: ClientRecord) {
            return a.startTimestamp - b.startTimestamp
          },
          width: $i18n.locale.startsWith('zh') ? 160 : 200,
        },
        {
          title: $t('records.field_end_time'),
          key: 'stopTimestamp',
          value: (record: ClientRecord) =>
            record.stopTimestamp ? format(record.stopTimestamp, 'yyyy/MM/dd HH:mm:ss') : '/',
          sortable: true,
          sortRaw(a: ClientRecord, b: ClientRecord) {
            if (a.stopTimestamp == null) return 1
            if (b.stopTimestamp == null) return -1
            return a.stopTimestamp - b.stopTimestamp
          },
          width: $i18n.locale.startsWith('zh') ? 160 : 200,
        },
        {
          title: $t('records.field_duration'),
          key: 'totalTime',
          value: (record: ClientRecord) => (record.stopTimestamp ? formatInterval(record) : '/'),
          sortable: true,
          sortRaw(a: ClientRecord, b: ClientRecord) {
            if (a.stopTimestamp == null) return 1
            if (b.stopTimestamp == null) return -1
            const aTime = a.stopTimestamp - a.startTimestamp
            const bTime = b.stopTimestamp - b.startTimestamp
            return aTime - bTime
          },
          width: 144,
        },
        {
          title: $t('records.field_stop_reason'),
          key: 'stopReason',
          value: (record: ClientRecord) => record.stopReason ?? '/',
          sortable: true,
          width: 140,
        },
        {
          title: $t('records.field_path'),
          value: 'savePath',
          sortable: false,
        },
        {
          title: $t('records.field_action'),
          key: 'actions',
          value: (record: ClientRecord) => record,
          sortable: false,
          width: $i18n.locale.startsWith('zh') ? 420 : 560,
        },
      ]"
      :search="search"
    >
      <template v-slot:header.actions="{ column }">
        <span class="pl-3">{{ column.title }}</span>
      </template>

      <template v-slot:item.actions="{ value: record }">
        <div class="flex gap-0">
          <component
            :is="!record.isFileExists ? 'span' : 'router-link'"
            :to="{ name: RouteNames.Player, query: { id: record.id } }"
            target="_blank"
            tabindex="-1"
            :title="!record.isFileExists ? $t('records.file_not_exists') : ''"
          >
            <v-btn size="small" variant="text" :disabled="!record.isFileExists">{{ $t('records.play') }}</v-btn>
          </component>

          <span :title="!record.isFileExists ? $t('records.file_not_exists') : ''">
            <v-btn
              @click="genSRT(record)"
              size="small"
              variant="text"
              :loading="record.generatingSRT"
              :disabled="!record.isFileExists"
            >
              {{ $t('records.generate_srt') }}
            </v-btn>
          </span>

          <v-btn @click="genASS(record)" size="small" variant="text" :loading="record.generatingASS">
            {{ $t('records.generate_ass') }}
          </v-btn>

          <v-btn
            v-if="isBurning(record)"
            @click="cancelBurn(record)"
            size="small"
            variant="text"
            color="primary"
            :title="$t('records.burn_cancel')"
            append-icon="mdi-close"
          >
            {{
              burnTasks[record.id]?.status === 'queued'
                ? $t('records.burn_queued')
                : $t('records.burn_running', { progress: Math.floor((burnTasks[record.id]?.progress ?? 0) * 100) })
            }}
          </v-btn>
          <span v-else :title="!record.isFileExists ? $t('records.file_not_exists') : ''">
            <v-btn @click="startBurn(record)" size="small" variant="text" :disabled="!record.isFileExists">
              {{ $t('records.burn_danmaku') }}
            </v-btn>
          </span>
        </div>
      </template>
    </v-data-table>
  </v-card>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type { ClientRecord, DanmakuBurnTask } from '@autorecord/http-server'
import { isAxiosError } from 'axios'
import { intervalToDuration } from 'date-fns'
import { RouteNames } from '../../router'
import { LARServerService } from '../../services/LARServerService'
import { useEffectInLifecycle } from '../../hooks'
import { InteractionService } from '../../services/InteractionService'
import { useI18n } from 'vue-i18n'
import { useDateFNS } from '../../i18n'

const { t } = useI18n()
const { format, formatDuration } = useDateFNS()
const route = useRoute()
const router = useRouter()
// TODO: 这里写的有点和路由层耦合了，应该把 query -> state 的处理放到路由层去
const recorderId = route.name === RouteNames.RecorderRecords ? String(route.params.id) : undefined

type Record = ClientRecord & { generatingSRT?: boolean; generatingASS?: boolean }
const records = ref<Record[]>([])
const loading = ref(true)
const clearInvalidWarnVisible = ref(false)
const requestingClearInvalid = ref(false)
const alert = ref<false | { type: 'success' | 'error'; text: string }>(false)
const search = ref('')
const burnTasks = reactive<{ [recordId: string]: DanmakuBurnTask }>({})

useEffectInLifecycle(() => {
  return InteractionService.onEscapeWhenBody(() => router.back())
})

useEffectInLifecycle(() => {
  const subscription = LARServerService.getServerMessages().subscribe((msg) => {
    if (msg.event !== 'danmaku_burn_task_update') return
    const prevStatus = burnTasks[msg.task.recordId]?.status
    burnTasks[msg.task.recordId] = msg.task
    if (prevStatus === msg.task.status) return

    // 只提示本页面内的录像，避免在某个录制器的录像页里提示别的录制器的任务
    if (!records.value.some((record: Record) => record.id === msg.task.recordId)) return
    if (msg.task.status === 'success') {
      alert.value = {
        type: 'success',
        text: t('records.burn_success', {
          file: msg.task.outputFileName,
          rendered: msg.task.renderedComments,
          total: msg.task.totalComments,
        }),
      }
    } else if (msg.task.status === 'failed') {
      alert.value = { type: 'error', text: getBurnErrorText(msg.task) }
    }
  })
  return () => subscription.unsubscribe()
})

const isBurning = (record: Record) => {
  const status = burnTasks[record.id]?.status
  return status === 'queued' || status === 'running'
}

function getBurnErrorText(task: DanmakuBurnTask) {
  switch (task.errorCode) {
    case 'NO_DANMAKU':
      return t('records.burn_no_danmaku')
    case 'NO_LIBASS':
      return t('records.burn_no_libass')
    default:
      return t('records.burn_failed', { error: task.error })
  }
}

const refreshRecords = async () => {
  loading.value = true
  const [res, tasks] = await Promise.all([
    LARServerService.getRecords({
      recorderId,
      page: 1,
      // TODO: 暂时全部拉下来做本地分页
      pageSize: 1e10,
    }),
    LARServerService.getDanmakuBurnTasks({}),
  ])
  loading.value = false
  records.value = [...res.items].reverse()
  tasks.forEach((task) => (burnTasks[task.recordId] = task))
}

const genSRT = async (record: Record) => {
  if (record.generatingSRT) return
  record.generatingSRT = true
  try {
    const file = await LARServerService.createRecordSRT({ id: record.id })
    // TODO: 通知
  } finally {
    record.generatingSRT = false
  }
}

const genASS = async (record: Record) => {
  if (record.generatingASS) return
  record.generatingASS = true
  try {
    const file = await LARServerService.createRecordASS({ id: record.id })
    alert.value = { type: 'success', text: t('records.file_generated', { file }) }
  } catch (err) {
    alert.value = { type: 'error', text: getRequestErrorText(err) }
  } finally {
    record.generatingASS = false
  }
}

const startBurn = async (record: Record) => {
  try {
    burnTasks[record.id] = await LARServerService.startDanmakuBurn({ id: record.id })
  } catch (err) {
    alert.value = { type: 'error', text: getRequestErrorText(err) }
  }
}

const cancelBurn = async (record: Record) => {
  const task = await LARServerService.cancelDanmakuBurn({ id: record.id })
  if (task) burnTasks[record.id] = task
}

function getRequestErrorText(err: unknown) {
  if (isAxiosError(err) && err.response?.status === 404) return t('records.danmaku_file_not_exists')
  const data = isAxiosError(err) ? err.response?.data : undefined
  if (data != null && typeof data === 'object' && 'error' in data) return String(data.error)
  return err instanceof Error ? err.message : String(err)
}

const clearInvalid = async () => {
  requestingClearInvalid.value = true
  try {
    const count = await LARServerService.clearInvalidRecords({ recorderId })
    alert.value = { type: 'success', text: t('records.invalid_record_removed', { count }) }
  } finally {
    requestingClearInvalid.value = false
  }
  clearInvalidWarnVisible.value = false
  refreshRecords()
}

onMounted(refreshRecords)

function formatInterval(record: ClientRecord) {
  const stopTimestamp = record.stopTimestamp ?? record.startTimestamp
  const time = stopTimestamp - record.startTimestamp

  const duration = intervalToDuration({
    start: record.startTimestamp,
    // formatDuration 无法处理小于 1s 的情况
    end: Math.max(record.startTimestamp + 1000, record.stopTimestamp ?? 0),
  })
  if (time >= 60e3) {
    duration.seconds = 0
  }

  return formatDuration(duration)
}
</script>
