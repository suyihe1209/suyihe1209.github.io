package cn.zijing.marketlab;

import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.io.*;
import java.util.*;
import org.json.*;
import static cn.zijing.marketlab.DataTools.*;

public final class DomainCheck {
    static void require(boolean ok,String why){if(!ok)throw new AssertionError(why);}
    static String read(Path p)throws Exception{return new String(Files.readAllBytes(p),StandardCharsets.UTF_8);}
    static JSONObject call(String id,String name,JSONObject args) throws Exception{
        return obj("id",id,"type","function","function",obj("name",name,"arguments",args.toString()));
    }
    static String message(JSONObject msg) throws Exception{return obj("choices",arr(obj("message",msg))).toString();}
    static class NoNetwork implements NetAccess.Transport {
        public String get(String url) throws Exception{throw new IOException("offline");}
        public String model(String url,Map<String,String> headers,String body) throws Exception{throw new AssertionError("unexpected external model request");}
    }
    static void model(JSONObject state) throws Exception{
        final String newsId=state.getJSONArray("news").getJSONObject(0).getString("id");
        final int[] calls={0},charged={0},articleReads={0};
        NetAccess.Transport mock=new NoNetwork(){
            @Override public String model(String url,Map<String,String> headers,String body) throws Exception {
                JSONObject params=new JSONObject(body);assert params.getJSONArray("tools").length()==3;
                JSONArray msgs=params.getJSONArray("messages");int i=calls[0]++;
                if(i==0){require("auto".equals(params.getString("tool_choice")),"portable tool choice");
                    return message(obj("role","assistant","tool_calls",arr(call("q1","market_bars",obj("id",LiveFeeds.IXIC,"days",3)),call("n1","find_announcements",obj("limit",1)))));}
                if(i==1){
                    require(msgs.length()==5,"parallel tool result pairing");
                    require(msgs.getJSONObject(3).getString("content").contains("\"S1\""),"quote evidence");
                    require(msgs.getJSONObject(4).getString("content").contains(newsId),"discovery whitelist");
                    return message(obj("role","assistant","tool_calls",arr(call("n2","read_announcement",obj("id",newsId)))));}
                require(msgs.getJSONObject(msgs.length()-1).getString("content").contains("\"S2\""),"article evidence");
                return message(obj("role","assistant","content",obj("answer","已查到指数日线 [S1] 和公告原文 [S2]。","citations",arr("S1","S2")).toString()));
            }
        };
        JSONObject result=ToolResearch.run("每日简报","custom","https://example.org/v1","dummy","test",ToolResearch.Mode.RESEARCH,arr(),()->state,mock,
                n->{articleReads[0]++;return "来自测试传输层的公告原文。";},()->++charged[0],System.currentTimeMillis());
        require(result.getJSONArray("sources").length()==2&&result.getInt("used")==3&&articleReads[0]==1,"grounded final");
        ToolResearch.Evidence e=new ToolResearch.Evidence();
        try{ToolResearch.execute("read_announcement",obj("id",newsId),state,e,n->{throw new AssertionError();});throw new AssertionError("unlisted read");}catch(IOException ok){}
        try{ToolResearch.run("问","custom","","","",ToolResearch.Mode.CHAT,arr(),()->state,new NoNetwork(),n->"",()->0,0);throw new AssertionError("missing key");}catch(IOException ok){}
        System.out.println("Research workflow passed with two verified sources and three model calls.");
    }
    static void catchup(long now) throws Exception{
        String reportDay=day(now-5*DAY),shortDate=reportDay.replace("-",""),month=shortDate.substring(0,6);
        String published="<li><a href='./"+month+"/t"+shortDate+"_9527.html'>回补验证公告</a><span>"+reportDay+"</span></li>";
        String oldDay=day(now-25*DAY),older=oldDay.replace("-","");
        String end="<li><a href='./"+older.substring(0,6)+"/t"+older+"_9528.html'>更早公告</a><span>"+oldDay+"</span></li>";
        JSONObject prior=LiveFeeds.empty().put("checks",obj("CN",instant(now-8*DAY)));
        JSONObject offline=LiveFeeds.refresh(prior,new NoNetwork(),now-DAY);
        require(offline.getJSONObject("checks").getString("CN").equals(instant(now-8*DAY)),"preserve failed source checkpoint");
        NetAccess.Transport source=new NoNetwork(){
            @Override public String get(String url) throws Exception{
                if(url.equals(LiveFeeds.CN_HOME))return "<ul>"+published+published+end+"</ul>";
                throw new IOException("other feeds offline");
            }
        };
        JSONObject restored=LiveFeeds.refresh(offline,source,now);
        require(restored.getJSONArray("news").length()==1,"resume catches missing five-day old story and deduplicates it");
        require(restored.getJSONArray("news").getJSONObject(0).getString("published").equals(reportDay),"use actual listed publication date");
        require(restored.getJSONObject("checks").getString("CN").equals(instant(now)),"record successful recovery per source");
        JSONObject repeat=LiveFeeds.refresh(restored,source,now);
        require(repeat.getJSONArray("news").length()==1,"repeat refresh does not append duplicates");
        System.out.println("Offline catch-up: kept last success, recovered a missing release, preserved date, deduplicated on repeat.");
    }
    public static void main(String[] args) throws Exception{
        if(args.length<2)throw new IllegalArgumentException("live or cached, then path to a private test snapshot");
        long now=System.currentTimeMillis();Path file=Paths.get(args[1]);JSONObject state;
        if("live".equals(args[0])){
            state=LiveFeeds.refresh(LiveFeeds.empty(),NetAccess.LIVE,now);
            System.out.println("warnings: "+state.getJSONArray("warnings"));
            Files.write(file,state.toString().getBytes(StandardCharsets.UTF_8));
        }else state=new JSONObject(read(file));
        require(state.optBoolean("complete",false),"three prices and both news regions usable");
        require(state.getJSONArray("markets").length()==3,"all three market series available");
        for(JSONObject m:list(items(state,"markets"))){
            JSONArray rows=m.getJSONArray("bars");require(rows.length()==260,"260 daily observations");String last="";
            for(JSONObject b:list(rows)){require(b.getString("date").compareTo(last)>0 && b.isNull("volume") && b.has("volume"),"chronology / missing volume");
                require(b.getDouble("low")<=b.getDouble("open")&&b.getDouble("high")>=b.getDouble("close"),"range");last=b.getString("date");}
            require(last.equals(m.getString("date")),"latest market date");
            System.out.println(m.getString("id")+" "+rows.length()+" days; last "+last+", close "+m.getDouble("close")+", "+m.optString("verification"));
        }
        require(items(state,"news").length()>10,"official news coverage");
        Set<String> ids=new HashSet<>(),regions=new HashSet<>();Map<String,JSONObject> latest=new HashMap<>();
        for(JSONObject n:list(items(state,"news"))){
            require(ids.add(n.getString("id"))&&LiveFeeds.allowedArticle(n.getString("region"),n.getString("url")),"unique safe article");
            regions.add(n.getString("region"));if(!latest.containsKey(n.getString("region")))latest.put(n.getString("region"),n);
        }
        require(regions.size()==2,"news on both markets");
        if("live".equals(args[0]))for(JSONObject n:latest.values()){
            String body=LiveFeeds.article(n,NetAccess.LIVE);require(body.length()>=60,"actual article open");
            System.out.println(n.getString("source")+" latest "+n.getString("published")+"; original read "+body.length()+" characters.");
        }
        JSONObject offline=LiveFeeds.refresh(state,new NoNetwork(),now);
        require(!offline.optBoolean("complete",true),"offline update incomplete");
        require(offline.getString("updatedAt").equals(state.getString("updatedAt")),"offline checked status");
        require(offline.getJSONArray("markets").toString().equals(state.getJSONArray("markets").toString()),"offline quotes");
        require(offline.getJSONArray("news").length()==state.getJSONArray("news").length()&&offline.getJSONArray("warnings").length()>=5,"offline news and warnings");
        require(!LiveFeeds.allowedArticle("US","https://example.org/"),"article origin pinned");
        try{NetAccess.publicTarget(new java.net.URL("https://127.0.0.1/"));throw new AssertionError("local denied");}catch(IOException ok){}
        catchup(now);
        model(state);
        System.out.println("PASS, "+ids.size()+" distinct official bulletins.");
    }
}
