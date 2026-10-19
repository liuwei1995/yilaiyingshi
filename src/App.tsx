import { useEffect, useRef, useState } from 'react'
import type Hls from 'hls.js'
import {
  Check, CircleHelp, Clapperboard, Clock3, ExternalLink, FileVideo2, Film,
  ListVideo, LoaderCircle, Plus, Radio, Search, ShieldCheck, Trash2, Upload, X,
} from 'lucide-react'
import './App.css'

type MediaItem = { id: string; title: string; url: string; source: 'url' | 'file' }

const storageKey = 'frame-player-playlist-v1'
const demoStream = 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8'
const isHls = (url: string) => /\.m3u8(?:$|[?#])/i.test(url)

function readPlaylist(): MediaItem[] {
  try {
    const value = localStorage.getItem(storageKey)
    if (!value) return []
    const items = JSON.parse(value) as MediaItem[]
    return Array.isArray(items) ? items.filter((item) => item.source === 'url' && item.url) : []
  } catch {
    return []
  }
}

function titleFromUrl(value: string) {
  try {
    const url = new URL(value)
    return decodeURIComponent(url.pathname.split('/').filter(Boolean).pop() || url.hostname)
  } catch {
    return value
  }
}

function App() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [playlist, setPlaylist] = useState<MediaItem[]>(readPlaylist)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [urlInput, setUrlInput] = useState('')
  const [filter, setFilter] = useState('')
  const [error, setError] = useState('')
  const [isReady, setIsReady] = useState(false)
  const [copied, setCopied] = useState(false)
  const [speed, setSpeed] = useState('1')
  const activeItem = playlist.find((item) => item.id === activeId) ?? null
  const visiblePlaylist = playlist.filter((item) => item.title.toLowerCase().includes(filter.toLowerCase()))

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(playlist.filter((item) => item.source === 'url')))
    } catch (storageError) {
      console.warn('播放列表无法保存到浏览器存储。', storageError)
    }
  }, [playlist])

  useEffect(() => {
    const video = videoRef.current
    if (!video || !activeItem) {
      setIsReady(false)
      return
    }

    setError('')
    setIsReady(false)
    const cleanupVideo = () => {
      video.pause()
      video.removeAttribute('src')
      video.load()
    }

    if (!isHls(activeItem.url)) {
      video.src = activeItem.url
      return cleanupVideo
    }

    let hls: Hls | undefined
    let cancelled = false
    void import('hls.js/light').then(({ default: HlsPlayer }) => {
      if (cancelled) return
      if (HlsPlayer.isSupported()) {
        const player = new HlsPlayer({ enableWorker: true })
        hls = player
        player.loadSource(activeItem.url)
        player.attachMedia(video)
        player.on(HlsPlayer.Events.MANIFEST_PARSED, () => setIsReady(true))
        player.on(HlsPlayer.Events.ERROR, (_event, data) => {
          if (!data.fatal) return
          if (data.type === HlsPlayer.ErrorTypes.NETWORK_ERROR) {
            setError('无法载入播放列表。请检查链接、网络和服务器 CORS 设置。')
          } else if (data.type === HlsPlayer.ErrorTypes.MEDIA_ERROR) {
            setError('视频编码不受支持，或媒体数据已损坏。')
          } else {
            setError('HLS 播放失败，请确认播放地址可访问。')
          }
        })
      } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = activeItem.url
      } else {
        setError('此浏览器不支持 HLS 播放。')
      }
    }).catch(() => {
      if (!cancelled) setError('HLS 播放模块加载失败，请刷新后重试。')
    })

    return () => {
      cancelled = true
      hls?.destroy()
      cleanupVideo()
    }
  }, [activeItem])

  useEffect(() => {
    if (videoRef.current) videoRef.current.playbackRate = Number(speed)
  }, [speed])

  function addUrl(value = urlInput) {
    let parsed: URL
    try {
      parsed = new URL(value.trim())
    } catch {
      setError('请输入有效的 http 或 https 播放地址。')
      return
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      setError('仅支持 http 或 https 播放地址。')
      return
    }
    const existing = playlist.find((item) => item.url === parsed.href)
    if (existing) {
      setActiveId(existing.id)
    } else {
      const item: MediaItem = {
        id: crypto.randomUUID(), title: titleFromUrl(parsed.href), url: parsed.href, source: 'url',
      }
      setPlaylist((items) => [item, ...items])
      setActiveId(item.id)
    }
    setUrlInput('')
    setError('')
  }

  function addFile(file?: File) {
    if (!file) return
    if (!file.type.startsWith('video/')) {
      setError('请选择浏览器支持的视频文件。')
      return
    }
    const item: MediaItem = {
      id: crypto.randomUUID(), title: file.name, url: URL.createObjectURL(file), source: 'file',
    }
    setPlaylist((items) => [item, ...items])
    setActiveId(item.id)
    setError('')
  }

  function removeItem(item: MediaItem) {
    if (item.source === 'file') URL.revokeObjectURL(item.url)
    setPlaylist((items) => items.filter(({ id }) => id !== item.id))
    if (activeId === item.id) setActiveId(null)
  }

  async function copyActiveUrl() {
    if (!activeItem) return
    try {
      await navigator.clipboard.writeText(activeItem.url)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    } catch {
      setError('复制失败，请检查浏览器剪贴板权限。')
    }
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="#home" aria-label="Frame 播放器首页">
          <span className="brand-mark"><Clapperboard size={19} strokeWidth={2.1} /></span>
          <span className="brand-name">FRAME<span>/</span>PLAY</span>
        </a>
        <div className="topbar-meta">
          <span className="platform-badge"><span className="live-dot" /> LOCAL PLAYER</span>
          <a className="help-link" href="#player-help" aria-label="播放帮助" title="播放帮助"><CircleHelp size={17} /></a>
        </div>
      </header>

      <main className="studio" id="home">
        <section className="viewer-column" aria-label="视频播放器">
          <div className="section-heading">
            <div><div className="eyebrow">PLAYBACK DESK <span>01 / LIVE</span></div><h1>视频播放器</h1></div>
            <div className="format-tags"><span>HLS</span><span>MP4</span><span>WEBM</span></div>
          </div>

          <div className="player-frame">
            <video
              ref={videoRef} controls playsInline preload="metadata"
              onLoadedMetadata={() => setIsReady(true)}
              onError={() => { if (activeItem) setError('无法播放此媒体。检查地址、网络及视频编码格式。') }}
              onRateChange={(event) => setSpeed(String(event.currentTarget.playbackRate))}
              aria-label={activeItem ? `正在播放 ${activeItem.title}` : '视频播放区域'}
            />
            {!activeItem && <div className="empty-player">
              <div className="empty-player-mark"><Film size={27} strokeWidth={1.5} /></div>
              <p>画面将在这里展开</p><span>粘贴播放链接，或打开本地视频</span>
            </div>}
            {activeItem && !isReady && !error && <div className="loading-indicator"><LoaderCircle size={18} /> 正在连接媒体源</div>}
            {error && <div className="player-error" role="alert">{error}</div>}
            <span className="player-corner">{activeItem && isHls(activeItem.url) ? 'HLS STREAM' : 'MEDIA SOURCE'}</span>
          </div>

          <div className="now-playing">
            <div className="now-playing-title">
              <span className="now-icon"><Radio size={16} /></span>
              <div><span className="eyebrow">NOW PLAYING</span><strong title={activeItem?.title}>{activeItem?.title ?? '等待选择媒体'}</strong></div>
            </div>
            <div className="playback-tools">
              {activeItem?.source === 'url' && <button className="tool-button" type="button" onClick={copyActiveUrl} title="复制播放地址" aria-label="复制播放地址">
                {copied ? <Check size={17} /> : <ExternalLink size={17} />}<span>{copied ? '已复制' : '复制链接'}</span>
              </button>}
              <label className="speed-control" title="播放速度"><Clock3 size={15} />
                <select aria-label="播放速度" value={speed} onChange={(event) => {
                  const value = event.target.value
                  setSpeed(value)
                  if (videoRef.current) videoRef.current.playbackRate = Number(value)
                }}>
                  <option value="0.5">0.5x</option><option value="0.75">0.75x</option><option value="1">1x</option>
                  <option value="1.25">1.25x</option><option value="1.5">1.5x</option><option value="2">2x</option>
                </select>
              </label>
            </div>
          </div>
          <div className="source-note" id="player-help"><ShieldCheck size={15} /><span>播放内容直接来自你提供的地址；视频不会上传到此应用。</span></div>
        </section>

        <aside className="queue-column" aria-label="播放列表">
          <div className="queue-heading">
            <div><div className="eyebrow">YOUR MEDIA <span>02 / QUEUE</span></div><h2>播放列表 <span className="queue-count">{playlist.length.toString().padStart(2, '0')}</span></h2></div>
            <button className="icon-button" type="button" onClick={() => fileInputRef.current?.click()} title="打开本地视频" aria-label="打开本地视频"><Upload size={18} /></button>
            <input ref={fileInputRef} type="file" accept="video/*" hidden onChange={(event) => {
              addFile(event.target.files?.[0])
              event.target.value = ''
            }} />
          </div>

          <form className="url-form" onSubmit={(event) => { event.preventDefault(); addUrl() }}>
            <label className="url-input-wrap"><span className="sr-only">播放链接</span>
              <input type="url" value={urlInput} onChange={(event) => setUrlInput(event.target.value)} placeholder="粘贴 .m3u8 或视频链接" aria-label="粘贴 .m3u8 或视频链接" />
              {urlInput && <button className="clear-input" type="button" onClick={() => setUrlInput('')} title="清空链接" aria-label="清空链接"><X size={15} /></button>}
            </label>
            <button className="add-button" type="submit" title="添加到播放列表" aria-label="添加到播放列表"><Plus size={19} /></button>
          </form>

          <div className="queue-actions">
            <div className="queue-label"><ListVideo size={15} /><span>UP NEXT</span></div>
            <label className="search-wrap"><Search size={14} /><input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="搜索列表" aria-label="搜索播放列表" /></label>
          </div>

          <div className="playlist-list" role="list">
            {visiblePlaylist.map((item, index) => <div className={`playlist-item${item.id === activeId ? ' is-active' : ''}`} key={item.id} role="listitem">
              <button className="playlist-select" type="button" onClick={() => { setActiveId(item.id); setError('') }} aria-label={`播放 ${item.title}`}>
                <span className="item-index">{String(index + 1).padStart(2, '0')}</span>
                <span className="item-copy"><strong title={item.title}>{item.title}</strong><span>{item.source === 'file' ? '本地文件' : isHls(item.url) ? 'HLS STREAM' : 'VIDEO LINK'}</span></span>
                <span className="item-play-state">{item.id === activeId ? <Radio size={15} /> : <Plus size={15} />}</span>
              </button>
              <button className="remove-button" type="button" onClick={() => removeItem(item)} title={`移除 ${item.title}`} aria-label={`移除 ${item.title}`}><Trash2 size={15} /></button>
            </div>)}
            {visiblePlaylist.length === 0 && <div className="empty-queue">
              {filter ? <Search size={20} /> : <FileVideo2 size={22} />}
              <strong>{filter ? '没有匹配的媒体' : '播放列表还是空的'}</strong>
              <span>{filter ? '试试其他关键词' : '添加一个 HLS 地址开始播放'}</span>
              {!filter && <button type="button" onClick={() => addUrl(demoStream)}>载入 HLS 示例 <ExternalLink size={13} /></button>}
            </div>}
          </div>

          <div className="queue-footer">
            <span><Check size={14} /> 播放链接保存在此设备</span>
            <button type="button" onClick={() => {
              playlist.filter((item) => item.source === 'file').forEach((item) => URL.revokeObjectURL(item.url))
              setPlaylist([])
              setActiveId(null)
            }} disabled={playlist.length === 0}>清空列表</button>
          </div>
        </aside>
      </main>

      <footer className="app-footer"><span><span className="footer-mark">F</span> FRAME / PLAYBACK DESK</span><span>HLS READY <span className="footer-separator">·</span> BUILT FOR YOUR SCREEN</span></footer>
    </div>
  )
}

export default App