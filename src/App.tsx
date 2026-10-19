import { useEffect, useRef, useState } from 'react'
import { Capacitor } from '@capacitor/core'
import { Chromecast } from '@capnative/capacitor-chromecast'
import type Hls from 'hls.js'
import {
  ArrowDownWideNarrow, Cast, Clapperboard, Download, DownloadCloud, Film,
  LoaderCircle, Play, Search, SlidersHorizontal, Sparkles, Star, Trash2, X,
} from 'lucide-react'
import { fetchCategories, fetchVodDetail, fetchVodPage } from './api'
import type { VodCategory, VodDetail, VodListItem, VodPlaySource } from './api'
import { discoverDlna, sendToDlna } from './dlna'
import type { DlnaDevice } from './dlna'
import { deleteOfflineMedia, downloadMedia, getOfflineUrl, readOfflineMedia } from './offline'
import type { OfflineMedia } from './offline'
import './App.css'

type FilterKey = 'area' | 'year' | 'class' | 'lang'
type Episode = { id: string; name: string; url: string }
type EpisodeSource = { name: string; episodes: Episode[] }

const filterFields: { key: FilterKey; label: string }[] = [
  { key: 'class', label: '类型' },
  { key: 'area', label: '地区' },
  { key: 'year', label: '年份' },
  { key: 'lang', label: '语言' },
]

function splitEpisodes(value: string, sourceIndex: number): Episode[] {
  return value.split('#').flatMap((entry, index) => {
    const separator = entry.indexOf('$')
    if (separator < 0) return []
    const name = entry.slice(0, separator).trim()
    const url = entry.slice(separator + 1).trim()
    if (!url || !/^https?:\/\//i.test(url)) return []
    return [{ id: `${sourceIndex}-${index}`, name: name || `第 ${index + 1} 集`, url }]
  })
}

function getEpisodeSources(detail: VodDetail): EpisodeSource[] {
  const structuredSources = (detail.vod_play_list || []) as VodPlaySource[]
  const sources = structuredSources.length
    ? structuredSources.map((source) => ({ name: source.player_info?.show || source.from || '播放源', url: source.url || '' }))
    : (detail.vod_play_url || '').split('$$$').map((url, index) => ({
      name: (detail.vod_play_from || '').split('$$$')[index] || `播放源 ${index + 1}`,
      url,
    }))

  return sources
    .map((source, index) => ({ name: source.name, episodes: splitEpisodes(source.url, index) }))
    .filter((source) => source.episodes.length > 0)
}

function getFilterOptions(category: VodCategory | undefined, key: FilterKey) {
  const values = category?.type_extend?.[key]
  return values ? values.split(/[,，]/).map((value) => value.trim()).filter(Boolean) : []
}

function plainText(value: string) {
  return new DOMParser().parseFromString(value, 'text/html').body.textContent?.trim() || ''
}

function App() {
  const [categories, setCategories] = useState<VodCategory[]>([])
  const [categoryError, setCategoryError] = useState('')
  const [selectedType, setSelectedType] = useState('')
  const [keyword, setKeyword] = useState('')
  const [query, setQuery] = useState('')
  const [filters, setFilters] = useState<Partial<Record<FilterKey, string>>>({})
  const [videos, setVideos] = useState<VodListItem[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [sortBy, setSortBy] = useState<'latest' | 'score'>('latest')
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [listError, setListError] = useState('')
  const [selectedVodId, setSelectedVodId] = useState<string | number | null>(null)
  const [detail, setDetail] = useState<VodDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState('')
  const [selectedSource, setSelectedSource] = useState(0)
  const [playing, setPlaying] = useState<Episode | null>(null)
  const [playerError, setPlayerError] = useState('')
  const [playerReady, setPlayerReady] = useState(false)
  const [speed, setSpeed] = useState('1')
  const [offlineMedia, setOfflineMedia] = useState<OfflineMedia[]>(readOfflineMedia)
  const [showOffline, setShowOffline] = useState(false)
  const [downloadingId, setDownloadingId] = useState<string | null>(null)
  const [downloadMessage, setDownloadMessage] = useState('')
  const [castMessage, setCastMessage] = useState('')
  const [isScanningDlna, setIsScanningDlna] = useState(false)
  const [dlnaDevices, setDlnaDevices] = useState<DlnaDevice[]>([])
  const pendingCast = useRef<Episode | null>(null)

  const selectedCategory = categories.find((category) => String(category.type_id) === selectedType)
  const episodeSources = detail ? getEpisodeSources(detail) : []
  const currentEpisodes = episodeSources[selectedSource]?.episodes ?? []
  const hasActiveFilters = Object.values(filters).some(Boolean)
  const sortedVideos = [...videos].sort((left, right) => sortBy === 'score'
    ? Number(right.vod_score || 0) - Number(left.vod_score || 0)
    : Number(right.vod_time || 0) - Number(left.vod_time || 0))

  useEffect(() => {
    const controller = new AbortController()
    void fetchCategories(controller.signal)
      .then(setCategories)
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setCategoryError(error instanceof Error ? error.message : '分类加载失败')
      })
    return () => controller.abort()
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(keyword.trim()), 280)
    return () => window.clearTimeout(timer)
  }, [keyword])

  useEffect(() => {
    const controller = new AbortController()
    void fetchVodPage(selectedType, query, page, filters, controller.signal)
      .then((result) => {
        setVideos((current) => page === 1 ? result.list : [...current, ...result.list])
        setTotal(result.total)
        setHasMore(result.list.length >= result.limit && result.list.length > 0)
        setListError('')
        setLoading(false)
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setListError(error instanceof Error ? error.message : '影视列表加载失败')
          setLoading(false)
        }
      })
    return () => controller.abort()
  }, [selectedType, query, page, filters])

  useEffect(() => {
    const video = document.querySelector<HTMLVideoElement>('#detail-player')
    if (!video || !playing) return

    const clearSource = () => {
      video.pause()
      video.removeAttribute('src')
      video.load()
    }

    if (!/\.m3u8(?:$|[?#])/i.test(playing.url)) {
      video.src = playing.url
      return clearSource
    }

    let hls: Hls | undefined
    let cancelled = false
    void import('hls.js/light').then(({ default: HlsPlayer }) => {
      if (cancelled) return
      if (HlsPlayer.isSupported()) {
        const player = new HlsPlayer({ enableWorker: true })
        hls = player
        player.loadSource(playing.url)
        player.attachMedia(video)
        player.on(HlsPlayer.Events.MANIFEST_PARSED, () => setPlayerReady(true))
        player.on(HlsPlayer.Events.ERROR, (_event, data) => {
          if (data.fatal) setPlayerError('播放流加载失败，请尝试其他线路。')
        })
      } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = playing.url
      } else {
        setPlayerError('此设备暂不支持 HLS 播放。')
      }
    }).catch(() => {
      if (!cancelled) setPlayerError('播放模块加载失败，请重试。')
    })

    return () => {
      cancelled = true
      hls?.destroy()
      clearSource()
    }
  }, [playing])

  useEffect(() => {
    const video = document.querySelector<HTMLVideoElement>('#detail-player')
    if (video) video.playbackRate = Number(speed)
  }, [speed])

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return
    let listener: { remove: () => Promise<void> } | undefined
    let disposed = false
    void Chromecast.initialize({ receiverApplicationId: 'CC1AD845' })
      .then(async () => {
        if (disposed) return
        listener = await Chromecast.addListener('sessionStateChanged', async ({ state }) => {
          const media = pendingCast.current
          if (state !== 'connected' || !media) return
          pendingCast.current = null
          try {
            await Chromecast.loadMedia({ url: media.url })
          } catch (error) {
            setCastMessage(error instanceof Error ? error.message : '投屏播放失败。')
          }
        })
      })
      .catch((error: unknown) => setCastMessage(error instanceof Error ? error.message : '投屏服务初始化失败。'))
    return () => {
      disposed = true
      void listener?.remove()
    }
  }, [])

  function changeCategory(typeId: string) {
    setSelectedType(typeId)
    setFilters({})
    setVideos([])
    setPage(1)
    setLoading(true)
  }

  function changeFilter(key: FilterKey, value: string) {
    setFilters((current) => ({ ...current, [key]: value }))
    setVideos([])
    setPage(1)
    setLoading(true)
  }

  function submitSearch(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setQuery(keyword.trim())
    setVideos([])
    setPage(1)
    setLoading(true)
  }

  function openDetail(video: VodListItem) {
    setSelectedVodId(video.vod_id)
    setDetail(null)
    setDetailError('')
    setDetailLoading(true)
    setPlaying(null)
    setPlayerError('')
    setPlayerReady(false)
    setSelectedSource(0)
    void fetchVodDetail(video.vod_id)
      .then(setDetail)
      .catch((error: unknown) => setDetailError(error instanceof Error ? error.message : '详情加载失败'))
      .finally(() => setDetailLoading(false))
  }

  function closeDetail() {
    setSelectedVodId(null)
    setPlaying(null)
    setPlayerReady(false)
    setPlayerError('')
  }

  function playEpisode(episode: Episode) {
    setPlayerReady(false)
    setPlayerError('')
    setPlaying(episode)
  }

  function loadMore() {
    setLoading(true)
    setPage((current) => current + 1)
  }

  async function castEpisode(episode: Episode) {
    setCastMessage('')
    try {
      if (window.yilaiDesktop || Capacitor.getPlatform() === 'android') {
        setIsScanningDlna(true)
        try {
          const devices = await discoverDlna()
          setDlnaDevices(devices)
          if (devices.length === 0) setCastMessage('没有发现 DLNA 设备，请确认设备已连接同一 Wi-Fi。')
        } finally {
          setIsScanningDlna(false)
        }
        return
      }
      if (!Capacitor.isNativePlatform()) {
        await systemCast()
        return
      }
      if (await Chromecast.isConnected()) {
        await Chromecast.loadMedia({ url: episode.url })
      } else {
        pendingCast.current = episode
        await Chromecast.show()
      }
    } catch (error) {
      setCastMessage(error instanceof Error ? error.message : '投屏失败，请重试。')
    }
  }

  async function systemCast() {
    const video = document.querySelector<HTMLVideoElement>('#detail-player') as (HTMLVideoElement & {
      remote?: { prompt: () => Promise<void> }
      webkitShowPlaybackTargetPicker?: () => void
    }) | null
    if (Capacitor.getPlatform() === 'ios' && video?.webkitShowPlaybackTargetPicker) {
      video.webkitShowPlaybackTargetPicker()
      return
    }
    if (video?.remote?.prompt) {
      await video.remote.prompt()
      return
    }
    setCastMessage('当前浏览器不支持系统投屏；请使用支持 AirPlay 或 Remote Playback 的浏览器。')
  }

  async function playOnDlna(device: DlnaDevice, episode: Episode) {
    try {
      await sendToDlna(device, episode.url, `${detail?.vod_name || ''} ${episode.name}`.trim())
      setCastMessage(`已发送到 ${device.name}`)
      setDlnaDevices([])
    } catch (error) {
      setCastMessage(error instanceof Error ? error.message : 'DLNA 投屏失败。')
    }
  }

  async function downloadEpisode(episode: Episode) {
    setDownloadingId(episode.id)
    setDownloadMessage('正在下载并保存到本地…')
    try {
      const item = await downloadMedia(episode.url, `${detail?.vod_name || '视频'}-${episode.name}`)
      if (item) setOfflineMedia(readOfflineMedia())
      setDownloadMessage(item ? '已保存到本机离线库。' : '浏览器下载已开始。')
    } catch (error) {
      setDownloadMessage(error instanceof Error ? error.message : '下载失败，请检查网络和跨域设置。')
    } finally {
      setDownloadingId(null)
    }
  }

  async function playOffline(item: OfflineMedia) {
    try {
      const url = await getOfflineUrl(item)
      if (!url) throw new Error('浏览器下载文件不支持在应用内离线播放。')
      setDetail({ vod_id: item.id, vod_name: item.title, vod_pic: '', vod_content: '保存在本机的离线媒体。' })
      setSelectedVodId(item.id)
      setShowOffline(false)
      playEpisode({ id: `offline-${item.id}`, name: '离线播放', url })
    } catch (error) {
      setDownloadMessage(error instanceof Error ? error.message : '离线文件打开失败。')
    }
  }

  async function removeOffline(item: OfflineMedia) {
    try {
      await deleteOfflineMedia(item)
      setOfflineMedia(readOfflineMedia())
    } catch (error) {
      setDownloadMessage(error instanceof Error ? error.message : '删除离线文件失败。')
    }
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="#home" aria-label="以来影视首页">
          <span className="brand-mark"><Clapperboard size={19} strokeWidth={2.1} /></span>
          <span className="brand-name">以来影视</span>
        </a>
        <div className="header-actions">
          <button className="offline-trigger" type="button" onClick={() => { setOfflineMedia(readOfflineMedia()); setShowOffline(true) }} title="打开离线媒体库">
            <DownloadCloud size={16} /><span>离线库</span><b>{offlineMedia.length}</b>
          </button>
          <span className="platform-badge"><span className="live-dot" /> VIDEO LIBRARY</span>
        </div>
      </header>

      <main className="library" id="home">
        <section className="library-intro">
          <div className="intro-copy">
            <div className="eyebrow"><Sparkles size={13} /> YOUR NEXT WATCH <span>01 / DISCOVER</span></div>
            <h1>把好片，<span>放进今晚。</span></h1>
            <p>从分类开始，找到想看的那一部。</p>
          </div>
          <form className="catalog-search" onSubmit={submitSearch}>
            <Search size={19} />
            <input
              value={keyword}
              onChange={(event) => {
                setKeyword(event.target.value)
                setVideos([])
                setPage(1)
                setLoading(true)
              }}
              placeholder="搜索片名、关键词..."
              aria-label="搜索片名或关键词"
            />
            {keyword && <button type="button" onClick={() => {
              setKeyword('')
              setQuery('')
              setVideos([])
              setPage(1)
              setLoading(true)
            }} aria-label="清除搜索"><X size={16} /></button>}
            <kbd>ENTER</kbd>
          </form>
        </section>

        <nav className="category-bar" aria-label="影视分类">
          <span className="category-label">BROWSE BY</span>
          <div className="category-list">
            <button className={!selectedType ? 'category-tab is-selected' : 'category-tab'} type="button" onClick={() => changeCategory('')}>全部</button>
            {categories.map((category) => <button
              className={selectedType === String(category.type_id) ? 'category-tab is-selected' : 'category-tab'}
              type="button"
              key={category.type_id}
              onClick={() => changeCategory(String(category.type_id))}
            >{category.type_name}</button>)}
          </div>
        </nav>

        <section className="catalog-section" aria-label="影视目录">
          <div className="catalog-toolbar">
            <div className="catalog-heading">
              <div className="eyebrow"><Film size={13} /> {selectedCategory?.type_name || (query ? 'SEARCH RESULTS' : 'LATEST RELEASES')} <span>02 / LIBRARY</span></div>
              <h2>{query ? `“${query}” 的搜索结果` : selectedCategory?.type_name || '正在热播'} <span className="result-count">{total ? `${total}+` : '—'}</span></h2>
            </div>
            <div className="filter-controls">
              <span className="filter-label"><SlidersHorizontal size={14} /> 筛选</span>
              {filterFields.map(({ key, label }) => {
                const options = getFilterOptions(selectedCategory, key)
                if (!options.length) return null
                return <label className="filter-select" key={key}>
                  <span className="sr-only">按{label}筛选</span>
                  <select value={filters[key] || ''} onChange={(event) => changeFilter(key, event.target.value)}>
                    <option value="">{label}</option>
                    {options.map((option) => <option key={option} value={option}>{option}</option>)}
                  </select>
                </label>
              })}
              <label className="sort-select"><ArrowDownWideNarrow size={14} /><select aria-label="排序方式" value={sortBy} onChange={(event) => setSortBy(event.target.value as 'latest' | 'score')}><option value="latest">最新</option><option value="score">高分</option></select></label>
              {hasActiveFilters && <button className="clear-filters" type="button" onClick={() => changeCategory(selectedType)}>清除筛选</button>}
            </div>
          </div>

          {categoryError && <div className="catalog-message" role="alert">分类加载失败：{categoryError}</div>}
          {listError && <div className="catalog-message" role="alert">影视列表加载失败：{listError}<button type="button" onClick={() => { setListError(''); setLoading(true); setPage(1) }}>重试</button></div>}

          {loading && videos.length === 0 ? <div className="catalog-loading"><LoaderCircle size={22} /> 正在整理片单</div> : sortedVideos.length > 0 ? <div className="movie-grid">
            {sortedVideos.map((video) => <button className="movie-card" key={video.vod_id} type="button" onClick={() => openDetail(video)}>
              <span className="poster-wrap">
                {video.vod_pic ? <img src={video.vod_pic} alt={`${video.vod_name} 海报`} loading="lazy" onError={(event) => { event.currentTarget.style.display = 'none' }} /> : <span className="poster-fallback"><Film size={28} /></span>}
                <span className="poster-overlay"><span className="play-poster"><Play size={17} fill="currentColor" /></span></span>
                {video.vod_remarks && <span className="poster-remarks">{video.vod_remarks}</span>}
                {video.vod_score && <span className="poster-score"><Star size={11} fill="currentColor" /> {video.vod_score}</span>}
              </span>
              <span className="movie-info"><strong title={video.vod_name}>{video.vod_name}</strong><span>{video.vod_year || '年份未知'}<i />{selectedCategory?.type_name || '影视'}</span></span>
            </button>)}
          </div> : !loading && !listError && <div className="catalog-empty"><Film size={25} /><strong>{query ? '没有找到相关影视' : '这个筛选下暂无内容'}</strong><span>换个分类或关键词再试试。</span></div>}

          {loading && videos.length > 0 && <div className="load-more-progress"><LoaderCircle size={16} /> 正在加载下一页</div>}
          {!loading && hasMore && videos.length > 0 && <button className="load-more" type="button" onClick={loadMore}>加载更多 <span>↓</span></button>}
        </section>
      </main>

      <footer className="app-footer"><span><span className="footer-mark">影</span> 以来影视</span><span>播放内容由视频源提供 <span className="footer-separator">·</span> HLS READY</span></footer>

      {selectedVodId !== null && <div className="detail-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeDetail() }}>
        <section className="detail-panel" role="dialog" aria-modal="true" aria-label={detail?.vod_name || '影视详情'}>
          <button className="detail-close" type="button" onClick={closeDetail} aria-label="关闭详情"><X size={20} /></button>
          {detailLoading ? <div className="detail-loading"><LoaderCircle size={24} /> 正在加载详情</div> : detailError ? <div className="detail-loading" role="alert">{detailError}<button type="button" onClick={closeDetail}>返回片库</button></div> : detail && <>
            <div className="detail-scroll">
              {playing && <div className="detail-player-wrap">
                <div className="detail-player-heading"><span><span className="live-dot" /> 正在播放</span><strong>{detail.vod_name} · {playing.name}</strong></div>
                <div className="detail-video-frame">
                  <video
                    id="detail-player"
                    controls
                    autoPlay
                    playsInline
                    poster={detail.vod_pic || undefined}
                    onLoadedMetadata={() => setPlayerReady(true)}
                    onError={() => setPlayerError('当前线路播放失败，请尝试其他集数或播放源。')}
                  />
                  {!playerReady && !playerError && <div className="video-loading"><LoaderCircle size={19} /> 正在连接视频源</div>}
                  {playerError && <div className="video-error" role="alert">{playerError}</div>}
                </div>
                <div className="detail-player-tools"><span>HLS / VIDEO</span><label>倍速<select value={speed} onChange={(event) => setSpeed(event.target.value)}><option value="0.5">0.5x</option><option value="0.75">0.75x</option><option value="1">1x</option><option value="1.25">1.25x</option><option value="1.5">1.5x</option><option value="2">2x</option></select></label></div>
                <div className="media-actions">
                  {playing && <button type="button" onClick={() => void castEpisode(playing)}><Cast size={16} />{isScanningDlna ? '搜索设备…' : '投屏'}</button>}
                  {playing && !playing.id.startsWith('offline-') && <button type="button" disabled={downloadingId === playing.id} onClick={() => void downloadEpisode(playing)}><Download size={16} />{downloadingId === playing.id ? '下载中…' : '下载本集'}</button>}
                  {playing && <button type="button" onClick={() => void systemCast()}><Cast size={16} />系统/AirPlay</button>}
                  <button type="button" onClick={() => { setOfflineMedia(readOfflineMedia()); setShowOffline(true) }}><DownloadCloud size={16} />离线库</button>
                </div>
                {castMessage && <div className="media-notice" role="status">{castMessage}</div>}
                {dlnaDevices.length > 0 && <div className="dlna-picker"><strong>选择 DLNA 设备</strong>{dlnaDevices.map((device) => <button key={device.id} type="button" onClick={() => playing && void playOnDlna(device, playing)}>{device.name}<Play size={13} /></button>)}</div>}
                {downloadMessage && <div className="media-notice" role="status">{downloadMessage}</div>}
              </div>}

              <div className="detail-hero">
                <div className="detail-poster">{detail.vod_pic && <img src={detail.vod_pic} alt={`${detail.vod_name} 海报`} />}</div>
                <div className="detail-copy">
                  <div className="eyebrow">{detail.type?.type_name || selectedCategory?.type_name || 'VIDEO DETAIL'} <span>VOD / {detail.vod_year || '—'}</span></div>
                  <h2>{detail.vod_name}</h2>
                  <div className="detail-meta"><span>{detail.vod_year || '年份未知'}</span>{detail.vod_area && <><i /> <span>{detail.vod_area}</span></>}{detail.vod_score && <><i /> <span className="detail-rating"><Star size={13} fill="currentColor" /> {detail.vod_score}</span></>}{detail.vod_remarks && <><i /> <span>{detail.vod_remarks}</span></>}</div>
                  {detail.vod_director && <p><b>导演</b>{detail.vod_director}</p>}
                  {detail.vod_actor && <p><b>主演</b>{detail.vod_actor}</p>}
                  <div className="detail-description">{plainText(detail.vod_content || detail.vod_blurb || '') || '暂无简介'}</div>
                </div>
              </div>

              <section className="episode-section">
                <div className="episode-heading"><div><div className="eyebrow">SELECT AN EPISODE <span>03 / PLAY</span></div><h3>选集播放 <span>{currentEpisodes.length} 集</span></h3></div></div>
                {episodeSources.length > 1 && <div className="source-tabs" role="tablist" aria-label="播放源">{episodeSources.map((source, index) => <button className={selectedSource === index ? 'is-selected' : ''} type="button" role="tab" aria-selected={selectedSource === index} key={source.name} onClick={() => { setSelectedSource(index); setPlaying(null); setPlayerReady(false); setPlayerError('') }}>{source.name}</button>)}</div>}
                {currentEpisodes.length > 0 ? <div className="episode-grid">{currentEpisodes.map((episode, index) => <div className="episode-entry" key={episode.id}>
                  <button className={playing?.id === episode.id ? 'episode-button is-playing' : 'episode-button'} type="button" onClick={() => playEpisode(episode)}><span>{episode.name}</span><Play size={13} fill="currentColor" /><span className="episode-number">{String(index + 1).padStart(2, '0')}</span></button>
                  <button className="episode-download" type="button" title={`下载${episode.name}`} aria-label={`下载${episode.name}`} disabled={downloadingId === episode.id} onClick={() => void downloadEpisode(episode)}><Download size={14} /></button>
                </div>)}</div> : <div className="episode-empty">当前内容暂无可播放集数。</div>}
              </section>
            </div>
          </>}
        </section>
      </div>}

      {showOffline && <div className="detail-backdrop offline-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowOffline(false) }}>
        <section className="offline-panel" role="dialog" aria-modal="true" aria-label="离线媒体库">
          <div className="offline-heading"><div><div className="eyebrow">ON THIS DEVICE <span>OFFLINE LIBRARY</span></div><h2>离线媒体 <span>{offlineMedia.length}</span></h2></div><button className="detail-close" type="button" onClick={() => setShowOffline(false)} aria-label="关闭离线媒体库"><X size={20} /></button></div>
          {downloadMessage && <div className="media-notice" role="status">{downloadMessage}</div>}
          {offlineMedia.length ? <div className="offline-list">{offlineMedia.map((item) => <div className="offline-item" key={item.id}>
            <button className="offline-play" type="button" onClick={() => void playOffline(item)}><Play size={15} fill="currentColor" /><span><strong>{item.title}</strong><small>{item.kind === 'hls' ? 'HLS 离线分集' : '视频文件'} · {new Date(item.createdAt).toLocaleDateString()}</small></span></button>
            <button className="offline-delete" type="button" onClick={() => void removeOffline(item)} aria-label={`删除${item.title}`} title="删除下载"><Trash2 size={16} /></button>
          </div>)}</div> : <div className="offline-empty"><DownloadCloud size={25} /><strong>还没有离线视频</strong><span>在影视详情中下载单集后，会保存在这里。</span></div>}
        </section>
      </div>}
    </div>
  )
}

export default App