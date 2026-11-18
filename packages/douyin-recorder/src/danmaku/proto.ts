/**
 * 抖音弹幕协议的 protobuf 定义（精简版，只保留了录制所需要的消息和字段）。
 * 字段编号来自 https://github.com/jwwsjlm/douyinlive-proto/blob/HEAD/protobuf/new_douyin.proto
 */
import protobuf from 'protobufjs'

const root = protobuf.Root.fromJSON({
  nested: {
    PushHeader: {
      fields: {
        key: { type: 'string', id: 1 },
        value: { type: 'string', id: 2 },
      },
    },
    PushFrame: {
      fields: {
        seqId: { type: 'uint64', id: 1 },
        logId: { type: 'uint64', id: 2 },
        service: { type: 'int32', id: 3 },
        method: { type: 'int32', id: 4 },
        headers: { rule: 'repeated', type: 'PushHeader', id: 5 },
        payloadEncoding: { type: 'string', id: 6 },
        payloadType: { type: 'string', id: 7 },
        payload: { type: 'bytes', id: 8 },
      },
    },
    Message: {
      fields: {
        method: { type: 'string', id: 1 },
        payload: { type: 'bytes', id: 2 },
        msgId: { type: 'uint64', id: 3 },
      },
    },
    Response: {
      fields: {
        messages: { rule: 'repeated', type: 'Message', id: 1 },
        cursor: { type: 'string', id: 2 },
        internalExt: { type: 'string', id: 5 },
        heartbeatDuration: { type: 'uint64', id: 8 },
        needAck: { type: 'bool', id: 9 },
        pushServer: { type: 'string', id: 10 },
        proxyServer: { type: 'string', id: 13 },
        pushServerV2: { type: 'string', id: 14 },
      },
    },
    Image: {
      fields: {
        urlList: { rule: 'repeated', type: 'string', id: 1 },
      },
    },
    User: {
      fields: {
        id: { type: 'uint64', id: 1 },
        nickname: { type: 'string', id: 3 },
        avatarThumb: { type: 'Image', id: 9 },
        idStr: { type: 'string', id: 1028 },
      },
    },
    Common: {
      fields: {
        method: { type: 'string', id: 1 },
        msgId: { type: 'uint64', id: 2 },
        roomId: { type: 'uint64', id: 3 },
        createTime: { type: 'uint64', id: 4 },
      },
    },
    ChatMessage: {
      fields: {
        common: { type: 'Common', id: 1 },
        user: { type: 'User', id: 2 },
        content: { type: 'string', id: 3 },
      },
    },
    TextPiece: {
      fields: {
        stringValue: { type: 'string', id: 11 },
      },
    },
    Text: {
      fields: {
        defaultPattern: { type: 'string', id: 2 },
        pieces: { rule: 'repeated', type: 'TextPiece', id: 4 },
      },
    },
    EmojiChatMessage: {
      fields: {
        common: { type: 'Common', id: 1 },
        user: { type: 'User', id: 2 },
        emojiId: { type: 'uint64', id: 3 },
        emojiContent: { type: 'Text', id: 4 },
        defaultContent: { type: 'string', id: 5 },
      },
    },
    GiftStruct: {
      fields: {
        image: { type: 'Image', id: 1 },
        id: { type: 'uint64', id: 5 },
        combo: { type: 'bool', id: 10 },
        diamondCount: { type: 'int32', id: 12 },
        name: { type: 'string', id: 16 },
      },
    },
    GiftMessage: {
      fields: {
        common: { type: 'Common', id: 1 },
        giftId: { type: 'uint64', id: 2 },
        groupCount: { type: 'uint64', id: 4 },
        repeatCount: { type: 'uint64', id: 5 },
        comboCount: { type: 'uint64', id: 6 },
        user: { type: 'User', id: 7 },
        repeatEnd: { type: 'int32', id: 9 },
        groupId: { type: 'uint64', id: 11 },
        gift: { type: 'GiftStruct', id: 15 },
      },
    },
    ControlMessage: {
      fields: {
        common: { type: 'Common', id: 1 },
        action: { type: 'uint64', id: 2 },
        tips: { type: 'string', id: 3 },
      },
    },
  },
})

/** protobufjs 会根据环境把 uint64 解码为 Long 或 number */
type UInt64 = { toString(): string } | number

export interface PushFrame {
  seqId?: UInt64
  logId?: UInt64
  headers?: { key: string; value: string }[]
  payloadEncoding?: string
  payloadType?: string
  payload?: Uint8Array
}

export interface ImMessage {
  method: string
  payload: Uint8Array
  msgId?: UInt64
}

export interface ImResponse {
  messages?: ImMessage[]
  cursor?: string
  internalExt?: string
  heartbeatDuration?: UInt64
  needAck?: boolean
  pushServer?: string
  proxyServer?: string
  pushServerV2?: string
}

export interface DouyinUser {
  id?: UInt64
  nickname?: string
  avatarThumb?: { urlList?: string[] }
  idStr?: string
}

export interface DouyinCommon {
  method?: string
  msgId?: UInt64
  roomId?: UInt64
  createTime?: UInt64
}

export interface ChatMessage {
  common?: DouyinCommon
  user?: DouyinUser
  content?: string
}

export interface EmojiChatMessage {
  common?: DouyinCommon
  user?: DouyinUser
  emojiId?: UInt64
  emojiContent?: { defaultPattern?: string; pieces?: { stringValue?: string }[] }
  /** 表情的文字形式，如 "[比心]" */
  defaultContent?: string
}

export interface GiftMessage {
  common?: DouyinCommon
  giftId?: UInt64
  groupCount?: UInt64
  repeatCount?: UInt64
  comboCount?: UInt64
  user?: DouyinUser
  repeatEnd?: number
  groupId?: UInt64
  gift?: {
    image?: { urlList?: string[] }
    id?: UInt64
    combo?: boolean
    diamondCount?: number
    name?: string
  }
}

export interface ControlMessage {
  common?: DouyinCommon
  action?: UInt64
  tips?: string
}

interface MessageTypeMap {
  PushFrame: PushFrame
  Response: ImResponse
  ChatMessage: ChatMessage
  EmojiChatMessage: EmojiChatMessage
  GiftMessage: GiftMessage
  ControlMessage: ControlMessage
}

export function decode<K extends keyof MessageTypeMap>(type: K, data: Uint8Array): MessageTypeMap[K] {
  return root.lookupType(type).decode(data) as unknown as MessageTypeMap[K]
}

export function encode<K extends keyof MessageTypeMap>(type: K, message: MessageTypeMap[K]): Uint8Array {
  const Type = root.lookupType(type)
  return Type.encode(Type.fromObject(message as Record<string, unknown>)).finish()
}

/** 统一把 uint64 转为字符串使用，避免超出 number 的精度范围 */
export function uint64ToString(value: UInt64 | null | undefined): string {
  return value == null ? '' : value.toString()
}

export function uint64ToNumber(value: UInt64 | null | undefined): number {
  return value == null ? 0 : Number(value.toString())
}
