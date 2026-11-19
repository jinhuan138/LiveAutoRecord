<template>
  <div class="bg-[#F0F0F0] min-h-full">
    <router-view />

    <v-dialog v-model="dataRecoveryDialogVisible" max-width="640" persistent>
      <v-card :title="$t('data_recovery.title')">
        <v-card-text class="flex flex-col gap-4">
          <v-alert
            v-for="(notice, idx) in dataRecoveryNotices"
            :key="idx"
            :type="notice.status === 'restored' ? 'warning' : 'error'"
            variant="tonal"
          >
            <div>{{ getNoticeText(notice) }}</div>
            <div v-if="notice.corruptedPath" class="mt-1 text-sm break-all">
              {{ $t('data_recovery.corrupted_kept', { path: notice.corruptedPath }) }}
            </div>
          </v-alert>
        </v-card-text>
        <template v-slot:actions>
          <v-spacer></v-spacer>
          <v-btn @click="confirmDataRecoveryNotices">{{ $t('common.confirm') }}</v-btn>
        </template>
      </v-card>
    </v-dialog>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { API } from '@autorecord/http-server'
import { ClientService } from './services/ClientService'
import { LARServerService } from './services/LARServerService'
import { useDateFNS } from './i18n'

type DataRecoveryNotice = API.getDataRecoveryNotices.Resp[number]

const { t } = useI18n()
const { format } = useDateFNS()

const dataRecoveryNotices = ref<DataRecoveryNotice[]>([])
const dataRecoveryDialogVisible = ref(false)

function getNoticeText(notice: DataRecoveryNotice) {
  const file = t(notice.file === 'database' ? 'data_recovery.file_database' : 'data_recovery.file_manager_config')
  if (notice.status === 'restored') {
    const time = notice.restoredFromTime != null ? format(notice.restoredFromTime, 'yyyy/MM/dd HH:mm:ss') : '/'
    return t('data_recovery.restored', { file, time })
  }
  return t('data_recovery.reset', { file })
}

async function confirmDataRecoveryNotices() {
  dataRecoveryDialogVisible.value = false
  await LARServerService.clearDataRecoveryNotices({})
}

onMounted(async () => {
  const clientAPI = ClientService.getClientAPI()
  if (clientAPI) {
    document.title = `LAR 直播自动录制 v${clientAPI.getVersion()}`
  }

  dataRecoveryNotices.value = await LARServerService.getDataRecoveryNotices({})
  dataRecoveryDialogVisible.value = dataRecoveryNotices.value.length > 0
})
</script>
