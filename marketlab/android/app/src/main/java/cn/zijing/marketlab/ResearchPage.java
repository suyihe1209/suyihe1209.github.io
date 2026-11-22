package cn.zijing.marketlab;

import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.*;
import android.webkit.*;
import org.json.*;
import java.io.*;
import java.util.Locale;
import java.util.Arrays;
import java.util.HashMap;

final class ResearchPage extends WebView {
    private static final String HOST="appassets.androidplatform.net", ROOT="https://"+HOST+"/site/";
    private final MainActivity activity;
    private final Context app;
    private volatile String deviceBars="window.ML_ANDROID=true;window.ML_LOCAL_MARKETS=[];window.ML_DEVICE_BARS=[];window.ML_DEVICE_NEWS=[];";
    private volatile String lastCache="";private boolean pendingUpdate;
    private static final String[] ALLOWED={"CSI:000300","SP:SPX","NASDAQ:IXIC"};
    ResearchPage(MainActivity a) {
        super(a);activity=a;app=a.getApplicationContext();
        setBackgroundColor(0xff201923);
        WebSettings s=getSettings();s.setJavaScriptEnabled(true);s.setDomStorageEnabled(true);
        s.setAllowFileAccess(false);s.setAllowContentAccess(false);s.setAllowFileAccessFromFileURLs(false);s.setAllowUniversalAccessFromFileURLs(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);s.setJavaScriptCanOpenWindowsAutomatically(false);
        addJavascriptInterface(new ExportOnly(),"MarketLabExport");
        setWebViewClient(new WebViewClient(){
            @Override public WebResourceResponse shouldInterceptRequest(WebView view,WebResourceRequest req){return resource(req);}
            @Override public boolean shouldOverrideUrlLoading(WebView view,WebResourceRequest req){
                Uri u=req.getUrl();if("https".equals(u.getScheme())&&HOST.equals(u.getHost()))return false;
                if(req.isForMainFrame()&&req.hasGesture())activity.openSource(u.toString());return true;
            }
        });
        setWebChromeClient(new WebChromeClient());
        cache();loadUrl(ROOT+"marketlab/index.html");
    }
    private class ExportOnly {
        @JavascriptInterface public void save(String name,String text){
            if(name==null||text==null||text.length()>4*1024*1024||!name.matches("MarketLab-[A-Za-z0-9_-]{1,90}\\.(json|html)"))return;
            activity.runOnUiThread(()->activity.export(name,text));
        }
    }
    void cache(){
        try{
            JSONObject dashboard=ResearchEngine.dashboard(app);String stamp=dashboard.optString("updatedAt");
            JSONArray list=dashboard.optJSONArray("markets"),out=new JSONArray();
            if(list!=null)for(int i=0;i<list.length();i++){
                JSONObject m=list.optJSONObject(i);if(m==null||!Arrays.asList(ALLOWED).contains(m.optString("id")))continue;
                JSONArray rows=m.optJSONArray("bars");if(rows==null||rows.length()==0)continue;
                JSONObject src=new JSONObject().put("name",m.optString("source")).put("url",m.optString("url")).put("asOf",m.optString("date")).put("updatedAt",m.optString("fetchedAt",stamp)).put("license","用户设备本机研究缓存");
                out.put(new JSONObject().put("id",m.getString("id")).put("rows",rows).put("source",src));
            }
            JSONArray news=new JSONArray(),items=dashboard.optJSONArray("news");
            if(items!=null)for(int i=0;i<items.length();i++){
                JSONObject n=items.optJSONObject(i);if(n==null)continue;
                String region=n.optString("region").toLowerCase(Locale.ROOT),published=n.optString("published");
                if(published.length()<10)continue;
                boolean dateOnly=published.length()==10;
                java.time.ZoneId zone=java.time.ZoneId.of("us".equals(region)?"America/New_York":"Asia/Shanghai");
                java.time.OffsetDateTime event;
                try{event=dateOnly?java.time.LocalDate.parse(published).atTime(23,59,59).atZone(zone).toOffsetDateTime():
                        java.time.OffsetDateTime.parse(published).atZoneSameInstant(zone).toOffsetDateTime();}catch(Exception badDate){continue;}
                news.put(new JSONObject().put("id",n.optString("id")).put("region",region).put("date",event.toLocalDate().toString())
                    .put("publishedAt",event.toString()).put("datePrecision",dateOnly?"day":"minute").put("title",n.optString("title"))
                    .put("summary",n.optString("summary",n.optString("title"))).put("source",n.optString("source")).put("sourceUrl",n.optString("url"))
                    .put("subject","官方公告").put("tone","未分类"));
            }
            deviceBars=("window.ML_ANDROID=true;window.ML_LOCAL_MARKETS=[];window.ML_DEVICE_BARS="+out+";window.ML_DEVICE_NEWS="+news+";")
                    .replace("\u2028","\\u2028").replace("\u2029","\\u2029");
            lastCache=stamp;
        }catch(Exception ignored){}
    }
    void checkUpdate(){
        try{pendingUpdate=!lastCache.equals(ResearchEngine.dashboard(app).optString("updatedAt"));}catch(Exception ignored){}
    }
    boolean hasUpdate(){return pendingUpdate;}
    void applyUpdate(){cache();pendingUpdate=false;reload();}
    private WebResourceResponse text(String mime,String value,int code){
        WebResourceResponse r=new WebResourceResponse(mime,"UTF-8",new ByteArrayInputStream(value.getBytes(java.nio.charset.StandardCharsets.UTF_8)));
        r.setStatusCodeAndReasonPhrase(code,code==200?"OK":"Not Found");return r;
    }
    private WebResourceResponse resource(WebResourceRequest req){
        Uri u=req.getUrl();String path=u.getPath();
        if(!"https".equals(u.getScheme())||!HOST.equals(u.getHost())||path==null||path.contains(".."))return text("text/plain","",404);
        if(path.equals("/api/marketlab/status"))return text("application/json","{\"configured\":false}",200);
        if(path.startsWith("/api/"))return text("application/json","{\"error\":\"安卓离线研究台提供本机练习，模型问答请打开 App 的助手页。值守盖时需要桌面服务。\"}",404);
        if(!path.startsWith("/site/"))return text("text/plain","",404);
        if(path.equals("/site/marketlab/markets/local.js")){
            WebResourceResponse response=text("application/javascript",deviceBars,200);
            HashMap<String,String> headers=new HashMap<>();headers.put("Cache-Control","no-store");response.setResponseHeaders(headers);return response;
        }
        try{
            InputStream in=app.getAssets().open(path.substring(1));
            String ext=path.substring(path.lastIndexOf('.')+1).toLowerCase(Locale.ROOT);
            String type=ext.equals("js")?"application/javascript":ext.equals("css")?"text/css":ext.equals("html")?"text/html":ext.equals("json")?"application/json":ext.equals("woff2")?"font/woff2":ext.equals("png")?"image/png":"text/plain";
            return new WebResourceResponse(type,type.startsWith("font")?null:"UTF-8",in);
        }catch(IOException e){return text("text/plain","这个资源未包含在离线研究台中。",404);}
    }
}
