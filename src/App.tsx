import { useEffect, useState } from 'react'
import type Hls from 'hls.js'
import {
  ArrowDownWideNarrow, Clapperboard, Film, LoaderCircle, Play,
  Search, SlidersHorizontal, Sparkles, Star, X,
} from 'lucide-react'
import { fetchCategories, fetchVodDetail, fetchVodPage } from './api'
import type { VodCategory, VodDetail, VodListItem, VodPlaySource } from './api'
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

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="#home" aria-label="Frame 影视首页">
          <span className="brand-mark"><Clapperboard size={19} strokeWidth={2.1} /></span>
          <span className="brand-name">FRAME<span>/</span>PLAY</span>
        </a>
        <span className="platform-badge"><span className="live-dot" /> VIDEO LIBRARY</span>
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

      <footer className="app-footer"><span><span className="footer-mark">F</span> FRAME / VIDEO LIBRARY</span><span>播放内容由视频源提供 <span className="footer-separator">·</span> HLS READY</span></footer>

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
                {currentEpisodes.length > 0 ? <div className="episode-grid">{currentEpisodes.map((episode, index) => <button className={playing?.id === episode.id ? 'episode-button is-playing' : 'episode-button'} key={episode.id} type="button" onClick={() => playEpisode(episode)}><span>{episode.name}</span><Play size={13} fill="currentColor" /><span className="episode-number">{String(index + 1).padStart(2, '0')}</span></button>)}</div> : <div className="episode-empty">当前内容暂无可播放集数。</div>}
              </section>
            </div>
          </>}
        </section>
      </div>}
    </div>
  )
}

export default App