import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.xinaliu.livevideo',
  appName: '以来影视',
  webDir: 'dist',
  plugins: {
    Chromecast: {
      receiverApplicationId: 'CC1AD845',
    },
  },
}

export default config