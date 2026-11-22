package com.minicode.editor;

import android.annotation.SuppressLint;
import android.content.ClipData;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.view.Window;
import android.view.View;
import android.os.Build;
import android.webkit.JavascriptInterface;
import android.webkit.MimeTypeMap;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.ValueCallback;
import android.webkit.WebViewClient;
import android.widget.Toast;
import android.app.Activity;

import java.io.BufferedReader;
import java.io.ByteArrayOutputStream;
import java.util.concurrent.ConcurrentHashMap;
import java.io.ByteArrayInputStream;
import java.io.InputStreamReader;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import org.json.JSONObject;

public class MainActivity extends Activity {

    private static final String HOST = "minicode.local";
    private static final String START_URL = "https://" + HOST + "/index.html";

    private WebView web;
    private long lastBackPress = 0L;
    private ValueCallback<Uri[]> filePicker;
    private static final int REQ_PICK = 1001;
    private static final int REQ_SAVE = 1002;
    private File pendingExport;
    private final ConcurrentHashMap<String, ModelRequest> modelRequests = new ConcurrentHashMap<>();

    private static final class ModelRequest {
        volatile boolean cancelled;
        volatile HttpURLConnection connection;

        void cancel() {
            cancelled = true;
            final HttpURLConnection open = connection;
            if (open != null) new Thread(open::disconnect).start();
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        if (savedInstanceState != null) {
            String pendingName = savedInstanceState.getString("pendingExport");
            if (pendingName != null && pendingName.matches("export-[0-9]+[.]tmp")) {
                pendingExport = new File(getCacheDir(), pendingName);
            }
        }

        Window win = getWindow();
        win.setStatusBarColor(0xFF292929);
        win.setNavigationBarColor(0xFF1E1E1E);

        web = new WebView(this);
        web.setBackgroundColor(0xFF1E1E1E);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(true);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);
        s.setTextZoom(100);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        s.setMediaPlaybackRequiresUserGesture(true);

        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri u = request.getUrl();
                if (u != null && "https".equals(u.getScheme()) && HOST.equals(u.getHost())) {
                    String path = u.getPath();
                    if (path == null || path.equals("/")) path = "/index.html";
                    try {
                        InputStream in = getAssets().open("www" + path);
                        return new WebResourceResponse(mimeOf(path), "UTF-8", in);
                    } catch (IOException e) {
                        return new WebResourceResponse("text/plain", "UTF-8",
                                new ByteArrayInputStream("404".getBytes(StandardCharsets.UTF_8)));
                    }
                }
                return null;
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request == null || !request.isForMainFrame()) return;
                // 兜底：拦截失败时直接把 HTML 塞进 WebView
                view.loadDataWithBaseURL("https://" + HOST + "/", readAssetText(), "text/html", "UTF-8", null);
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri u = request.getUrl();
                if (u == null || !request.isForMainFrame()) return true;
                if ("https".equals(u.getScheme()) && HOST.equals(u.getHost())
                        && ("/index.html".equals(u.getPath()) || "/".equals(u.getPath()))) return false;
                if (request.hasGesture() && ("https".equals(u.getScheme()) || "http".equals(u.getScheme()))) {
                    try { startActivity(new Intent(Intent.ACTION_VIEW, u)); }
                    catch (android.content.ActivityNotFoundException ignored) { }
                }
                return true;
            }
        });

        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> cb,
                                             FileChooserParams params) {
                if (filePicker != null) {
                    filePicker.onReceiveValue(null);
                    filePicker = null;
                }
                filePicker = cb;
                Intent pick = new Intent(Intent.ACTION_GET_CONTENT);
                pick.addCategory(Intent.CATEGORY_OPENABLE);
                pick.setType("*/*");
                pick.putExtra(Intent.EXTRA_ALLOW_MULTIPLE,
                        params.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE);
                try {
                    startActivityForResult(Intent.createChooser(pick, "选择文件"), REQ_PICK);
                    return true;
                } catch (Exception e) {
                    filePicker = null;
                    return false;
                }
            }
        });
        web.addJavascriptInterface(new Bridge(), "AndroidBridge");
        setContentView(web);

        web.loadUrl(START_URL);
    }

    private String readAssetText() {
        try {
            return readAll(getAssets().open("www/index.html"));
        } catch (IOException e) {
            return "<html><body style='background:#1e1e1e;color:#ddd;font-family:sans-serif'>"
                    + "<p style='padding:24px'>页面加载失败：" + e.getMessage() + "</p></body></html>";
        }
    }

    private static String mimeOf(String path) {
        String p = path.toLowerCase();
        if (p.endsWith(".html") || p.endsWith(".htm")) return "text/html";
        if (p.endsWith(".css")) return "text/css";
        if (p.endsWith(".js")) return "application/javascript";
        if (p.endsWith(".json")) return "application/json";
        if (p.endsWith(".png")) return "image/png";
        if (p.endsWith(".jpg") || p.endsWith(".jpeg")) return "image/jpeg";
        if (p.endsWith(".svg")) return "image/svg+xml";
        if (p.endsWith(".woff2")) return "font/woff2";
        return "text/plain";
    }

    private static String readAll(InputStream in) throws IOException {
        if (in == null) return "";
        BufferedReader br = new BufferedReader(new InputStreamReader(in, StandardCharsets.UTF_8));
        StringBuilder sb = new StringBuilder();
        String line;
        while ((line = br.readLine()) != null) sb.append(line).append('\n');
        br.close();
        return sb.toString();
    }

    private static String readModelResponse(InputStream source) throws IOException {
        if (source == null) return "";
        try (InputStream in = source; ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            byte[] chunk = new byte[8192];
            int length;
            while ((length = in.read(chunk)) != -1) {
                if (out.size() + length > 256 * 1024) throw new IOException("模型回复过长，请缩小测试范围");
                out.write(chunk, 0, length);
            }
            return out.toString("UTF-8");
        }
    }

    /** 后台线程发 HTTPS POST，回来把结果丢给页面里的 window.__aiDone(id, status, text) */
    private void doAiPost(final String id, final String url, final String apiKey, final String body) {
        if (id == null || id.isEmpty()) return;
        final ModelRequest request = new ModelRequest();
        if (modelRequests.putIfAbsent(id, request) != null) return;
        new Thread(new Runnable() {
            @Override public void run() {
                int status = 0;
                String text;
                HttpURLConnection conn = null;
                try {
                    URL endpoint = new URL(url);
                    if (!"https".equalsIgnoreCase(endpoint.getProtocol()) || endpoint.getUserInfo() != null) {
                        throw new IOException("请填写 HTTPS 模型服务地址");
                    }
                    conn = (HttpURLConnection) endpoint.openConnection();
                    request.connection = conn;
                    if (request.cancelled) return;
                    conn.setInstanceFollowRedirects(false);
                    conn.setRequestMethod("POST");
                    conn.setConnectTimeout(15000);
                    conn.setReadTimeout(id.startsWith("minicode-sim-") ? 120000 : 55000);
                    conn.setDoOutput(true);
                    conn.setRequestProperty("Content-Type", "application/json; charset=utf-8");
                    conn.setRequestProperty("Accept", "application/json");
                    if (apiKey != null && apiKey.length() > 0) {
                        conn.setRequestProperty("Authorization", "Bearer " + apiKey);
                    }
                    OutputStream os = conn.getOutputStream();
                    os.write(body.getBytes(StandardCharsets.UTF_8));
                    os.flush();
                    os.close();
                    status = conn.getResponseCode();
                    InputStream in = (status >= 200 && status < 300)
                            ? conn.getInputStream() : conn.getErrorStream();
                    text = readModelResponse(in);
                } catch (Exception e) {
                    String message = e.getMessage();
                    text = "{\"error\":{\"message\":" + JSONObject.quote(message == null ? "网络异常" : message) + "}}";
                    status = -1;
                } finally {
                    modelRequests.remove(id, request);
                    if (conn != null) conn.disconnect();
                }
                final int st = status;
                final String out = text;
                runOnUiThread(new Runnable() {
                    @Override public void run() {
                        if (request.cancelled || isFinishing() || isDestroyed()) return;
                        web.evaluateJavascript("window.__aiDone(" + JSONObject.quote(id) + ","
                                + st + "," + JSONObject.quote(out) + ")", null);
                    }
                });
            }
        }).start();
    }

    /** 暴露给页面 JS 的原生能力 */
    private class Bridge {
        @JavascriptInterface
        public void aiComplete(String id, String url, String apiKey, String body) {
            doAiPost(id, url, apiKey, body);
        }

        @JavascriptInterface
        public void cancelAI(String id) {
            if (id == null) return;
            ModelRequest request = modelRequests.get(id);
            if (request != null) request.cancel();
        }

        @JavascriptInterface
        public void saveFile(String name, String content) {
            final String filename = name == null || name.trim().isEmpty() ? "code.txt"
                    : name.replace('/', '_').replace('\\', '_');
            File staging = null;
            try {
                staging = File.createTempFile("export-", ".tmp", getCacheDir());
                try (OutputStream out = new FileOutputStream(staging)) {
                    out.write(content.getBytes(StandardCharsets.UTF_8));
                }
                final File ready = staging;
                runOnUiThread(() -> startExport(filename, ready));
            } catch (Exception error) {
                if (staging != null) staging.delete();
                toast("导出失败，无法准备文件");
            }
        }

        @JavascriptInterface
        public void toast(String text) {
            final String t = text;
            runOnUiThread(new Runnable() {
                @Override public void run() {
                    Toast.makeText(MainActivity.this, t, Toast.LENGTH_SHORT).show();
                }
            });
        }

        @JavascriptInterface
        public void applySystemTheme(boolean light) {
            runOnUiThread(() -> {
                if (isDestroyed() || isFinishing()) return;
                Window win = getWindow();
                boolean lightNav = light && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O;
                win.setStatusBarColor(light ? 0xFFF3F3F3 : 0xFF292929);
                win.setNavigationBarColor(lightNav ? 0xFFF3F3F3 : 0xFF1E1E1E);
                int flags = win.getDecorView().getSystemUiVisibility();
                flags = light ? flags | View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR : flags & ~View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    flags = lightNav ? flags | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR : flags & ~View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
                }
                win.getDecorView().setSystemUiVisibility(flags);
            });
        }

        @JavascriptInterface
        public boolean isNative() {
            return true;
        }
    }

    private void startExport(String name, File ready) {
        if (isFinishing() || isDestroyed() || pendingExport != null) {
            ready.delete();
            if (!isFinishing() && !isDestroyed()) {
                Toast.makeText(this, "请先完成上一次导出", Toast.LENGTH_SHORT).show();
            }
            return;
        }
        pendingExport = ready;
        Intent create = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        create.addCategory(Intent.CATEGORY_OPENABLE);
        int dot = name.lastIndexOf('.');
        String extension = dot < 0 ? "" : name.substring(dot + 1).toLowerCase(java.util.Locale.ROOT);
        String mime = MimeTypeMap.getSingleton().getMimeTypeFromExtension(extension);
        create.setType(mime == null ? "application/octet-stream" : mime);
        create.putExtra(Intent.EXTRA_TITLE, name);
        try {
            startActivityForResult(create, REQ_SAVE);
        } catch (android.content.ActivityNotFoundException e) {
            ready.delete();
            pendingExport = null;
            Toast.makeText(this, "系统文件选择器不可用", Toast.LENGTH_LONG).show();
        }
    }

    private void finishExport(File source, Uri destination) {
        new Thread(() -> {
            String message;
            try (InputStream in = new FileInputStream(source);
                 OutputStream out = getContentResolver().openOutputStream(destination, "wt")) {
                if (out == null) throw new IOException("文件无法写入");
                byte[] buffer = new byte[8192];
                int count;
                while ((count = in.read(buffer)) != -1) out.write(buffer, 0, count);
                message = "已导出文件";
            } catch (IOException | SecurityException error) {
                message = "导出失败，请检查所选位置的写入权限和剩余空间";
            } finally {
                source.delete();
            }
            final String result = message;
            runOnUiThread(() -> Toast.makeText(getApplicationContext(), result, Toast.LENGTH_LONG).show());
        }).start();
    }

    @Override
    protected void onSaveInstanceState(Bundle state) {
        super.onSaveInstanceState(state);
        if (pendingExport != null) state.putString("pendingExport", pendingExport.getName());
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == REQ_SAVE) {
            File source = pendingExport;
            pendingExport = null;
            Uri target = data == null ? null : data.getData();
            if (resultCode == RESULT_OK && target != null && source != null) finishExport(source, target);
            else if (source != null) source.delete();
            return;
        }
        if (requestCode == REQ_PICK) {
            if (filePicker != null) {
                ClipData selected = resultCode == RESULT_OK && data != null ? data.getClipData() : null;
                if (selected == null) {
                    filePicker.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode, data));
                } else {
                    Uri[] items = new Uri[selected.getItemCount()];
                    for (int i = 0; i < items.length; i++) items[i] = selected.getItemAt(i).getUri();
                    filePicker.onReceiveValue(items);
                }
                filePicker = null;
            }
            return;
        }
        super.onActivityResult(requestCode, resultCode, data);
    }

    @Override
    public void onBackPressed() {
        if (web == null) { super.onBackPressed(); return; }
        // 先问页面：浮层/侧栏/查找面板是否已经处理了这次返回
        web.evaluateJavascript(
                "(function(){try{return !!(window.__back && window.__back());}"
                        + "catch(e){return false;}})()",
                new ValueCallback<String>() {
                    @Override
                    public void onReceiveValue(String value) {
                        // WebView 以 JSON 回传结果：布尔是 true/false，
                        // 个别实现会额外带引号，这里一并兼容，避免
                        // 「页面已经关了浮层，却又弹出再按一次退出」。
                        boolean handled = value != null
                                && "true".equals(value.replace("\"", "").trim());
                        if (handled) return;
                        exitWithConfirm();
                    }
                });
    }

    private void exitWithConfirm() {
        long now = System.currentTimeMillis();
        if (now - lastBackPress < 2000L) {
            finish();
        } else {
            lastBackPress = now;
            Toast.makeText(this, "再按一次退出", Toast.LENGTH_SHORT).show();
        }
    }

    @Override
    protected void onDestroy() {
        for (ModelRequest request : modelRequests.values()) request.cancel();
        if (web != null) {
            web.removeJavascriptInterface("AndroidBridge");
            web.destroy();
        }
        super.onDestroy();
    }
}
