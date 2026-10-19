import { Capacitor, registerPlugin } from '@capacitor/core'

export type DlnaDevice = { id: string; name: string }

type NativeDlnaPlugin = {
  discover(): Promise<{ devices: DlnaDevice[] }>
  play(options: { id: string; url: string; title: string }): Promise<void>
}

const NativeDlna = registerPlugin<NativeDlnaPlugin>('NativeDlna')

export async function discoverDlna(): Promise<DlnaDevice[]> {
  if (window.yilaiDesktop) return window.yilaiDesktop.discoverDlna()
  if (Capacitor.getPlatform() === 'android') {
    const result = await NativeDlna.discover()
    return result.devices
  }
  return []
}

export async function sendToDlna(device: DlnaDevice, url: string, title: string) {
  if (window.yilaiDesktop) return window.yilaiDesktop.playDlna({ id: device.id, url, title })
  if (Capacitor.getPlatform() === 'android') return NativeDlna.play({ id: device.id, url, title })
  throw new Error('当前设备不支持 DLNA；iOS 请使用 AirPlay。')
}