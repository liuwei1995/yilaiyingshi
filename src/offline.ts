import { Capacitor } from '@capacitor/core'
import { FileTransfer } from '@capacitor/file-transfer'
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem'
import { parse, stringify, types } from 'hls-parser'

const offlineStorageKey = 'yilai-offline-media-v1'

export type OfflineMedia = {
  id: string
  title: string
  path: string
  kind: 'video' | 'hls'
  createdAt: number
}

function safeName(value: string) {
  const sanitized = value.normalize('NFKC').replace(/[\\/:*?"<>|]/g, '_')
  return [...sanitized].filter((character) => character.charCodeAt(0) >= 32).join('').trim().slice(0, 80) || 'video'
}

function getExtension(url: string) {
  try {
    const extension = new URL(url).pathname.split('.').pop()?.toLowerCase()
    return extension && /^[a-z0-9]{2,5}$/.test(extension) && extension !== 'm3u8' ? extension : 'mp4'
  } catch {
    return 'mp4'
  }
}

export function readOfflineMedia(): OfflineMedia[] {
  try {
    const value = localStorage.getItem(offlineStorageKey)
    const entries = value ? JSON.parse(value) as OfflineMedia[] : []
    return Array.isArray(entries) ? entries : []
  } catch {
    return []
  }
}

function persistOfflineMedia(items: OfflineMedia[]) {
  localStorage.setItem(offlineStorageKey, JSON.stringify(items))
}

async function fetchPlaylist(url: string) {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`播放列表请求失败（${response.status}）`)
  return parse(await response.text())
}

function assertDownloadablePlaylist(playlist: types.MediaPlaylist) {
  if (!playlist.endlist) throw new Error('当前是直播或未结束的 HLS 流，暂不支持离线下载。')
  if (playlist.segments.length === 0) throw new Error('播放列表中没有可下载的视频分片。')
  if (playlist.segments.some((segment) => segment.key && segment.key.method !== 'NONE')) {
    throw new Error('当前 HLS 使用加密，暂不支持离线下载。')
  }
}

async function saveHlsNative(url: string, title: string, entry: OfflineMedia) {
  let playlistUrl = url
  let playlist = await fetchPlaylist(playlistUrl)
  if (playlist.isMasterPlaylist) {
    const variant = playlist.variants[0]
    if (!variant) throw new Error('主播放列表没有可用清晰度。')
    playlistUrl = new URL(variant.uri, playlistUrl).href
    playlist = await fetchPlaylist(playlistUrl)
  }
  if (playlist.isMasterPlaylist) throw new Error('暂不支持嵌套 HLS 主播放列表。')
  assertDownloadablePlaylist(playlist)

  const localDirectory = `offline/${entry.id}`
  await Filesystem.mkdir({ path: localDirectory, directory: Directory.Data, recursive: true })

  if (playlist.segments.some((segment) => segment.byterange || segment.map?.byterange)) {
    throw new Error('当前 HLS 使用字节范围分片，暂不支持离线下载。')
  }

  let segmentIndex = 0
  const originalMapUris = playlist.segments.map((segment) => segment.map?.uri)
  const localMapNames = new Map<string, string>()
  for (const [index, segment] of playlist.segments.entries()) {
    const localName = `segment-${String(segmentIndex++).padStart(5, '0')}.${segment.mimeType.includes('mp4') ? 'm4s' : 'ts'}`
    const uri = await Filesystem.getUri({ path: `${localDirectory}/${localName}`, directory: Directory.Data })
    await FileTransfer.downloadFile({
      url: new URL(segment.uri, playlistUrl).href,
      path: uri.uri,
      progress: false,
    })
    segment.uri = localName
    Reflect.deleteProperty(segment, 'byterange')

    if (segment.map) {
      const sourceMapUri = originalMapUris[index] || segment.map.uri
      if (!localMapNames.has(sourceMapUri)) {
        const mapName = `init-${localMapNames.size}.mp4`
        const mapUri = await Filesystem.getUri({ path: `${localDirectory}/${mapName}`, directory: Directory.Data })
        await FileTransfer.downloadFile({ url: new URL(sourceMapUri, playlistUrl).href, path: mapUri.uri })
        localMapNames.set(sourceMapUri, mapName)
      }
      segment.map.uri = localMapNames.get(sourceMapUri)!
      segment.map.byterange = undefined
    }
  }

  const localPlaylist = stringify(playlist)
  await Filesystem.writeFile({
    path: `${localDirectory}/index.m3u8`,
    directory: Directory.Data,
    data: localPlaylist,
    encoding: Encoding.UTF8,
    recursive: true,
  })
  entry.title = title
  entry.path = `${localDirectory}/index.m3u8`
  entry.kind = 'hls'
}

async function saveHlsWeb(url: string, title: string) {
  let playlistUrl = url
  let playlist = await fetchPlaylist(playlistUrl)
  if (playlist.isMasterPlaylist) {
    const variant = playlist.variants[0]
    if (!variant) throw new Error('主播放列表没有可用清晰度。')
    playlistUrl = new URL(variant.uri, playlistUrl).href
    playlist = await fetchPlaylist(playlistUrl)
  }
  if (playlist.isMasterPlaylist) throw new Error('暂不支持嵌套 HLS 主播放列表。')
  assertDownloadablePlaylist(playlist)
  if (playlist.segments.some((segment) => segment.byterange || segment.map?.byterange)) {
    throw new Error('网页端暂不支持使用字节范围的 HLS 分片。')
  }

  const { default: JSZipConstructor } = await import('jszip')
  const zip = new JSZipConstructor()
  let index = 0
  const originalMapUris = playlist.segments.map((segment) => segment.map?.uri)
  const localMapNames = new Map<string, string>()
  for (const [segmentIndex, segment] of playlist.segments.entries()) {
    const name = `segments/segment-${String(index++).padStart(5, '0')}.${segment.mimeType.includes('mp4') ? 'm4s' : 'ts'}`
    const response = await fetch(new URL(segment.uri, playlistUrl))
    if (!response.ok) throw new Error(`HLS 分片下载失败（${response.status}）`)
    zip.file(name, await response.blob())
    segment.uri = name
    Reflect.deleteProperty(segment, 'byterange')
    if (segment.map) {
      const sourceMapUri = originalMapUris[segmentIndex] || segment.map.uri
      if (!localMapNames.has(sourceMapUri)) {
        const mapName = `segments/init-${localMapNames.size}.mp4`
        const mapResponse = await fetch(new URL(sourceMapUri, playlistUrl))
        if (!mapResponse.ok) throw new Error(`HLS 初始化分片下载失败（${mapResponse.status}）`)
        zip.file(mapName, await mapResponse.blob())
        localMapNames.set(sourceMapUri, mapName)
      }
      segment.map.uri = localMapNames.get(sourceMapUri)!
      segment.map.byterange = undefined
    }
  }
  zip.file('index.m3u8', stringify(playlist))
  const blob = await zip.generateAsync({ type: 'blob' })
  const objectUrl = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = objectUrl
  anchor.download = `${safeName(title)}.zip`
  anchor.click()
  URL.revokeObjectURL(objectUrl)
}

export async function downloadMedia(url: string, title: string) {
  const isHls = /\.m3u8(?:$|[?#])/i.test(url)
  if (!Capacitor.isNativePlatform()) {
    if (isHls) {
      await saveHlsWeb(url, title)
      return null
    }
    const response = await fetch(url)
    if (!response.ok) throw new Error(`视频下载失败（${response.status}）`)
    const objectUrl = URL.createObjectURL(await response.blob())
    const anchor = document.createElement('a')
    anchor.href = objectUrl
    anchor.download = `${safeName(title)}.${getExtension(url)}`
    anchor.click()
    URL.revokeObjectURL(objectUrl)
    return null
  }

  const item: OfflineMedia = {
    id: crypto.randomUUID(),
    title,
    path: '',
    kind: isHls ? 'hls' : 'video',
    createdAt: Date.now(),
  }

  if (isHls) {
    await saveHlsNative(url, title, item)
  } else {
    const filename = `${safeName(title)}.${getExtension(url)}`
    await Filesystem.mkdir({ path: `offline/${item.id}`, directory: Directory.Data, recursive: true })
    const file = await Filesystem.getUri({ path: `offline/${item.id}/${filename}`, directory: Directory.Data })
    await FileTransfer.downloadFile({ url, path: file.uri, progress: true })
    item.path = `offline/${item.id}/${filename}`
  }

  const current = readOfflineMedia()
  persistOfflineMedia([item, ...current])
  return item
}

export async function getOfflineUrl(item: OfflineMedia) {
  if (!Capacitor.isNativePlatform()) return null
  const result = await Filesystem.getUri({ path: item.path, directory: Directory.Data })
  return Capacitor.convertFileSrc(result.uri)
}

export async function deleteOfflineMedia(item: OfflineMedia) {
  if (Capacitor.isNativePlatform()) {
    await Filesystem.rmdir({ path: `offline/${item.id}`, directory: Directory.Data, recursive: true })
  }
  persistOfflineMedia(readOfflineMedia().filter(({ id }) => id !== item.id))
}