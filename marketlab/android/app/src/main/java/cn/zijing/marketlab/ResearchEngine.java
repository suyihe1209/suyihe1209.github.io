package cn.zijing.marketlab;

import android.content.Context;
import android.content.SharedPreferences;
import java.io.IOException;
import java.util.*;
import org.json.*;
import static cn.zijing.marketlab.DataTools.*;

public final class ResearchEngine {
    private static SharedPreferences prefs(Context c){return c.getSharedPreferences("market.research.v1",Context.MODE_PRIVATE);}
    private static final Object REFRESH_LOCK=new Object(),ARTICLE_LOCK=new Object(),BUDGET_LOCK=new Object();
    public static JSONObject dashboard(Context c){
        try{
            String stored=prefs(c).getString("dashboard","");
            return stored.isEmpty()?LiveFeeds.empty():new JSONObject(stored);
        }catch(Exception e){
            try{return LiveFeeds.empty().put("warnings",arr("本机资料暂时无法读取，请联网刷新。"));}
            catch(JSONException ignored){return new JSONObject();}
        }
    }
    public static JSONObject refresh(Context c) throws Exception {
        synchronized(REFRESH_LOCK){
            long now=System.currentTimeMillis(); JSONObject state=LiveFeeds.refresh(dashboard(c),NetAccess.LIVE,now);
            if(!prefs(c).edit().putString("dashboard",state.toString()).commit())throw new IOException("无法在设备上保存本轮更新");
            return state;
        }
    }
    static int today(Context c,boolean question){
        synchronized(BUDGET_LOCK){
            SharedPreferences p=prefs(c);
            String day=fmt(System.currentTimeMillis(),"yyyy-MM-dd",TimeZone.getDefault().getID());
            return day.equals(p.getString("budgetDay",""))?p.getInt(question?"questions":"budgetUsed",0):0;
        }
    }
    static int count(Context c,boolean question){
        synchronized(BUDGET_LOCK){
            SharedPreferences p=prefs(c);
            String day=fmt(System.currentTimeMillis(),"yyyy-MM-dd",TimeZone.getDefault().getID());
            boolean same=day.equals(p.getString("budgetDay",""));
            int questions=(same?p.getInt("questions",0):0)+(question?1:0);
            int calls=(same?p.getInt("budgetUsed",0):0)+(question?0:1);
            p.edit().putString("budgetDay",day).putInt("questions",questions).putInt("budgetUsed",calls).apply();
            return question?questions:calls;
        }
    }
    private static String threadKey(MarketConfig config)throws Exception{
        return "chat."+DataTools.id(config.providerId+"|"+config.baseUrl);
    }
    static JSONArray history(Context c,MarketConfig config)throws Exception{
        return new JSONArray(prefs(c).getString(threadKey(config),"[]"));
    }
    static JSONArray context(JSONArray history)throws JSONException{
        int start=history.length(), chars=0;
        while(start>0 && history.length()-start<12){
            JSONObject t=history.getJSONObject(start-1);
            int size=t.getString("question").length()+t.getString("answer").length();
            if(chars+size>24000)break;
            start--;chars+=size;
        }
        JSONArray out=arr();for(int i=start;i<history.length();i++)out.put(history.get(i));return out;
    }
    static String read(Context c,JSONObject n) throws Exception {
        String key="article."+n.getString("id"),url=n.getString("url"); SharedPreferences pref=prefs(c);
        if(!LiveFeeds.allowedArticle(n.getString("region"),url))throw new IOException("原文地址未收录");
        String cache=pref.getString(key,"");long now=System.currentTimeMillis();
        JSONObject prior=cache.isEmpty()?new JSONObject():new JSONObject(cache);
        if(!url.equals(prior.optString("url")))prior=new JSONObject();
        if(prior.optLong("when",0)>now-6*3600000L)return prior.getString("body");
        String actual;
        try{actual=LiveFeeds.article(n,NetAccess.LIVE);}
        catch(Exception failure){if(prior.has("body"))return "原文缓存，读取于 "+instant(prior.getLong("when"))+"。"+prior.getString("body");throw new IOException("暂时未能读取该公告正文");}
        synchronized(ARTICLE_LOCK){
            JSONArray recent=new JSONArray(pref.getString("recentArticles","[]"));List<String> keys=new ArrayList<>();keys.add(key);
            for(int i=0;i<recent.length();i++)if(!key.equals(recent.getString(i)))keys.add(recent.getString(i));
            SharedPreferences.Editor edit=pref.edit();
            while(keys.size()>28)edit.remove(keys.remove(keys.size()-1));
            edit.putString(key,obj("when",now,"body",actual,"url",url).toString()).putString("recentArticles",new JSONArray(keys).toString()).apply();
        }
        return actual;
    }
    private static JSONObject marketData(Context c)throws Exception{
        JSONObject state=dashboard(c);
        if(state.optString("updatedAt").compareTo(instant(System.currentTimeMillis()-3*3600000L))<0)return refresh(c);
        return state;
    }
    public static JSONObject ask(Context c,String question,MarketConfig config,boolean interactive)throws Exception{
        if(config==null||!config.ready())throw new IOException("请先配置模型服务与密钥。");
        JSONArray saved=interactive?history(c,config):arr();
        JSONArray previous=context(saved);
        ToolResearch.Mode mode=interactive?ToolResearch.mode(question,previous):ToolResearch.Mode.RESEARCH;
        if(interactive)count(c,true);
        JSONObject answer=ToolResearch.run(question,config.providerId,config.baseUrl,config.key,config.model,mode,previous,
                ()->marketData(c),NetAccess.LIVE,n->read(c,n),()->count(c,false),System.currentTimeMillis());
        if(interactive){
            answer.put("question",question);
            JSONArray updated=arr();
            for(int i=Math.max(0,saved.length()-39);i<saved.length();i++)updated.put(saved.get(i));
            updated.put(answer);
            prefs(c).edit().putString(threadKey(config),updated.toString()).apply();
        }
        return answer;
    }
    private ResearchEngine(){}
}
