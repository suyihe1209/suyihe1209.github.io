package cn.zijing.marketlab;
import org.json.*;
import java.text.*;
import java.util.*;
import java.security.MessageDigest;
import java.nio.charset.StandardCharsets;

final class DataTools {
    static JSONObject obj(Object... pairs) throws JSONException {
        JSONObject out=new JSONObject();
        for(int i=0;i<pairs.length;i+=2)out.put((String)pairs[i],pairs[i+1]);
        return out;
    }
    static JSONArray arr(Object... values){JSONArray a=new JSONArray();for(Object v:values)a.put(v);return a;}
    static JSONArray items(JSONObject o,String name){JSONArray a=o.optJSONArray(name);return a==null?new JSONArray():a;}
    static List<JSONObject> list(JSONArray arr){
        List<JSONObject> list=new ArrayList<>();for(int i=0;i<arr.length();i++){JSONObject v=arr.optJSONObject(i);if(v!=null)list.add(v);}return list;
    }
    static String fmt(long time,String pattern,String zone){
        SimpleDateFormat f=new SimpleDateFormat(pattern,Locale.US); f.setTimeZone(TimeZone.getTimeZone(zone)); return f.format(new Date(time));
    }
    static String instant(long time){return fmt(time,"yyyy-MM-dd'T'HH:mm:ss'Z'","UTC");}
    static String day(long time){return fmt(time,"yyyy-MM-dd","UTC");}
    static final long DAY=86400000L;
    static boolean date(String value){
        if(!value.matches("\\d{4}-\\d{2}-\\d{2}"))return false;
        SimpleDateFormat f=new SimpleDateFormat("yyyy-MM-dd",Locale.US);f.setLenient(false);
        try{f.parse(value);return true;}catch(ParseException invalid){return false;}
    }
    static String id(String url) throws Exception{
        byte[] d=MessageDigest.getInstance("SHA-256").digest(url.getBytes(StandardCharsets.UTF_8));
        StringBuilder s=new StringBuilder();for(int i=0;i<12;i++)s.append(String.format(Locale.ROOT,"%02x",d[i]));return s.toString();
    }
    static String cutoff(long now,String zone,int close){
        Calendar c=Calendar.getInstance(TimeZone.getTimeZone(zone));c.setTimeInMillis(now);
        if(c.get(Calendar.HOUR_OF_DAY)*100+c.get(Calendar.MINUTE)<close)c.add(Calendar.DATE,-1);
        return fmt(c.getTimeInMillis(),"yyyy-MM-dd",zone);
    }
    static String text(String html){
        return html.replaceAll("(?is)<(?:script|style)\\b[^>]*>.*?</(?:script|style)>"," ").replaceAll("(?s)<!--.*?-->"," ")
            .replaceAll("(?i)</(?:p|div|li|h[1-6])>"," ").replaceAll("<[^>]+>","").replace("&nbsp;"," ").replace("&#160;"," ")
            .replace("&quot;","\"").replace("&#39;","'").replace("&lt;","<").replace("&gt;",">").replace("&amp;","&").replaceAll("\\s+"," ").trim();
    }
    static String limit(String s,int len){return s.length()<=len?s:s.substring(0,len);}
    private DataTools(){}
}
