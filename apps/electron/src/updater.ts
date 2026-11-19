/**
 * 客户端更新。
 * - Windows：后台静默下载新版本，下次启动、录制服务开始前询问是否安装；手动检查时可以立即下载安装。
 *   安装会关闭应用，所以不会在运行中自动安装，避免打断录制。
 * - macOS 等其他平台：没有代码签名无法自动更新，只提示新版本，由用户前往下载页手动下载安装。
 */
import path from 'path'
import { app, dialog, net, shell, BrowserWindow } from 'electron'
// electron-updater 是 CJS 包，autoUpdater 以 getter 导出，ESM 下无法具名导入
import electronUpdater, { type AppUpdater, type CancellationToken, type UpdateInfo } from 'electron-updater'
import { logger } from './logger'
import { paths } from './env'
import { getSettings } from './settings'
import { readJSONFileSync, writeJSONFileSync } from './utils'
import packageJSON from '../package.json'

const AUTO_CHECK_DELAY = 10_000
const AUTO_CHECK_INTERVAL = 24 * 60 * 60 * 1000
const REQUEST_TIMEOUT = 15_000
/** 启动时安装前需要重新校验一次更新信息，超时就先正常启动，下次再问 */
const STARTUP_INSTALL_TIMEOUT = 30_000

const updaterStatePath = path.join(paths.config, 'updater.json')

interface UpdaterState {
  /** 用户选择跳过的版本，自动检查时不再提示 */
  skippedVersion?: string
  /** 已在后台下载完成、等待安装的版本（仅 Windows） */
  downloadedVersion?: string
}

interface LatestRelease {
  version: string
  url: string
}

const messages = {
  zh: {
    title: '检查更新',
    available: (v: string) => `发现新版本 v${v}`,
    availableDetail: (current: string) => `当前版本 v${current}，是否立即下载？下载完成后可以选择何时安装。`,
    manualDetail: (current: string) => `当前版本 v${current}。macOS 版需要前往下载页手动下载安装。`,
    download: '立即下载',
    openDownloadPage: '前往下载',
    later: '稍后提醒',
    skip: '跳过此版本',
    downloaded: (v: string) => `新版本 v${v} 已下载完成`,
    downloadedDetail: '安装时会关闭应用，正在进行的录制会中断，安装完成后自动重新打开。',
    installNow: '立即安装',
    installOnNextLaunch: '下次启动时安装',
    startupInstall: (v: string) => `新版本 v${v} 已下载，是否现在安装？`,
    startupInstallDetail: '安装完成后会自动重新打开应用。',
    startupLater: '稍后',
    downloading: '正在下载新版本，请稍候',
    latest: (current: string) => `当前已是最新版本 v${current}`,
    failed: '检查更新失败，请检查网络后重试',
    downloadFailed: '下载更新失败，可以前往下载页手动下载安装',
    installFailed: '安装更新失败，将正常启动，下次启动时会再次询问',
    ok: '确定',
  },
  en: {
    title: 'Check for Updates',
    available: (v: string) => `New version v${v} is available`,
    availableDetail: (current: string) =>
      `Current version is v${current}. Download it now? You can choose when to install after downloading.`,
    manualDetail: (current: string) =>
      `Current version is v${current}. On macOS, please download and install it from the download page.`,
    download: 'Download',
    openDownloadPage: 'Open Download Page',
    later: 'Remind Me Later',
    skip: 'Skip This Version',
    downloaded: (v: string) => `New version v${v} has been downloaded`,
    downloadedDetail:
      'Installing will close the app and interrupt ongoing recordings. The app will reopen after installation.',
    installNow: 'Install Now',
    installOnNextLaunch: 'Install on Next Launch',
    startupInstall: (v: string) => `New version v${v} has been downloaded. Install it now?`,
    startupInstallDetail: 'The app will reopen after installation.',
    startupLater: 'Later',
    downloading: 'Downloading the new version, please wait',
    latest: (current: string) => `You are using the latest version v${current}`,
    failed: 'Failed to check for updates, please check your network and try again',
    downloadFailed: 'Failed to download the update. You can download it manually from the download page',
    installFailed: 'Failed to install the update. The app will start normally and ask again next launch',
    ok: 'OK',
  },
  ru: {
    title: 'Проверка обновлений',
    available: (v: string) => `Доступна новая версия v${v}`,
    availableDetail: (current: string) =>
      `Текущая версия v${current}. Скачать сейчас? После загрузки можно выбрать время установки.`,
    manualDetail: (current: string) =>
      `Текущая версия v${current}. В macOS скачайте и установите обновление со страницы загрузки.`,
    download: 'Скачать',
    openDownloadPage: 'Открыть страницу загрузки',
    later: 'Напомнить позже',
    skip: 'Пропустить эту версию',
    downloaded: (v: string) => `Новая версия v${v} загружена`,
    downloadedDetail:
      'Установка закроет приложение и прервёт текущие записи. После установки приложение откроется снова.',
    installNow: 'Установить сейчас',
    installOnNextLaunch: 'Установить при следующем запуске',
    startupInstall: (v: string) => `Новая версия v${v} загружена. Установить сейчас?`,
    startupInstallDetail: 'После установки приложение откроется снова.',
    startupLater: 'Позже',
    downloading: 'Новая версия загружается, подождите',
    latest: (current: string) => `Установлена последняя версия v${current}`,
    failed: 'Не удалось проверить обновления, проверьте сеть и повторите попытку',
    downloadFailed: 'Не удалось загрузить обновление. Скачайте его вручную со страницы загрузки',
    installFailed: 'Не удалось установить обновление. Приложение запустится как обычно и спросит снова',
    ok: 'OK',
  },
}

function getMessages() {
  const locale = getSettings().locale ?? app.getLocale()
  if (locale.startsWith('zh')) return messages.zh
  if (locale.startsWith('ru')) return messages.ru
  return messages.en
}

function parseVersion(version: string): number[] | null {
  const match = version.trim().match(/^v?(\d+)\.(\d+)\.(\d+)$/)
  return match ? match.slice(1).map(Number) : null
}

function isNewerVersion(latest: string, current: string): boolean {
  const a = parseVersion(latest)
  const b = parseVersion(current)
  if (!a || !b) return false
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] > b[i]
  }
  return false
}

function getRepoURL(): string {
  return packageJSON.repository.replace(/\.git$|\/$/g, '')
}

function getReleasePageURL(version: string): string {
  return `${getRepoURL()}/releases/tag/v${version}`
}

function readState(): UpdaterState {
  return readJSONFileSync<UpdaterState>(updaterStatePath, {})
}

function updateState(patch: Partial<UpdaterState>): void {
  writeJSONFileSync<UpdaterState>(updaterStatePath, { ...readState(), ...patch })
}

function getDialogWindow(): BrowserWindow | undefined {
  return BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
}

async function showMessageBox(opts: Electron.MessageBoxOptions) {
  const window = getDialogWindow()
  return window ? dialog.showMessageBox(window, opts) : dialog.showMessageBox(opts)
}

/** 只有打包后的 Windows 客户端走自动更新 */
function isAutoUpdateSupported(): boolean {
  return process.platform === 'win32' && app.isPackaged
}

let updater: AppUpdater | null = null

function getUpdater(): AppUpdater {
  if (updater) return updater
  updater = electronUpdater.autoUpdater
  // 下载和安装的时机都由这里控制
  updater.autoDownload = false
  updater.autoInstallOnAppQuit = false
  updater.logger = logger
  return updater
}

/** 有新版本时返回更新信息 */
async function checkWithUpdater(): Promise<UpdateInfo | null> {
  const result = await getUpdater().checkForUpdates()
  return result?.isUpdateAvailable ? result.updateInfo : null
}

function setTaskbarProgress(progress: number) {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.setProgressBar(progress)
  }
}

/** 下载 checkWithUpdater 检查到的版本，已下载过时会校验并直接使用缓存 */
async function downloadUpdate(
  version: string,
  showProgress: boolean,
  cancellationToken?: CancellationToken,
): Promise<void> {
  const instance = getUpdater()
  const onProgress = (info: { percent: number }) => setTaskbarProgress(info.percent / 100)
  if (showProgress) instance.on('download-progress', onProgress)
  try {
    await instance.downloadUpdate(cancellationToken)
    updateState({ downloadedVersion: version })
  } finally {
    if (showProgress) {
      instance.off('download-progress', onProgress)
      setTaskbarProgress(-1)
    }
  }
}

function installUpdate(): void {
  // 静默安装（沿用之前的安装目录），安装完成后自动重新打开应用
  getUpdater().quitAndInstall(true, true)
}

async function fetchLatestRelease(): Promise<LatestRelease> {
  const repo = new URL(getRepoURL()).pathname.replace(/^\//, '')
  // 用 net.fetch 而不是 node 的 fetch，这样会走系统代理
  const res = await net.fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': `${packageJSON.name}/${app.getVersion()}`,
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT),
  })
  if (!res.ok) throw new Error(`GitHub API responded ${res.status}`)

  const data = (await res.json()) as { tag_name?: unknown; html_url?: unknown }
  if (typeof data.tag_name !== 'string' || typeof data.html_url !== 'string' || !parseVersion(data.tag_name)) {
    throw new Error('Invalid release data')
  }
  return { version: data.tag_name.replace(/^v/, ''), url: data.html_url }
}

/** 不支持自动更新的平台：只提示新版本，让用户自己去下载页下载 */
async function checkAndNotify(manual: boolean): Promise<void> {
  const t = getMessages()
  const currentVersion = app.getVersion()

  let release: LatestRelease
  try {
    release = await fetchLatestRelease()
  } catch (error) {
    logger.warn('check for updates failed', error)
    if (manual) await showMessageBox({ type: 'error', title: t.title, message: t.failed, buttons: [t.ok] })
    return
  }

  if (!isNewerVersion(release.version, currentVersion)) {
    if (manual) {
      await showMessageBox({ type: 'info', title: t.title, message: t.latest(currentVersion), buttons: [t.ok] })
    }
    return
  }

  if (!manual && readState().skippedVersion === release.version) return

  const { response } = await showMessageBox({
    type: 'info',
    title: t.title,
    message: t.available(release.version),
    detail: t.manualDetail(currentVersion),
    buttons: [t.openDownloadPage, t.later, t.skip],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
  })
  if (response === 0) {
    await shell.openExternal(release.url)
  } else if (response === 2) {
    updateState({ skippedVersion: release.version })
  }
}

/** 自动检查：有新版本就在后台静默下载，等下次启动时再询问安装 */
async function checkAndDownloadInBackground(): Promise<void> {
  let info: UpdateInfo | null
  try {
    info = await checkWithUpdater()
  } catch (error) {
    logger.warn('check for updates failed', error)
    return
  }
  if (!info || readState().skippedVersion === info.version) return

  try {
    await downloadUpdate(info.version, false)
    logger.info(`update v${info.version} downloaded, will ask to install on next launch`)
  } catch (error) {
    logger.warn('download update failed', error)
  }
}

/** 手动检查：有新版本时询问是否下载，下载完成后询问立即安装还是下次启动时安装 */
async function checkAndDownloadManually(): Promise<void> {
  const t = getMessages()
  const currentVersion = app.getVersion()

  let info: UpdateInfo | null
  try {
    info = await checkWithUpdater()
  } catch (error) {
    logger.warn('check for updates failed', error)
    await showMessageBox({ type: 'error', title: t.title, message: t.failed, buttons: [t.ok] })
    return
  }
  if (!info) {
    await showMessageBox({ type: 'info', title: t.title, message: t.latest(currentVersion), buttons: [t.ok] })
    return
  }

  if (readState().downloadedVersion !== info.version) {
    const { response } = await showMessageBox({
      type: 'info',
      title: t.title,
      message: t.available(info.version),
      detail: t.availableDetail(currentVersion),
      buttons: [t.download, t.later, t.skip],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
    })
    if (response === 2) updateState({ skippedVersion: info.version })
    if (response !== 0) return
  }

  try {
    await downloadUpdate(info.version, true)
  } catch (error) {
    logger.warn('download update failed', error)
    const { response } = await showMessageBox({
      type: 'error',
      title: t.title,
      message: t.downloadFailed,
      buttons: [t.openDownloadPage, t.ok],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
    })
    if (response === 0) await shell.openExternal(getReleasePageURL(info.version))
    return
  }

  const { response } = await showMessageBox({
    type: 'info',
    title: t.title,
    message: t.downloaded(info.version),
    detail: t.downloadedDetail,
    buttons: [t.installNow, t.installOnNextLaunch],
    defaultId: 1,
    cancelId: 1,
    noLink: true,
  })
  if (response === 0) installUpdate()
}

let checking = false

/**
 * @param manual 用户手动检查时，已是最新版本或检查失败也会提示，并且忽略之前跳过的版本
 */
export async function checkForUpdates(manual = false): Promise<void> {
  if (checking) {
    if (manual) {
      const t = getMessages()
      await showMessageBox({ type: 'info', title: t.title, message: t.downloading, buttons: [t.ok] })
    }
    return
  }
  checking = true

  try {
    if (!isAutoUpdateSupported()) {
      await checkAndNotify(manual)
    } else if (manual) {
      await checkAndDownloadManually()
    } else {
      await checkAndDownloadInBackground()
    }
  } finally {
    checking = false
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, onTimeout?: () => void): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      onTimeout?.()
      reject(new Error(`timed out after ${ms}ms`))
    }, ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

/**
 * 启动时（录制服务开始前）如果有已下载的新版本，询问是否安装。
 * @returns 是否已开始安装，开始安装时应用会退出，调用方不应再继续启动
 */
export async function installDownloadedUpdateOnStartup(): Promise<boolean> {
  if (!isAutoUpdateSupported()) return false

  const { downloadedVersion } = readState()
  if (!downloadedVersion) return false
  if (!isNewerVersion(downloadedVersion, app.getVersion())) {
    // 已经装上了（或者手动装了更高版本），清掉记录
    updateState({ downloadedVersion: undefined })
    return false
  }

  const t = getMessages()
  const { response } = await dialog.showMessageBox({
    type: 'info',
    title: t.title,
    message: t.startupInstall(downloadedVersion),
    detail: t.startupInstallDetail,
    buttons: [t.installNow, t.startupLater],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
  })
  // 选择稍后时保留记录，下次启动再问
  if (response !== 0) return false

  try {
    // 安装前需要重新获取更新信息，并用它校验缓存的安装包
    const info = await withTimeout(checkWithUpdater(), STARTUP_INSTALL_TIMEOUT)
    if (info?.version !== downloadedVersion) {
      // 服务器上已经没有这个版本或有了更新的版本，缓存作废，等后台重新下载
      logger.info(`downloaded update v${downloadedVersion} is outdated, latest is ${info?.version ?? 'none'}`)
      updateState({ downloadedVersion: undefined })
      return false
    }
    // 正常情况下直接用缓存；缓存丢失需要重新下载时不在启动阶段等太久，取消后交给后台下载
    const cancellationToken = new electronUpdater.CancellationToken()
    await withTimeout(downloadUpdate(info.version, false, cancellationToken), STARTUP_INSTALL_TIMEOUT, () =>
      cancellationToken.cancel(),
    )
  } catch (error) {
    logger.warn('install downloaded update on startup failed', error)
    await dialog.showMessageBox({ type: 'error', title: t.title, message: t.installFailed, buttons: [t.ok] })
    return false
  }

  installUpdate()
  return true
}

/** 启动后延迟检查一次，之后每天检查一次。开发环境下不检查 */
export function initAutoCheckForUpdates(): void {
  if (!app.isPackaged) return

  setTimeout(() => void checkForUpdates(), AUTO_CHECK_DELAY)
  setInterval(() => void checkForUpdates(), AUTO_CHECK_INTERVAL)
}
