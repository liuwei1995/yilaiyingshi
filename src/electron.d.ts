export {}

declare global {
  interface Window {
    yilaiDesktop?: {
      discoverDlna: () => Promise<{ id: string; name: string }[]>
      playDlna: (media: { id: string; url: string; title: string }) => Promise<void>
    }
  }
}