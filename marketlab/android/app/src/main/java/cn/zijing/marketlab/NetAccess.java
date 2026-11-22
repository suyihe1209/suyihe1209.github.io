package cn.zijing.marketlab;

import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import javax.net.ssl.HttpsURLConnection;
import org.json.JSONObject;

final class NetAccess {
    interface Transport { String get(String url) throws Exception; String model(String endpoint,Map<String,String> headers,String body) throws Exception; }
    static final Set<String> FEEDS = new HashSet<>(Arrays.asList("www.csindex.com.cn","web.ifzq.gtimg.cn","www.stats.gov.cn","www.ndrc.gov.cn","www.federalreserve.gov","fred.stlouisfed.org"));
    static void publicTarget(URL endpoint) throws IOException {
        String host=endpoint.getHost().toLowerCase(Locale.ROOT);
        if (!"https".equals(endpoint.getProtocol()) || endpoint.getUserInfo()!=null || endpoint.getRef()!=null || host.isEmpty() || host.endsWith(".local") || host.endsWith(".localhost"))
            throw new IOException("仅支持公网 HTTPS 地址");
        for (InetAddress address : InetAddress.getAllByName(host)) {
            byte[] b=address.getAddress(); int x=b[0]&255,y=b[1]&255;
            boolean reserved=b.length==4 ? x==0 || x==127 || x>=224 || x==100 && y>=64 && y<=127 || x==192 && y==0 || x==198 && (y==18 || y==19)
                : (x&0xe0)!=0x20 || (x==0x20 && y==0x02) || (x==0x20 && y==0x01 && b[2]==0 && b[3]==0);
            if(reserved || address.isAnyLocalAddress() || address.isLoopbackAddress() || address.isLinkLocalAddress() || address.isSiteLocalAddress() || address.isMulticastAddress())
                throw new IOException("该地址不是可用的公网服务");
        }
    }
    static final Transport LIVE=new Transport(){
        public String get(String resource) throws Exception {
            URL url=new URL(resource);
            if (!FEEDS.contains(url.getHost().toLowerCase(Locale.ROOT))) throw new IOException("来源未收录");
            return request(url,null,null);
        }
        public String model(String endpoint,Map<String,String> headers,String body) throws Exception {
            return request(new URL(endpoint),headers,body);
        }
    };
    static String request(URL url,Map<String,String> headers,String body) throws Exception {
        publicTarget(url);
        HttpsURLConnection connection=(HttpsURLConnection)url.openConnection();
        try {
            connection.setInstanceFollowRedirects(false);
            connection.setConnectTimeout(8500); connection.setReadTimeout(body==null?12000:45000);
            if(headers!=null){
                connection.setRequestProperty("User-Agent","MarketLab/1.1");
                connection.setRequestProperty("Accept","application/json");
                for(Map.Entry<String,String> header:headers.entrySet())connection.setRequestProperty(header.getKey(),header.getValue());
            }
            if(body!=null){
                connection.setRequestMethod("POST"); connection.setDoOutput(true);
                connection.setRequestProperty("Content-Type","application/json; charset=utf-8");
                byte[] bytes=body.getBytes(StandardCharsets.UTF_8);
                connection.setFixedLengthStreamingMode(bytes.length);
                try(OutputStream stream=connection.getOutputStream()){stream.write(bytes);}
            }
            int status=connection.getResponseCode();
            if(status<200 || status>=300){
                if(headers==null)throw new IOException("数据来源返回 HTTP "+status);
                String content="";
                try(InputStream errors=connection.getErrorStream()){
                    if(errors!=null){byte[] sample=new byte[4096];int length=errors.read(sample);
                        if(length>0)content=new String(sample,0,length,StandardCharsets.UTF_8);}
                }catch(IOException ignored){}
                throw modelError(status,content,body==null);
            }
            try(InputStream stream=connection.getInputStream(); ByteArrayOutputStream bytes=new ByteArrayOutputStream()){
                byte[] buffer=new byte[8192]; int n;
                int limit=body==null?4000000:1000000;
                while((n=stream.read(buffer))!=-1){ if(bytes.size()+n>limit) throw new IOException("回应内容过大"); bytes.write(buffer,0,n); }
                return bytes.toString("UTF-8").replaceFirst("^\uFEFF","");
            }
        } finally {connection.disconnect();}
    }
    static IOException modelError(int status,String raw,boolean listing){
        // Inspect only for classification. Never echo server text, which may contain credentials or user input.
        String hint="";
        try{
            JSONObject reply=new JSONObject(raw);JSONObject e=reply.optJSONObject("error");
            if(e!=null)hint=(e.optString("code")+" "+e.optString("type")+" "+e.optString("message")).toLowerCase(Locale.ROOT);
        }catch(Exception ignored){}
        String advice;
        if(status==401)advice="请检查当前服务的 API Key。";
        else if(status==403)advice="请检查账号权限、服务地区及模型访问授权。";
        else if(status==404 && !listing && (hint.contains("model")||hint.contains("deployment")||hint.contains("endpointnotfound")||hint.contains("模型")||hint.contains("接入点")))
            advice="当前模型或接入点不存在，或账号未获授权。请重新获取模型列表或复制控制台中的模型 ID。";
        else if(status==404)advice=listing?"此地址未提供模型列表。请检查接口地址，或从服务控制台手动填写模型 ID。":"请核对设置中显示的实际接口地址、版本路径和模型 ID。";
        else if(status==429)advice="服务限流或账户额度不足，请稍后重试并查看服务商额度。";
        else if(status==402)advice="服务账户额度不足，请核对服务商账户状态。";
        else if(status==400||status==422)advice="模型未接受当前协议或工具参数，请选择支持工具调用的对话模型。";
        else if(status>=500)advice="服务端暂时不能处理请求，请稍后再试。";
        else if(status>=300&&status<400)advice="接口发生跳转，密钥未跟随跳转。请填写服务的最终 HTTPS 地址。";
        else advice="请核对所选服务与控制台配置。";
        return new IOException("模型服务 HTTP "+status+"。"+advice);
    }
    private NetAccess(){}
}
