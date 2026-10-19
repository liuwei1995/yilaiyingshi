export type VodCategory = {
  type_id: number | string
  type_name: string
  type_extend?: Record<string, string>
}

export type VodListItem = {
  vod_id: number | string
  vod_name: string
  vod_pic: string
  vod_year?: string
  vod_score?: number | string
  vod_time?: number | string
  vod_remarks?: string
}

export type VodPage = {
  total: number
  limit: number
  page: number
  list: VodListItem[]
}

export type VodFilters = Partial<Record<'area' | 'year' | 'class' | 'lang', string>>

export type VodPlaySource = {
  from?: string
  url?: string
  player_info?: { show?: string }
}

export type VodDetail = VodListItem & {
  type?: VodCategory
  vod_content?: string
  vod_blurb?: string
  vod_actor?: string
  vod_director?: string
  vod_area?: string
  vod_lang?: string
  vod_play_from?: string
  vod_play_url?: string
  vod_play_list?: VodPlaySource[]
}

type ApiEnvelope<T> = {
  code: number
  msg?: string
  data: T
}

const apiRoot = (import.meta.env.VITE_VOD_API_BASE_URL || '/api.php').replace(/\/$/, '')

async function request<T>(path: string, params: Record<string, string> = {}, signal?: AbortSignal): Promise<T> {
  const url = new URL(`${apiRoot}/${path}`, window.location.origin)
  Object.entries(params).forEach(([key, value]) => {
    if (value) url.searchParams.set(key, value)
  })

  const response = await fetch(url, { signal })
  if (!response.ok) throw new Error(`接口请求失败（${response.status}）`)

  const result = await response.json() as ApiEnvelope<T>
  if (result.code !== 200) throw new Error(result.msg || '影视数据请求失败')
  return result.data
}

export async function fetchCategories(signal?: AbortSignal) {
  const result = await request<VodCategory[] | { list?: VodCategory[] }>('v1.vod/types', {}, signal)
  return Array.isArray(result) ? result : result.list || []
}

export function fetchVodPage(typeId: string, keyword: string, page: number, filters: VodFilters, signal?: AbortSignal) {
  return request<VodPage>('v1.vod', {
    type: typeId,
    wd: keyword,
    page: String(page),
    ...filters,
  }, signal)
}

export function fetchVodDetail(vodId: string | number, signal?: AbortSignal) {
  return request<VodDetail>('v1.vod/detail', { vod_id: String(vodId) }, signal)
}