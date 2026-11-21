import axios from 'axios'

const liveHost = 'live.douyin.com'
const shortHost = 'v.douyin.com'

function getRoomURLType(url: URL) {
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port) return null

  if (/^\/[\w-]+\/?$/.test(url.pathname)) {
    if (url.hostname === liveHost) return 'live'
    if (url.hostname === shortHost) return 'short'
  }

  if (
    (url.hostname === 'webcast.amemv.com' || url.hostname === 'webcast.douyin.com') &&
    /^\/(?:douyin\/)?webcast\/reflow\/\d+\/?$/.test(url.pathname)
  ) {
    return 'reflow'
  }
  return null
}

export function findRoomURL(text: string): URL | null {
  const links = text.match(/https?:\/\/[^\s<>"()\[\]，。！？；、）】》]+/gi) ?? []
  for (const link of links) {
    if (!URL.canParse(link)) continue
    const url = new URL(link)
    if (getRoomURLType(url)) return url
  }
  return null
}

const requester = axios.create({
  proxy: false,
  timeout: 5000,
  maxRedirects: 0,
  maxContentLength: 4 * 1024 * 1024,
  responseType: 'text',
  validateStatus: (status) => status >= 200 && status < 400,
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36',
  },
})

export async function resolveRoomId(url: URL): Promise<string | null> {
  for (let requestCount = 0; requestCount <= 5; requestCount++) {
    const type = getRoomURLType(url)
    if (type === 'live') return url.pathname.split('/')[1]
    if (!type || requestCount === 5) return null

    const webRid = type === 'reflow' ? (url.searchParams.get('webRid') ?? url.searchParams.get('web_rid')) : null
    if (webRid && /^\d+$/.test(webRid)) return webRid

    url.protocol = 'https:'
    // Validate each redirect before making another request, and keep login cookies off share requests.
    const response = await requester.get<string>(url.href)
    if (response.status >= 300 && typeof response.headers.location === 'string') {
      if (!URL.canParse(response.headers.location, url)) return null
      url = new URL(response.headers.location, url)
      continue
    }
    if (type === 'reflow' && response.status < 300) {
      const html = response.data.replace(/\\+"|&quot;/g, '"')
      return html.match(/"(?:webRid|web_rid)"\s*:\s*"?(\d+)"?(?=\s*[,}])/)?.[1] ?? null
    }
    return null
  }
  return null
}
