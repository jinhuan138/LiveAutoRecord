<template>
  <v-card class="mx-auto my-4 max-w-2xl">
    <v-card-title class="flex gap-3 items-center">
      {{ t('settings.global_recording_settings') }}
      <v-btn v-if="isChanged" size="small" variant="tonal" @click="reset">
        {{ t('common.reset') }}
      </v-btn>
    </v-card-title>

    <v-card-item>
      <div v-if="!manager" class="text-center p-4">
        <v-progress-circular indeterminate color="primary" />
      </div>

      <v-form v-else>
        <v-text-field
          :label="t('settings.save_path_rule')"
          v-model="manager.savePathRule"
          append-inner-icon="mdi-help-circle"
          @click:append-inner="savePathRuleAlertVisible = !savePathRuleAlertVisible"
          :append-icon="isClient ? 'mdi-folder-open' : undefined"
          @click:append="selectSaveDirectory"
          hide-details
        />
        <v-alert v-model="savePathRuleAlertVisible" closable>
          <v-alert-title>{{ t('settings.spr_alert_title') }}</v-alert-title>
          <p class="text-subtitle-1 m-2">{{ t('settings.spr_alert_subtitle') }}</p>
          <v-table>
            <thead>
              <tr>
                <th class="text-left">{{ t('settings.filed_name') }}</th>
                <th class="text-left">{{ t('settings.filed_value') }}</th>
              </tr>
            </thead>

            <tbody>
              <tr>
                <td>platform</td>
                <td>{{ t('settings.field_platform_hint') }}</td>
              </tr>
              <tr>
                <td>channelId</td>
                <td>{{ t('settings.field_channel_hint') }}</td>
              </tr>
              <tr>
                <td>title</td>
                <td>{{ t('settings.field_title_hint') }}</td>
              </tr>
              <tr>
                <td>owner</td>
                <td>{{ t('settings.field_owner_hint') }}</td>
              </tr>
              <tr>
                <td>remarks</td>
                <td>{{ t('settings.field_remarks_hint') }}</td>
              </tr>
              <tr>
                <td>year</td>
                <td>{{ t('settings.field_year_hint') }}</td>
              </tr>
              <tr>
                <td>month</td>
                <td>{{ t('settings.field_month_hint') }}</td>
              </tr>
              <tr>
                <td>date</td>
                <td>{{ t('settings.field_date_hint') }}</td>
              </tr>
              <tr>
                <td>hour</td>
                <td>{{ t('settings.field_hour_hint') }}</td>
              </tr>
              <tr>
                <td>min</td>
                <td>{{ t('settings.field_min_hint') }}</td>
              </tr>
              <tr>
                <td>sec</td>
                <td>{{ t('settings.field_sec_hint') }}</td>
              </tr>
            </tbody>
          </v-table>
        </v-alert>

        <v-checkbox
          :label="t('settings.auto_remove_reserved_chars')"
          v-model="manager.autoRemoveSystemReservedChars"
          hide-details
        />

        <v-text-field :label="t('settings.ffmpeg_output_args')" v-model="manager.ffmpegOutputArgs" />

        <v-checkbox
          :label="t('settings.auto_check_and_record')"
          v-model="manager.autoCheckLiveStatusAndRecord"
          hide-details
        />

        <v-text-field
          v-if="manager.autoCheckLiveStatusAndRecord"
          :label="t('settings.check_interval')"
          v-model="manager.autoCheckInterval"
          type="number"
        />
      </v-form>
    </v-card-item>

    <v-card-title>{{ t('settings.app_settings') }}</v-card-title>

    <v-card-item>
      <div v-if="!settings" class="text-center p-4">
        <v-progress-circular indeterminate color="primary" />
      </div>

      <v-form v-else>
        <v-select
          label="语言 - Language"
          class="mb-2"
          v-model="innerLocale"
          density="comfortable"
          :items="[
            { name: '简体中文', value: 'zh' },
            { name: 'Русский язык', value: 'ru' },
            { name: 'English', value: 'en' },
          ]"
          item-title="name"
          item-value="value"
          hide-details="auto"
        />

        <v-checkbox
          v-if="isClient"
          :label="t('settings.close_to_tray')"
          v-model="settings.notExitOnAllWindowsClosed"
          hide-details
        />

        <v-checkbox
          :label="t('settings.auto_generate_srt')"
          v-model="settings.autoGenerateSRTOnRecordStop"
          hide-details
        />

        <v-checkbox
          :label="t('settings.auto_remove_empty_record')"
          v-model="settings.autoRemoveRecordWhenTinySize"
          hide-details
        />

        <v-checkbox
          :label="t('settings.notify_when_record_start')"
          v-model="settings.noticeOnRecordStart"
          hide-details
        />

        <v-text-field
          v-if="settings.noticeOnRecordStart"
          :label="t('settings.notice_format')"
          v-model="settings.noticeFormat"
          persistent-placeholder
          :placeholder="t('settings.default_notice_format')"
          append-inner-icon="mdi-help-circle"
          @click:append-inner="noticeFormatAlertVisible = !noticeFormatAlertVisible"
        />
        <v-alert v-model="noticeFormatAlertVisible" closable>
          <v-alert-title>{{ t('settings.nf_alert_title') }}</v-alert-title>
          <p class="text-subtitle-1 m-2">{{ t('settings.nf_alert_subtitle') }}</p>
          <v-table>
            <thead>
              <tr>
                <th class="text-left">{{ t('settings.filed_name') }}</th>
                <th class="text-left">{{ t('settings.filed_value') }}</th>
              </tr>
            </thead>

            <tbody>
              <tr>
                <td>platform</td>
                <td>{{ t('settings.field_platform_hint') }}</td>
              </tr>
              <tr>
                <td>channelId</td>
                <td>{{ t('settings.field_channel_hint') }}</td>
              </tr>
              <tr>
                <td>remarks</td>
                <td>{{ t('settings.field_remarks_hint') }}</td>
              </tr>
            </tbody>
          </v-table>
        </v-alert>

        <v-checkbox :label="t('settings.debug_mode')" v-model="settings.debugMode" hide-details />
      </v-form>
    </v-card-item>

    <v-card-title>{{ t('settings.danmaku_burn') }}</v-card-title>

    <v-card-item>
      <div v-if="!settings || !danmakuStyle" class="text-center p-4">
        <v-progress-circular indeterminate color="primary" />
      </div>

      <v-form v-else>
        <v-checkbox
          :label="t('settings.auto_burn_danmaku')"
          v-model="settings.autoBurnDanmakuOnRecordStop"
          hide-details
        />

        <v-select
          class="mt-2"
          :label="t('settings.danmaku_burn_encoder')"
          v-model="settings.danmakuBurnEncoder"
          :items="danmakuBurnEncoders.map((value) => ({ value, title: t(`settings.encoder_${value}`) }))"
          :hint="t('settings.danmaku_burn_encoder_hint')"
          persistent-hint
        />

        <v-text-field
          class="mt-2"
          :label="t('settings.danmaku_font_name')"
          v-model="danmakuStyle.fontName"
          persistent-placeholder
          :placeholder="t('settings.danmaku_font_name_placeholder')"
        />

        <div class="grid grid-cols-2 gap-x-4">
          <v-text-field
            :label="t('settings.danmaku_font_size')"
            v-model.number="danmakuStyle.fontSize"
            type="number"
            persistent-placeholder
            placeholder="48"
          />
          <v-text-field
            :label="t('settings.danmaku_opacity')"
            v-model.number="danmakuStyle.opacity"
            type="number"
            step="0.1"
            persistent-placeholder
            placeholder="0.8"
          />
          <v-text-field
            :label="t('settings.danmaku_scroll_duration')"
            v-model.number="danmakuStyle.scrollDuration"
            type="number"
            persistent-placeholder
            placeholder="10"
          />
          <v-text-field
            :label="t('settings.danmaku_display_area')"
            v-model.number="danmakuStyle.displayAreaRatio"
            type="number"
            step="0.1"
            persistent-placeholder
            placeholder="0.5"
          />
          <v-text-field
            :label="t('settings.danmaku_time_offset')"
            v-model.number="danmakuStyle.timeOffset"
            type="number"
            step="500"
            persistent-placeholder
            placeholder="0"
          />
        </div>
      </v-form>
    </v-card-item>

    <v-card-title>{{ t('settings.provider_auth') }}</v-card-title>

    <v-card-item>
      <div v-if="!providers" class="text-center p-4">
        <v-progress-circular indeterminate color="primary" />
      </div>

      <div v-else>
        <div v-for="provider in providersWithAuth" :key="provider.id" class="mb-6">
          <div class="text-subtitle-1 font-weight-bold mb-2">
            {{ t(`platform_name.${provider.id}`) }}
          </div>

          <v-chip
            :color="providerAuthStatuses[provider.id]?.isAuthenticated ? 'success' : 'default'"
            size="small"
            class="mb-2"
          >
            {{
              providerAuthStatuses[provider.id]?.isAuthenticated
                ? t('settings.auth_logged_in', { name: providerAuthStatuses[provider.id]?.description })
                : t('settings.auth_not_logged_in')
            }}
          </v-chip>

          <template v-for="field in provider.authFields" :key="field.key">
            <v-textarea
              v-if="field.type === 'textarea'"
              :label="field.label"
              :placeholder="field.placeholder"
              v-model="providerAuthInputs[provider.id][field.key]"
              rows="2"
              auto-grow
              hide-details
              class="mb-2"
            />
            <v-text-field
              v-else
              :label="field.label"
              :placeholder="field.placeholder"
              :type="field.type === 'password' ? 'password' : 'text'"
              v-model="providerAuthInputs[provider.id][field.key]"
              hide-details
              class="mb-2"
            />
          </template>

          <div class="d-flex gap-2 mt-2">
            <v-btn
              size="small"
              variant="tonal"
              @click="saveProviderAuth(provider.id)"
              :loading="authOperating[provider.id]"
            >
              {{ t('settings.auth_save') }}
            </v-btn>
            <v-btn
              v-if="provider.hasAuthFlow"
              size="small"
              variant="tonal"
              @click="browserLogin(provider.id)"
              :loading="authLoggingIn[provider.id]"
            >
              {{ t('settings.auth_browser_login') }}
            </v-btn>
            <v-btn
              size="small"
              variant="text"
              @click="clearProviderAuth(provider.id)"
              :loading="authOperating[provider.id]"
            >
              {{ t('settings.auth_clear') }}
            </v-btn>
          </div>

          <v-divider class="mt-4" />
        </div>
      </div>
    </v-card-item>

    <v-card-title>{{ t('settings.about') }}</v-card-title>

    <v-card-item>
      <v-table>
        <tbody>
          <tr>
            <td>{{ t('settings.version') }}</td>
            <td>
              v{{ version }}
              <v-btn
                v-if="isClient"
                class="ml-4"
                size="small"
                variant="tonal"
                :loading="checkingUpdate"
                @click="checkForUpdates"
              >
                {{ t('settings.check_update') }}
              </v-btn>
            </td>
          </tr>
          <tr>
            <td>{{ t('settings.open_source') }}</td>
            <td>
              <a href="https://github.com/WhiteMinds/LiveAutoRecord" target="_blank">
                https://github.com/WhiteMinds/LiveAutoRecord
              </a>
            </td>
          </tr>
          <tr>
            <td>{{ t('settings.feedback') }}</td>
            <td>
              <a href="https://github.com/jinhuan138/LiveAutoRecord/issues" target="_blank">
                https://github.com/jinhuan138/LiveAutoRecord/issues
              </a>
            </td>
          </tr>
        </tbody>
      </v-table>
    </v-card-item>

    <v-card-actions class="border-t justify-end">
      <v-btn @click="apply">{{ t('common.apply') }}</v-btn>
      <v-btn @click="$router.back">{{ t('common.cancel') }}</v-btn>
    </v-card-actions>
  </v-card>
</template>

<script setup lang="ts">
import type { API } from '@autorecord/http-server'
import { computed, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { LARServerService } from '../../services/LARServerService'
import { ClientService } from '../../services/ClientService'
import { RecordService } from '../../services/RecordService'
import { useEffectInLifecycle } from '../../hooks'
import { InteractionService } from '../../services/InteractionService'
import { i18nOpts } from '../../i18n'

const isClient = ClientService.isClientMode()
const version = ClientService.getClientAPI()?.getVersion()
const router = useRouter()
const manager = ref<API.getManager.Resp>()
const managerDefault = ref<API.getManagerDefault.Resp>()
const settings = ref<API.getSettings.Resp>()
const danmakuStyle = computed(() => settings.value?.danmakuStyle)
// web 不直接依赖 @autorecord/shared，这里与 shared 里的 DanmakuBurnEncoders 保持一致
const danmakuBurnEncoders: NonNullable<API.getSettings.Resp['danmakuBurnEncoder']>[] = [
  'libx264',
  'h264_nvenc',
  'h264_qsv',
  'h264_amf',
]
const savePathRuleAlertVisible = ref(false)
const noticeFormatAlertVisible = ref(false)
const checkingUpdate = ref(false)

// Provider 鉴权相关状态
const providers = ref<API.getProviders.Resp>()
const providerAuthStatuses = reactive<Record<string, API.getProviderAuth.Resp>>({})
const providerAuthInputs = reactive<Record<string, Record<string, string>>>({})
const authOperating = reactive<Record<string, boolean>>({})
const authLoggingIn = reactive<Record<string, boolean>>({})

const providersWithAuth = computed(() => {
  return (providers.value ?? []).filter((p) => p.authFields && p.authFields.length > 0)
})

// 这里的实现方式是为了让设置页面内部可以预览语言更改后的效果
const { locale: appLocale } = useI18n()
const { t, locale: innerLocale } = useI18n({ ...i18nOpts, locale: appLocale.value })

useEffectInLifecycle(() => {
  return InteractionService.onEscapeWhenBody(() => router.back())
})

onMounted(async () => {
  manager.value = await LARServerService.getManager({})
  managerDefault.value = await LARServerService.getManagerDefault({})
  settings.value = await LARServerService.getSettings({})
  settings.value.danmakuBurnEncoder ??= 'libx264'
  settings.value.danmakuStyle ??= {}

  // 加载 Provider 鉴权信息
  providers.value = await LARServerService.getProviders()
  // 先同步初始化所有 inputs，避免后续 await 让出控制权时模板访问到未初始化的对象
  for (const provider of providersWithAuth.value) {
    providerAuthInputs[provider.id] = {}
    for (const field of provider.authFields!) {
      providerAuthInputs[provider.id][field.key] = ''
    }
  }
  for (const provider of providersWithAuth.value) {
    try {
      providerAuthStatuses[provider.id] = await LARServerService.getProviderAuth({ id: provider.id })
    } catch {
      providerAuthStatuses[provider.id] = { isAuthenticated: false }
    }
  }
})

/** 拆分保存路径规则：目录前缀为第一个含变量的路径段之前的部分，没有变量时则只保留文件名 */
const splitSavePathRule = (rule: string) => {
  const varIndex = rule.indexOf('{')
  const end = varIndex === -1 ? rule.length : varIndex
  const sepIndex = Math.max(rule.lastIndexOf('/', end), rule.lastIndexOf('\\', end))
  return { dir: rule.slice(0, Math.max(sepIndex, 0)), template: rule.slice(sepIndex + 1) }
}

const selectSaveDirectory = async () => {
  const clientAPI = ClientService.getClientAPI()
  if (!clientAPI || !manager.value) return

  const { dir, template } = splitSavePathRule(manager.value.savePathRule ?? '')
  const selected = await clientAPI.selectDirectory({
    title: t('settings.select_save_dir'),
    defaultPath: dir || undefined,
  })
  if (!selected) return

  const sep = selected.includes('\\') ? '\\' : '/'
  manager.value.savePathRule = selected.replace(/[\\/]+$/, '') + sep + template
}

const checkForUpdates = async () => {
  const clientAPI = ClientService.getClientAPI()
  if (!clientAPI) return

  checkingUpdate.value = true
  try {
    await clientAPI.checkForUpdates()
  } finally {
    checkingUpdate.value = false
  }
}

const saveProviderAuth = async (providerId: string) => {
  authOperating[providerId] = true
  try {
    const config = providerAuthInputs[providerId]
    const status = await LARServerService.setProviderAuth({ id: providerId, config })
    providerAuthStatuses[providerId] = status
  } finally {
    authOperating[providerId] = false
  }
}

const browserLogin = async (providerId: string) => {
  authLoggingIn[providerId] = true
  try {
    const result = await LARServerService.performProviderLogin({ id: providerId })
    providerAuthStatuses[providerId] = result.status
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    providerAuthStatuses[providerId] = { isAuthenticated: false, description: msg }
  } finally {
    authLoggingIn[providerId] = false
  }
}

const clearProviderAuth = async (providerId: string) => {
  authOperating[providerId] = true
  try {
    await LARServerService.clearProviderAuth({ id: providerId })
    providerAuthStatuses[providerId] = { isAuthenticated: false }
    // 清空输入框
    for (const key of Object.keys(providerAuthInputs[providerId])) {
      providerAuthInputs[providerId][key] = ''
    }
  } finally {
    authOperating[providerId] = false
  }
}

const apply = async () => {
  if (!manager.value) return
  await LARServerService.updateManager(manager.value)
  router.back()

  if (!settings.value) return
  settings.value.locale = innerLocale.value
  settings.value.danmakuStyle = cleanDanmakuStyle(settings.value.danmakuStyle)
  const newSettings = await LARServerService.setSettings(settings.value)
  // TODO: 前端目前只有 RecordService 用到了 settings，为了降低开发复杂度，这里先直接赋值
  RecordService.noticeOnRecordStart = newSettings.noticeOnRecordStart
  RecordService.noticeFormat = newSettings.noticeFormat ?? ''
  appLocale.value = newSettings.locale ?? navigator.language
}

const reset = async () => {
  manager.value = { ...managerDefault.value }
}

/** 去掉留空的项（v-model.number 在输入框为空时会得到空字符串），让服务端使用默认值 */
function cleanDanmakuStyle(style: API.getSettings.Resp['danmakuStyle']) {
  if (style == null) return style
  return Object.fromEntries(Object.entries(style).filter(([, value]) => value != null && value !== '')) as typeof style
}

const isChanged = computed(() => JSON.stringify(manager.value) !== JSON.stringify(managerDefault.value))
</script>
