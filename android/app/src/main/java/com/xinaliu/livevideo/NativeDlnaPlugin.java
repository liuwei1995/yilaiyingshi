package com.xinaliu.livevideo;

import android.net.Uri;
import android.content.Context;
import android.net.wifi.WifiManager;
import android.util.Xml;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.HttpURLConnection;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.MulticastSocket;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import org.xmlpull.v1.XmlPullParser;

@CapacitorPlugin(name = "NativeDlna")
public class NativeDlnaPlugin extends Plugin {

    private static final String SSDP_HOST = "239.255.255.250";
    private final Map<String, Renderer> renderers = new ConcurrentHashMap<>();

    @PluginMethod
    public void discover(PluginCall call) {
        new Thread(() -> {
            WifiManager wifiManager = (WifiManager) getContext().getApplicationContext().getSystemService(Context.WIFI_SERVICE);
            WifiManager.MulticastLock multicastLock = wifiManager == null ? null : wifiManager.createMulticastLock("yilai-dlna-discovery");
            try (MulticastSocket socket = new MulticastSocket(null)) {
                if (multicastLock != null) {
                    multicastLock.setReferenceCounted(false);
                    multicastLock.acquire();
                }
                socket.setReuseAddress(true);
                socket.bind(new InetSocketAddress(0));
                socket.setSoTimeout(300);

                String request = "M-SEARCH * HTTP/1.1\r\n" +
                    "HOST: " + SSDP_HOST + ":1900\r\n" +
                    "MAN: \"ssdp:discover\"\r\n" +
                    "MX: 2\r\n" +
                    "ST: urn:schemas-upnp-org:device:MediaRenderer:1\r\n\r\n";
                byte[] bytes = request.getBytes(StandardCharsets.US_ASCII);
                socket.send(new DatagramPacket(bytes, bytes.length, InetAddress.getByName(SSDP_HOST), 1900));

                long deadline = System.currentTimeMillis() + 2800;
                Map<String, Renderer> found = new ConcurrentHashMap<>();
                while (System.currentTimeMillis() < deadline) {
                    byte[] buffer = new byte[8192];
                    DatagramPacket packet = new DatagramPacket(buffer, buffer.length);
                    try {
                        socket.receive(packet);
                        String location = findLocation(new String(packet.getData(), 0, packet.getLength(), StandardCharsets.ISO_8859_1));
                        Renderer renderer = readRenderer(location);
                        if (renderer != null) found.put(renderer.id, renderer);
                    } catch (java.net.SocketTimeoutException ignored) {
                    }
                }

                renderers.clear();
                renderers.putAll(found);
                JSArray devices = new JSArray();
                for (Renderer renderer : found.values()) {
                    devices.put(new JSObject().put("id", renderer.id).put("name", renderer.name));
                }
                call.resolve(new JSObject().put("devices", devices));
            } catch (Exception error) {
                call.reject("DLNA 设备搜索失败：" + error.getMessage(), error);
            } finally {
                if (multicastLock != null && multicastLock.isHeld()) multicastLock.release();
            }
        }).start();
    }

    @PluginMethod
    public void play(PluginCall call) {
        String id = call.getString("id");
        String mediaUrl = call.getString("url");
        String title = call.getString("title", "以来影视");
        Renderer renderer = id == null ? null : renderers.get(id);
        if (renderer == null) {
            call.reject("投屏设备已离线，请重新搜索。");
            return;
        }
        Uri parsed = mediaUrl == null ? null : Uri.parse(mediaUrl);
        if (parsed == null || !("http".equals(parsed.getScheme()) || "https".equals(parsed.getScheme()))) {
            call.reject("DLNA 只能播放 HTTP 或 HTTPS 媒体地址。");
            return;
        }

        new Thread(() -> {
            try {
                String mime = mediaUrl.matches("(?i).*\\.m3u8(?:$|[?#]).*")
                    ? "application/vnd.apple.mpegurl"
                    : "video/mp4";
                String didl = "<DIDL-Lite xmlns=\"urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/\" " +
                    "xmlns:dc=\"http://purl.org/dc/elements/1.1/\" " +
                    "xmlns:upnp=\"urn:schemas-upnp-org:metadata-1-0/upnp/\">" +
                    "<item id=\"0\" parentID=\"0\" restricted=\"1\"><dc:title>" + xml(title) +
                    "</dc:title><upnp:class>object.item.videoItem</upnp:class><res protocolInfo=\"http-get:*:" +
                    mime + ":*\">" + xml(mediaUrl) + "</res></item></DIDL-Lite>";
                soap(renderer, "SetAVTransportURI", "<InstanceID>0</InstanceID><CurrentURI>" +
                    xml(mediaUrl) + "</CurrentURI><CurrentURIMetaData>" + xml(didl) + "</CurrentURIMetaData>");
                soap(renderer, "Play", "<InstanceID>0</InstanceID><Speed>1</Speed>");
                call.resolve();
            } catch (Exception error) {
                call.reject("DLNA 播放失败：" + error.getMessage(), error);
            }
        }).start();
    }

    private static String findLocation(String response) {
        for (String line : response.split("\\r?\\n")) {
            if (line.regionMatches(true, 0, "LOCATION:", 0, 9)) return line.substring(9).trim();
        }
        return null;
    }

    private static Renderer readRenderer(String location) {
        if (location == null) return null;
        HttpURLConnection connection = null;
        try {
            URL descriptionUrl = new URL(location);
            if (!"http".equals(descriptionUrl.getProtocol()) || !isPrivateHost(descriptionUrl.getHost())) return null;
            connection = (HttpURLConnection) descriptionUrl.openConnection();
            connection.setInstanceFollowRedirects(false);
            connection.setConnectTimeout(1200);
            connection.setReadTimeout(1200);
            connection.setRequestMethod("GET");
            if (connection.getResponseCode() != 200) return null;

            String name = null;
            String serviceType = null;
            String controlPath = null;
            boolean inService = false;
            XmlPullParser parser = Xml.newPullParser();
            parser.setFeature(XmlPullParser.FEATURE_PROCESS_NAMESPACES, false);
            try (InputStream input = connection.getInputStream()) {
                parser.setInput(input, StandardCharsets.UTF_8.name());
                int event = parser.getEventType();
                while (event != XmlPullParser.END_DOCUMENT) {
                    if (event == XmlPullParser.START_TAG) {
                        String tag = parser.getName();
                        if ("service".equals(tag)) {
                            inService = true;
                            serviceType = null;
                            controlPath = null;
                        } else if ("friendlyName".equals(tag) && name == null) {
                            name = parser.nextText();
                        } else if (inService && "serviceType".equals(tag)) {
                            serviceType = parser.nextText();
                        } else if (inService && "controlURL".equals(tag)) {
                            controlPath = parser.nextText();
                        }
                    } else if (event == XmlPullParser.END_TAG && "service".equals(parser.getName())) {
                        if (serviceType != null && serviceType.contains(":AVTransport:") && controlPath != null) {
                            URL controlUrl = new URL(descriptionUrl, controlPath);
                            if ("http".equals(controlUrl.getProtocol()) && controlUrl.getHost().equals(descriptionUrl.getHost()) && name != null) {
                                return new Renderer(location, name, controlUrl, serviceType);
                            }
                        }
                        inService = false;
                    }
                    event = parser.next();
                }
            }
        } catch (Exception ignored) {
        } finally {
            if (connection != null) connection.disconnect();
        }
        return null;
    }

    private static boolean isPrivateHost(String host) {
        try {
            InetAddress address = InetAddress.getByName(host);
            return address.isSiteLocalAddress() || address.isLinkLocalAddress();
        } catch (Exception ignored) {
            return false;
        }
    }

    private static String xml(String value) {
        return value.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
            .replace("\"", "&quot;").replace("'", "&apos;");
    }

    private static void soap(Renderer renderer, String action, String arguments) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) renderer.controlUrl.openConnection();
        connection.setRequestMethod("POST");
        connection.setConnectTimeout(5000);
        connection.setReadTimeout(5000);
        connection.setDoOutput(true);
        connection.setRequestProperty("Content-Type", "text/xml; charset=\"utf-8\"");
        connection.setRequestProperty("SOAPACTION", "\"" + renderer.serviceType + "#" + action + "\"");
        byte[] body = ("<?xml version=\"1.0\" encoding=\"utf-8\"?><s:Envelope xmlns:s=\"http://schemas.xmlsoap.org/soap/envelope/\" s:encodingStyle=\"http://schemas.xmlsoap.org/soap/encoding/\"><s:Body><u:" + action + " xmlns:u=\"" + renderer.serviceType + "\">" + arguments + "</u:" + action + "></s:Body></s:Envelope>").getBytes(StandardCharsets.UTF_8);
        try {
            connection.getOutputStream().write(body);
            int status = connection.getResponseCode();
            if (status < 200 || status >= 300) throw new IllegalStateException("设备返回 HTTP " + status);
        } finally {
            connection.disconnect();
        }
    }

    private static final class Renderer {
        final String id;
        final String name;
        final URL controlUrl;
        final String serviceType;

        Renderer(String id, String name, URL controlUrl, String serviceType) {
            this.id = id;
            this.name = name;
            this.controlUrl = controlUrl;
            this.serviceType = serviceType;
        }
    }
}