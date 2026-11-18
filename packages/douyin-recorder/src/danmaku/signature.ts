/**
 * 抖音弹幕 WebSocket 握手所需的 signature 参数生成。
 *
 * 原始实现位于抖音网页端的 webmssdk.js 中，这里是其纯算法移植，避免在 node 中执行混淆脚本。
 * reference: https://github.com/jwwsjlm/douyinLive/blob/v2.3.2/internal/webcastsign/native.go
 */
import crypto from 'crypto'

const WEBSOCKET_MODE_FLAG = 1 << 6
const ENVIRONMENT_CODE = 1
const USER_BEHAVIOR_CODE = 14
const STANDARD_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
const CUSTOM_ALPHABET = 'Dkdpgh4ZKsQB80/Mfvw36XI1R25+WUAlEi7NLboqYTOPuzmFjJnryx9HVGcaStCe'

function md5(data: Buffer | string): Buffer {
  return crypto.createHash('md5').update(data).digest()
}

const emptyBodyDigest = md5(md5(Buffer.alloc(0)))

function rc4(key: Buffer, data: Buffer): Buffer {
  const s = Array.from({ length: 256 }, (_, i) => i)
  for (let i = 0, j = 0; i < 256; i++) {
    j = (j + s[i] + key[i % key.length]) & 0xff
    ;[s[i], s[j]] = [s[j], s[i]]
  }

  const out = Buffer.alloc(data.length)
  for (let k = 0, i = 0, j = 0; k < data.length; k++) {
    i = (i + 1) & 0xff
    j = (j + s[i]) & 0xff
    ;[s[i], s[j]] = [s[j], s[i]]
    out[k] = data[k] ^ s[(s[i] + s[j]) & 0xff]
  }
  return out
}

function encodeWithCustomAlphabet(data: Buffer): string {
  return Array.from(data.toString('base64').replace(/=+$/, ''))
    .map((char) => CUSTOM_ALPHABET[STANDARD_ALPHABET.indexOf(char)])
    .join('')
}

/**
 * 使用显式的状态值生成签名，主要用于和原始实现做逐字节的对比测试。
 */
export function signWithValues(
  xMSStub: string,
  counter: number,
  randomFlag: boolean,
  payloadRandom: number,
  keyRandom: number,
): string {
  if (!/^[0-9a-f]{32}$/i.test(xMSStub)) {
    throw new Error('X-MS-STUB must be a 32-character hex MD5')
  }
  const stubDigest = md5(Buffer.from(xMSStub, 'hex'))

  const payload = Buffer.from([
    counter & 0x3f,
    0,
    ENVIRONMENT_CODE,
    USER_BEHAVIOR_CODE,
    emptyBodyDigest[14],
    emptyBodyDigest[15],
    stubDigest[14],
    stubDigest[15],
    payloadRandom & 0xff,
    0,
  ])
  for (let i = 0; i < payload.length - 1; i++) {
    payload[payload.length - 1] ^= payload[i]
  }

  const encrypted = rc4(Buffer.from([keyRandom & 0xff]), payload)
  const flags = WEBSOCKET_MODE_FLAG | (randomFlag ? 1 << 4 : 0)

  return encodeWithCustomAlphabet(Buffer.concat([Buffer.from([flags, keyRandom & 0xff]), encrypted]))
}

/** 与 Math.floor(255 * Math.random()) 的取值范围保持一致，即 0-254 */
function randomByteExcludeFF(): number {
  return crypto.randomInt(0, 255)
}

/**
 * 每个弹幕连接会话应使用独立的 generator，内部会维护签名的序号。
 */
export function createSignatureGenerator(): { sign: (xMSStub: string) => string } {
  let counter = 0

  return {
    sign(xMSStub) {
      const flagRandom = crypto.randomInt(0, 256)
      counter = (counter + 1) & 0xff
      return signWithValues(
        xMSStub,
        counter & 0x3f,
        (flagRandom & 1) === 1,
        randomByteExcludeFF(),
        randomByteExcludeFF(),
      )
    },
  }
}

/**
 * 由规范化的签名输入（按固定顺序拼接的 key=value，以逗号分隔）计算出 X-MS-STUB。
 */
export function getXMSStub(fields: [key: string, value: string][]): string {
  const joined = fields.map(([key, value]) => `${key}=${value}`).join(',')
  return md5(joined).toString('hex')
}
