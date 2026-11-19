/**
 * 预期上是内部私有包的共享包，而公开包（如 manager）则不应该使用这个包。
 */

export interface Settings {
  notExitOnAllWindowsClosed: boolean
  noticeOnRecordStart: boolean
  noticeFormat?: string
  debugMode?: boolean
  autoGenerateSRTOnRecordStop?: boolean
  autoRemoveRecordWhenTinySize?: boolean
  locale?: string
  sortMode?: string
  /** 录制结束后自动压制一份带弹幕的视频（原视频保留） */
  autoBurnDanmakuOnRecordStop?: boolean
  danmakuBurnEncoder?: DanmakuBurnEncoder
  danmakuStyle?: DanmakuStyle
}

export const DanmakuBurnEncoders = ['libx264', 'h264_nvenc', 'h264_qsv', 'h264_amf'] as const
/** libx264 为 CPU 编码，其余分别为 NVIDIA / Intel / AMD 的硬件编码 */
export type DanmakuBurnEncoder = (typeof DanmakuBurnEncoders)[number]

export interface DanmakuStyle {
  /** 字体名，为空时按平台选择默认的中文字体 */
  fontName?: string
  /** 字号，以 1080p 画面为基准，其他分辨率会等比缩放 */
  fontSize?: number
  /** 不透明度，0 ~ 1 */
  opacity?: number
  /** 滚动弹幕从右侧进入到完全离开屏幕所用的秒数 */
  scrollDuration?: number
  /** 弹幕可占用的画面高度比例，0 ~ 1 */
  displayAreaRatio?: number
  /** 弹幕时间整体偏移的毫秒数，正数表示弹幕延后出现，用于修正推流延迟 */
  timeOffset?: number
}

/** electron render 给 web 暴露的 API */
export interface ClientAPI {
  getVersion(): string
  /** 打开系统的选择文件夹对话框，用户取消时返回 null */
  selectDirectory(opts?: { title?: string; defaultPath?: string }): Promise<string | null>
  /** 手动检查新版本，结果由客户端通过系统对话框提示 */
  checkForUpdates(): Promise<void>
}

export * from './steno'
export * from './jsonfile'
export * from './backup'
