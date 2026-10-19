const { app, BrowserWindow, ipcMain, shell } = require('electron')
const dgram = require('node:dgram')
const { XMLBuilder, XMLParser } = require('fast-xml-parser')
const path = require('node:path')

const dlnaDevices = new Map()
const dlnaParser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' })
const dlnaBuilder = new XMLBuilder({ ignoreAttributes: false, attributeNamePrefix: '@_' })

function isPrivateAddress(host) {
  const octets = host.split('.').map(Number)
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false
  return octets[0] === 10
    || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31)
    || (octets[0] === 192 && octets[1] === 168)
    || (octets[0] === 169 && octets[1] === 254)
}

function getAvTransport(device) {
  const services = device?.serviceList?.service
  for (const service of Array.isArray(services) ? services : services ? [services] : []) {
    if (String(service.serviceType).includes(':AVTransport:')) return service
  }
  const children = device?.deviceList?.device
  for (const child of Array.isArray(children) ? children : children ? [children] : []) {
    const service = getAvTransport(child)
    if (service) return service
  }
  return undefined
}

async function readDlnaDevice(location) {
  try {
    const url = new URL(location)
    if (url.protocol !== 'http:' || !isPrivateAddress(url.hostname)) return null
    const response = await fetch(url, { signal: AbortSignal.timeout(3500) })
    if (!response.ok) return null
    const description = dlnaParser.parse(await response.text())
    const device = description?.root?.device
    const service = getAvTransport(device)
    if (!service?.controlURL || !device?.friendlyName) return null
    const controlUrl = new URL(service.controlURL, url)
    if (controlUrl.hostname !== url.hostname || controlUrl.protocol !== 'http:') return null
    return { id: location, name: String(device.friendlyName), controlUrl: controlUrl.href, serviceType: String(service.serviceType) }
  } catch {
    return null
  }
}

async function discoverDlnaDevices() {
  const locations = new Set()
  const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true })
  const search = Buffer.from([
    'M-SEARCH * HTTP/1.1',
    'HOST: 239.255.255.250:1900',
    'MAN: "ssdp:discover"',
    'MX: 2',
    'ST: urn:schemas-upnp-org:device:MediaRenderer:1',
    '',
    '',
  ].join('\r\n'))

  const responses = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.close()
      resolve([...locations])
    }, 3000)
    socket.on('error', (error) => {
      clearTimeout(timer)
      try { socket.close() } catch {}
      reject(error)
    })
    socket.on('message', (message) => {
      const location = message.toString('latin1').match(/^LOCATION:\s*(\S+)/im)?.[1]
      if (location) locations.add(location)
    })
    socket.bind(0, '0.0.0.0', () => {
      try {
        socket.addMembership('239.255.255.250')
        socket.send(search, 1900, '239.255.255.250')
      } catch (error) {
        clearTimeout(timer)
        socket.close()
        reject(error)
      }
    })
  })

  const devices = (await Promise.all(responses.map(readDlnaDevice))).filter(Boolean)
  dlnaDevices.clear()
  devices.forEach((device) => dlnaDevices.set(device.id, device))
  return devices.map(({ id, name }) => ({ id, name }))
}

function escapeXml(value) {
  return value.replace(/[<>&'\"]/g, (character) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[character])
}

async function invokeDlna(device, action, argumentsXml) {
  const body = `<?xml version="1.0" encoding="utf-8"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body><u:${action} xmlns:u="${device.serviceType}">${argumentsXml}</u:${action}></s:Body></s:Envelope>`
  const response = await fetch(device.controlUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'text/xml; charset="utf-8"', SOAPAction: `"${device.serviceType}#${action}"` },
    body,
    signal: AbortSignal.timeout(7000),
  })
  if (!response.ok) throw new Error(`DLNA 设备返回 HTTP ${response.status}`)
}

ipcMain.handle('dlna:discover', async () => {
  return discoverDlnaDevices()
})

ipcMain.handle('dlna:play', async (_event, { id, url, title }) => {
  if (!/^https?:\/\//i.test(url)) throw new Error('DLNA 只能播放设备可访问的 HTTP 媒体地址。')
  const device = dlnaDevices.get(id)
  if (!device) throw new Error('投屏设备已离线，请重新搜索。')
  const mimeType = /\.m3u8(?:$|[?#])/i.test(url) ? 'application/vnd.apple.mpegurl' : 'video/mp4'
  const metadata = dlnaBuilder.build({
    'DIDL-Lite': {
      '@_xmlns': 'urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/',
      '@_xmlns:dc': 'http://purl.org/dc/elements/1.1/',
      '@_xmlns:upnp': 'urn:schemas-upnp-org:metadata-1-0/upnp/',
      item: {
        '@_id': '0', '@_parentID': '0', '@_restricted': '1',
        'dc:title': String(title).slice(0, 200),
        'upnp:class': 'object.item.videoItem',
        res: { '@_protocolInfo': `http-get:*:${mimeType}:*`, '#text': url },
      },
    },
  })
  await invokeDlna(device, 'SetAVTransportURI', `<InstanceID>0</InstanceID><CurrentURI>${escapeXml(url)}</CurrentURI><CurrentURIMetaData>${escapeXml(metadata)}</CurrentURIMetaData>`)
  await invokeDlna(device, 'Play', '<InstanceID>0</InstanceID><Speed>1</Speed>')
})

function createWindow() {
  const window = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 360,
    minHeight: 560,
    backgroundColor: '#f8f8f2',
    title: '以来影视',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://') || url.startsWith('http://')) {
      void shell.openExternal(url)
    }
    return { action: 'deny' }
  })

  if (!app.isPackaged) {
    void window.loadURL(process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173')
  } else {
    void window.loadFile(path.join(__dirname, '../dist/index.html'))
  }
}

app.whenReady().then(() => {
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})