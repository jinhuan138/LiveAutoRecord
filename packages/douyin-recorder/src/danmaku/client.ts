/**
 * 抖音直播间弹幕客户端。
 * 协议参考了 https://github.com/jwwsjlm/douyinLive 的实现。
 */
import zlib from 'zlib'
import WebSocket from 'ws'
import mitt, { Emitter } from 'mitt'
import { Comment, GiveGift, MessageSender } from '@autorecord/manager'
import {
  ChatMessage,
  ControlMessage,
  DouyinUser,
  EmojiChatMessage,
  GiftMessage,
  ImResponse,
  PushFrame,
  decode,
  encode,
  uint64ToNumber,
  uint64ToString,
} from './proto'
import { createSignatureGenerator, getXMSStub } from './signature'

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
const DEFAULT_PUSH_URL = 'wss://webcast100-ws-web-lf.douyin.com/webcast/im/push/v2/'
const DEFAULT_CURSOR = 'd-1_u-1_fh-7383731312643626035_t-1719159695790_r-1'
const DEFAULT_WRDS_VERSION = '7382620942951772256'
const APP_NAME = 'douyin_web'
const VERSION_CODE = '180800'
const SDK_VERSION = '1.0.15'
const AID = '6383'
const LIVE_ID = '1'
const DID_RULE = '3'
const DEVICE_PLATFORM = 'web'
const IDENTITY = 'audience'

const HEARTBEAT_INTERVAL = 10e3
const READ_TIMEOUT = 70e3
const BASE_RECONNECT_DELAY = 1500
const MAX_RECONNECT_DELAY = 60e3
const MAX_RECONNECT_JITTER = 1200
/** 连击礼物在这段时间内没有新消息时，即使没收到连击结束的标记也视为结束 */
const GIFT_COMBO_TIMEOUT = 10e3
const MAX_RECENT_MSG_IDS = 2000
/** ControlMessage 的 action 为该值时表示直播已结束 */
const CONTROL_ACTION_LIVE_END = 3

export interface DouyinDanmakuClient extends Emitter<{
  comment: Comment
  gift: GiveGift
  liveEnd: undefined
  log: string
}> {
  start: () => void
  stop: () => void
}

export function createDouyinDanmakuClient(opts: {
  /** 直播间网页上的房间号，即 live.douyin.com/{webRid} */
  webRid: string
  /** 直播间的真实（长）id */
  roomId: string
  userUniqueId: string
  getCookie: () => Promise<string>
}): DouyinDanmakuClient {
  const signer = createSignatureGenerator()

  let ws: WebSocket | null = null
  let stopped = true
  let reconnectAttempts = 0
  let reconnectTimer: NodeJS.Timeout | null = null
  let heartbeatTimer: NodeJS.Timeout | null = null
  let readTimeoutTimer: NodeJS.Timeout | null = null
  let heartbeatInterval = HEARTBEAT_INTERVAL

  // 服务端每次下发的游标等状态，重连时需要带上，以便从断开的位置继续接收消息
  let cursor = ''
  let internalExt = ''
  let pushURL = ''

  const recentMsgIds = new Set<string>()
  const pendingGifts = new Map<string, { gift: GiveGift; timer: NodeJS.Timeout }>()

  const log = (text: string) => client.emit('log', text)

  const buildURL = (): string => {
    const now = Date.now()
    const xMSStub = getXMSStub([
      ['live_id', LIVE_ID],
      ['aid', AID],
      ['version_code', VERSION_CODE],
      ['webcast_sdk_version', SDK_VERSION],
      ['room_id', opts.roomId],
      ['sub_room_id', ''],
      ['sub_channel_id', ''],
      ['did_rule', DID_RULE],
      ['user_unique_id', opts.userUniqueId],
      ['device_platform', DEVICE_PLATFORM],
      ['device_type', ''],
      ['ac', ''],
      ['identity', IDENTITY],
    ])
    const signature = signer.sign(xMSStub)
    const browserVersion = USER_AGENT.replace(/^Mozilla\//, '')
    const ext =
      internalExt ||
      `internal_src:dim|wss_push_room_id:${opts.roomId}|wss_push_did:${opts.userUniqueId}` +
        `|first_req_ms:${now}|fetch_time:${now}|seq:1|wss_info:0-${now}-0-0|wrds_v:${DEFAULT_WRDS_VERSION}`

    // 参数的顺序和编码方式与网页端保持一致，所以这里没有使用 URLSearchParams
    const params: [string, string][] = [
      ['app_name', APP_NAME],
      ['version_code', VERSION_CODE],
      ['webcast_sdk_version', SDK_VERSION],
      ['update_version_code', SDK_VERSION],
      ['compress', 'gzip'],
      ['device_platform', DEVICE_PLATFORM],
      ['cookie_enabled', 'true'],
      ['screen_width', '1920'],
      ['screen_height', '1080'],
      ['browser_language', 'zh-CN'],
      ['browser_platform', 'Win32'],
      ['browser_name', 'Mozilla'],
      ['browser_version', browserVersion],
      ['browser_online', 'true'],
      ['tz_name', 'Asia/Shanghai'],
      ['cursor', cursor || DEFAULT_CURSOR],
      ['internal_ext', ext],
      ['host', 'https://live.douyin.com'],
      ['aid', AID],
      ['live_id', LIVE_ID],
      ['did_rule', DID_RULE],
      ['endpoint', 'live_pc'],
      ['support_wrds', '1'],
      ['user_unique_id', opts.userUniqueId],
      ['im_path', '/webcast/im/fetch/'],
      ['identity', IDENTITY],
      ['need_persist_msg_count', '15'],
      ['insert_task_id', ''],
      ['live_reason', ''],
      ['room_id', opts.roomId],
      ['heartbeatDuration', '0'],
      ['signature', signature],
    ]
    const query = params.map(([key, value]) => `${key}=${value.replaceAll(' ', '%20')}`).join('&')

    return `${pushURL || DEFAULT_PUSH_URL}?${query}`
  }

  const send = (frame: PushFrame) => {
    if (ws?.readyState !== WebSocket.OPEN) return
    ws.send(encode('PushFrame', frame))
  }

  const sendHeartbeat = () => send({ payloadType: 'hb' })

  const startHeartbeat = () => {
    stopHeartbeat()
    sendHeartbeat()
    heartbeatTimer = setInterval(sendHeartbeat, heartbeatInterval)
  }

  const stopHeartbeat = () => {
    if (heartbeatTimer == null) return
    clearInterval(heartbeatTimer)
    heartbeatTimer = null
  }

  const resetReadTimeout = () => {
    if (readTimeoutTimer != null) clearTimeout(readTimeoutTimer)
    readTimeoutTimer = setTimeout(() => {
      log('danmaku read timeout, reconnecting')
      ws?.terminate()
    }, READ_TIMEOUT)
  }

  const updateHeartbeatInterval = (seconds: number) => {
    const interval = Math.max(seconds * 1e3, HEARTBEAT_INTERVAL)
    if (interval === heartbeatInterval) return
    heartbeatInterval = interval
    if (heartbeatTimer != null) startHeartbeat()
  }

  const isDuplicateMessage = (...candidateIds: string[]): boolean => {
    // protobuf 解码时未设置的字段会得到默认值 0，所以这里取第一个有效的 id
    const msgId = candidateIds.find((id) => id && id !== '0')
    if (!msgId) return false
    if (recentMsgIds.has(msgId)) return true

    recentMsgIds.add(msgId)
    if (recentMsgIds.size > MAX_RECENT_MSG_IDS) {
      // Set 会保持插入顺序，所以第一个就是最旧的
      recentMsgIds.delete(recentMsgIds.values().next().value as string)
    }
    return false
  }

  const flushGift = (key: string) => {
    const pending = pendingGifts.get(key)
    if (!pending) return
    clearTimeout(pending.timer)
    pendingGifts.delete(key)
    client.emit('gift', pending.gift)
  }

  const handleChat = (msg: ChatMessage) => {
    if (!msg.content) return
    emitComment(msg.content, msg.user)
  }

  const handleEmojiChat = (msg: EmojiChatMessage) => {
    // 表情弹幕没有纯文本内容，使用它的文字形式（如 "[比心]"）记录
    const text =
      msg.defaultContent ||
      msg.emojiContent?.pieces
        ?.map((piece) => piece.stringValue ?? '')
        .join('')
        .trim() ||
      msg.emojiContent?.defaultPattern
    if (!text) return
    emitComment(text, msg.user, { emojiId: uint64ToString(msg.emojiId) })
  }

  const emitComment = (text: string, user: DouyinUser | undefined, extra?: Comment['extra']) => {
    const comment: Comment = {
      type: 'comment',
      // 使用本地的接收时间，与录制开始时记录的本地时间对齐
      timestamp: Date.now(),
      text,
      sender: toSender(user),
      extra,
    }
    client.emit('comment', comment)
  }

  const handleGift = (msg: GiftMessage) => {
    const giftId = [uint64ToString(msg.giftId), uint64ToString(msg.gift?.id)].find((id) => id && id !== '0') ?? ''
    const groupCount = Math.max(uint64ToNumber(msg.groupCount), 1)
    const repeatCount = Math.max(uint64ToNumber(msg.repeatCount), 1)
    const diamondCount = msg.gift?.diamondCount ?? 0
    const sender = toSender(msg.user)
    const count = groupCount * repeatCount

    const createGift = (timestamp: number): GiveGift => ({
      type: 'give_gift',
      timestamp,
      name: msg.gift?.name || `礼物${giftId}`,
      count,
      cost: diamondCount > 0 ? diamondCount * count : undefined,
      sender,
      extra: { giftId },
    })

    if (!msg.gift?.combo) {
      client.emit('gift', createGift(Date.now()))
      return
    }

    // 连击礼物在连击过程中会不断推送 repeat_count 递增的消息，这里只在连击结束时记录一条汇总
    const key = `${sender?.uid ?? ''}:${giftId}:${uint64ToString(msg.groupId)}`
    const pending = pendingGifts.get(key)
    if (pending) clearTimeout(pending.timer)
    // 时间戳沿用连击开始时的，这样在回放时礼物出现的位置更准确
    const gift = createGift(pending?.gift.timestamp ?? Date.now())
    pendingGifts.set(key, { gift, timer: setTimeout(() => flushGift(key), GIFT_COMBO_TIMEOUT) })

    if (msg.repeatEnd === 1) {
      flushGift(key)
    }
  }

  const handleControl = (msg: ControlMessage) => {
    if (uint64ToNumber(msg.action) === CONTROL_ACTION_LIVE_END) {
      log('danmaku received live end control message')
      client.emit('liveEnd', undefined)
    }
  }

  const handleResponse = (frame: PushFrame, resp: ImResponse) => {
    if (resp.cursor) cursor = resp.cursor
    if (resp.internalExt) internalExt = resp.internalExt
    const nextPushURL = normalizePushURL(resp.pushServerV2 || resp.pushServer || resp.proxyServer || '')
    if (nextPushURL) pushURL = nextPushURL
    const heartbeatDuration = uint64ToNumber(resp.heartbeatDuration)
    if (heartbeatDuration > 0) updateHeartbeatInterval(heartbeatDuration)

    // ACK 回传的是 PushFrame 头部中 im-internal_ext 的原值，而不是 Response 中的 internal_ext
    let ackExt = frame.headers?.find((h) => h.key === 'im-internal_ext')?.value ?? ''
    if (!ackExt && resp.needAck) ackExt = resp.internalExt ?? ''
    if (ackExt) {
      send({ logId: frame.logId, payloadType: 'ack', payload: Buffer.from(ackExt) })
    }

    for (const message of resp.messages ?? []) {
      try {
        switch (message.method) {
          case 'WebcastChatMessage': {
            const chat = decode('ChatMessage', message.payload)
            if (isDuplicateMessage(uint64ToString(message.msgId), uint64ToString(chat.common?.msgId))) continue
            handleChat(chat)
            break
          }
          case 'WebcastEmojiChatMessage': {
            const chat = decode('EmojiChatMessage', message.payload)
            if (isDuplicateMessage(uint64ToString(message.msgId), uint64ToString(chat.common?.msgId))) continue
            handleEmojiChat(chat)
            break
          }
          case 'WebcastGiftMessage': {
            const gift = decode('GiftMessage', message.payload)
            if (isDuplicateMessage(uint64ToString(message.msgId), uint64ToString(gift.common?.msgId))) continue
            handleGift(gift)
            break
          }
          case 'WebcastControlMessage':
            handleControl(decode('ControlMessage', message.payload))
            break
        }
      } catch (err) {
        log(`danmaku decode ${message.method} failed: ${String(err)}`)
      }
    }
  }

  const handleData = (data: Buffer) => {
    resetReadTimeout()

    let frame: PushFrame
    try {
      frame = decode('PushFrame', data)
    } catch (err) {
      log(`danmaku decode PushFrame failed: ${String(err)}`)
      return
    }
    if (frame.payloadType !== 'msg' || frame.payload == null || frame.payload.length === 0) return

    try {
      let payload = Buffer.from(frame.payload)
      // gzip magic number
      if (payload[0] === 0x1f && payload[1] === 0x8b) {
        payload = zlib.gunzipSync(payload)
      }
      handleResponse(frame, decode('Response', payload))
    } catch (err) {
      log(`danmaku decode Response failed: ${String(err)}`)
    }
  }

  const scheduleReconnect = () => {
    if (stopped || reconnectTimer != null) return

    const delay =
      Math.min(BASE_RECONNECT_DELAY * 2 ** reconnectAttempts, MAX_RECONNECT_DELAY) +
      Math.floor(Math.random() * MAX_RECONNECT_JITTER)
    reconnectAttempts++
    log(`danmaku reconnect in ${delay}ms (attempt ${reconnectAttempts})`)
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null
      void connect()
    }, delay)
  }

  const cleanupConnection = () => {
    stopHeartbeat()
    if (readTimeoutTimer != null) {
      clearTimeout(readTimeoutTimer)
      readTimeoutTimer = null
    }
    if (ws != null) {
      ws.removeAllListeners()
      // 移除监听后还需要保留一个 error 监听，避免 close / terminate 过程中的错误变成未捕获异常
      ws.on('error', () => {})
      if (ws.readyState === WebSocket.CONNECTING) {
        ws.terminate()
      } else {
        ws.close()
      }
      ws = null
    }
  }

  const connect = async () => {
    if (stopped) return

    let url: string
    let cookie: string
    try {
      url = buildURL()
      cookie = await opts.getCookie()
    } catch (err) {
      log(`danmaku prepare connection failed: ${String(err)}`)
      scheduleReconnect()
      return
    }
    if (stopped) return

    const socket = new WebSocket(url, {
      handshakeTimeout: 10e3,
      headers: {
        'User-Agent': USER_AGENT,
        Origin: 'https://live.douyin.com',
        Referer: `https://live.douyin.com/${opts.webRid}`,
        Cookie: cookie,
      },
    })
    ws = socket

    socket.on('upgrade', (res) => {
      // 服务端会在握手响应头中声明期望的心跳间隔，如 "ping-interval=15;"
      const handshakeOptions = res.headers['handshake-options']
      const pingInterval = /ping-interval=(\d+)/.exec(String(handshakeOptions ?? ''))?.[1]
      if (pingInterval) updateHeartbeatInterval(Number(pingInterval))
    })

    socket.on('open', () => {
      log(`danmaku connected, room ${opts.roomId}`)
      reconnectAttempts = 0
      startHeartbeat()
      resetReadTimeout()
    })

    socket.on('message', (data, isBinary) => {
      if (!isBinary) return
      handleData(Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data as Buffer))
    })

    socket.on('error', (err) => {
      log(`danmaku error: ${err.message}`)
    })

    socket.on('close', (code, reason) => {
      if (ws !== socket) return
      log(`danmaku closed, code ${code}, reason ${reason.toString()}`)
      cleanupConnection()
      scheduleReconnect()
    })
  }

  const start = () => {
    if (!stopped) return
    stopped = false
    reconnectAttempts = 0
    void connect()
  }

  const stop = () => {
    if (stopped) return
    stopped = true

    if (reconnectTimer != null) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }
    cleanupConnection()
    for (const key of [...pendingGifts.keys()]) {
      flushGift(key)
    }
  }

  const client: DouyinDanmakuClient = {
    ...mitt(),
    start,
    stop,
  }

  return client
}

function toSender(user: DouyinUser | undefined): MessageSender | undefined {
  if (!user) return undefined

  return {
    uid: user.idStr || uint64ToString(user.id) || undefined,
    name: user.nickname ?? '',
    avatar: user.avatarThumb?.urlList?.[0],
  }
}

function normalizePushURL(candidate: string): string {
  let url = candidate.trim().split(/[,;]/)[0].trim().replace(/\/+$/, '')
  if (!url) return ''

  if (url.startsWith('https://')) {
    url = 'wss://' + url.slice('https://'.length)
  } else if (url.startsWith('http://')) {
    url = 'ws://' + url.slice('http://'.length)
  } else if (!url.startsWith('wss://') && !url.startsWith('ws://')) {
    url = 'wss://' + url
  }

  return url.includes('/webcast/im/push/v2') ? url + '/' : url + '/webcast/im/push/v2/'
}
