package cn.zijing.marketlab;

import java.io.IOException;
import java.net.URL;
import java.text.*;
import java.util.*;
import java.util.regex.*;
import java.util.concurrent.*;
import org.json.*;
import static cn.zijing.marketlab.DataTools.*;

final class LiveFeeds {
    static final String CSI="CSI:000300", SPX="SP:SPX", IXIC="NASDAQ:IXIC", CN="中国国家统计局", US="美国联邦储备委员会", NDRC="中国国家发展和改革委员会";
    static final String CN_HOME="https://www.stats.gov.cn/sj/zxfb/", FED="https://www.federalreserve.gov";
    static final String NDRC_HOME="https://www.ndrc.gov.cn/xwdt/xwfb/";
    static final String CSI_URL="https://www.csindex.com.cn/zh-CN/indices/index-detail/000300";
    static final String SP_URL="https://gu.qq.com/us.INX/zs", CN_QUOTE="https://gu.qq.com/sh000300/zs";
    static final Pattern LIST_ITEM=Pattern.compile("(?is)<li\\b[^>]*>(.*?)</li>");
    static final Pattern NBS_LINK=Pattern.compile("(?is)<a\\b[^>]*?href=[\"'](\\./[0-9]{6}/t[0-9]{8}_[0-9]+\\.html)[\"'][^>]*>(.*?)</a>");
    static final Pattern DISPLAY_DATE=Pattern.compile("(?i)<span[^>]*>\\s*([0-9]{4}[-/][0-9]{2}[-/][0-9]{2})\\s*</span>");
    static final Pattern NEWS_BODY_CN=Pattern.compile("(?i)<div\\s+class=[\"'](?:[^\"]*?\\s)?trs_editor_view[^>]*>|<div\\s+class=[\"']txt-content[\"'][^>]*>");
    static final Pattern NEWS_BODY_US=Pattern.compile("(?i)<div\\s+class=[\"']col-xs-12 col-sm-8 col-md-8[\"'][^>]*>");
    static JSONObject empty() throws JSONException {
        return obj("updatedAt","","complete",false,"markets",arr(),"news",arr(),"warnings",arr(),"checks",obj());
    }
    static JSONObject bar(String date,double open,double high,double low,double close) throws Exception {
        if(!date(date)||!(low>0 && low<=Math.min(open,close) && Math.max(open,close)<=high && high<Double.POSITIVE_INFINITY))
            throw new IOException("日线格式无效");
        return obj("date",date,"open",open,"high",high,"low",low,"close",close,"volume",JSONObject.NULL);
    }
    static void add(TreeMap<String,JSONObject> rows,JSONObject b,String start,String end) throws Exception{
        String date=b.getString("date");
        if(date.compareTo(start)<0 || date.compareTo(end)>0)return;
        SimpleDateFormat f=new SimpleDateFormat("yyyy-MM-dd",Locale.US);f.setTimeZone(TimeZone.getTimeZone("UTC"));
        Calendar cal=Calendar.getInstance(TimeZone.getTimeZone("UTC"));cal.setTime(f.parse(date));
        if(cal.get(Calendar.DAY_OF_WEEK)==Calendar.SATURDAY || cal.get(Calendar.DAY_OF_WEEK)==Calendar.SUNDAY)return;
        if(rows.put(date,b)!=null)throw new IOException("同一交易日重复");
    }
    static JSONObject quote(String id,NetAccess.Transport net,long now, JSONArray warnings) throws Exception{
        boolean cn=CSI.equals(id), nas=IXIC.equals(id);
        String zone=cn?"Asia/Shanghai":"America/New_York",symbol=cn?"sh000300":nas?"us.IXIC":"us.INX";
        String start=day(now-430*DAY),end=cutoff(now,zone,cn?1630:1700);
        String name=cn?"沪深300指数":nas?"纳斯达克综合指数":"标普500指数",src="腾讯财经",url=cn?CN_QUOTE:nas?"https://gu.qq.com/us.IXIC/zs":SP_URL;
        TreeMap<String,JSONObject> rows=new TreeMap<>();
        if(cn){
            try{
                String root="https://www.csindex.com.cn/csindex-home/perf/index-perf?indexCode=000300&startDate="+start.replace("-","")+"&endDate="+end.replace("-","");
                JSONObject response=new JSONObject(net.get(root));
                if(!"200".equals(response.optString("code")))throw new IOException("行情请求未成功");
                for(JSONObject r:list(response.getJSONArray("data"))){
                    if(!"000300".equals(r.getString("indexCode")))throw new IOException("行情代码不符");
                    String raw=r.getString("tradeDate");if(!raw.matches("\\d{8}"))throw new IOException("交易日格式异常");
                    String d=raw.substring(0,4)+"-"+raw.substring(4,6)+"-"+raw.substring(6);
                    // This endpoint may repeat a prior close on the requested opening boundary.
                    if(!d.equals(start))add(rows,bar(d,r.getDouble("open"),r.getDouble("high"),r.getDouble("low"),r.getDouble("close")),start,end);
                }
                if(rows.size()<85)throw new IOException("日线覆盖不足");
                src="中证指数有限公司";url=CSI_URL;
            }catch(Exception failure){rows.clear();warnings.put("中证指数暂不可用，已尝试腾讯财经的沪深300日线。");}
        }
        if(rows.isEmpty()){
            String api="https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param="+symbol+",day,"+start+","+end+",640,qfq";
            JSONObject response=new JSONObject(net.get(api));
            if(response.optInt("code",-1)!=0)throw new IOException("行情请求未成功");
            JSONArray feed=response.getJSONObject("data").getJSONObject(symbol).getJSONArray("day");
            for(int i=0;i<feed.length();i++){JSONArray r=feed.getJSONArray(i);
                add(rows,bar(r.getString(0),r.getDouble(1),r.getDouble(3),r.getDouble(4),r.getDouble(2)),start,end);}
        }
        if(rows.size()<85)throw new IOException("返回日线不足，保留前次缓存");
        while(rows.size()>260)rows.pollFirstEntry();
        List<JSONObject> values=new ArrayList<>(rows.values());
        JSONObject last=values.get(values.size()-1),out=new JSONObject(last.toString());
        double prev=values.get(values.size()-2).getDouble("close");
        if(!cn){
            String code=nas?"NASDAQCOM":"SP500";
            String verificationUrl="https://fred.stlouisfed.org/series/"+code;
            String text=null,after=day(now-18*DAY);
            try{text=net.get("https://fred.stlouisfed.org/data/"+code);}
            catch(Exception unavailable){warnings.put(name+"收盘的 FRED 交叉核对暂不可用。");}
            int verified=0;String through="";
            if(text!=null){
                Matcher observations=Pattern.compile("(?m)^\\s*#?([0-9]{4}-[0-9]{2}-[0-9]{2})[|,]([0-9]+(?:[.][0-9]+)?)[ \\t\\r]*$").matcher(text);
                while(observations.find()){
                    String session=observations.group(1);
                    if(session.compareTo(after)<0 || !rows.containsKey(session))continue;
                    if(Math.abs(rows.get(session).getDouble("close")-Double.parseDouble(observations.group(2)))>.011)
                        throw new IOException("报价收盘与 FRED 可比数据不符");
                    verified++; if(session.compareTo(through)>0)through=session;
                }
                if(verified==0)warnings.put(name+"暂未取得可比的 FRED 收盘值。");
            }
            out.put("verification",verified==0?"尚无本轮独立收盘校验":"FRED 已核验 "+verified+" 个最近交易日收盘，截至 "+through)
               .put("verificationUrl",verificationUrl);
        }
        return out.put("id",id).put("name",name).put("currency",cn?"CNY":"USD").put("unit","点").put("timezone",zone)
            .put("timing","最近已收盘日线，公布可能延迟；开盘期间展示上一已完成交易日。")
            .put("source",src).put("url",url).put("fetchedAt",instant(now)).put("bars",new JSONArray(values))
            .put("changePct",(last.getDouble("close")/prev-1)*100);
    }
    static JSONObject news(String region,String title,String url,String published,long now) throws Exception{
        if(!date(published.substring(0,10)) || !allowedArticle(region,url))throw new IOException("公告格式或原文地址无效");
        return obj("id",id(url),"region",region,"source",url.startsWith(NDRC_HOME)?NDRC:"CN".equals(region)?CN:US,"title",limit(text(title),500),
                "url",url,"published",published,"fetchedAt",instant(now));
    }
    static boolean allowedArticle(String region,String url){
        if("CN".equals(region))return url.startsWith(NDRC_HOME)&&url.substring(NDRC_HOME.length()).matches("[0-9]{6}/t[0-9]{8}_[0-9]+[.]html") || url.matches("https://www\\.stats\\.gov\\.cn/sj/zxfb/[0-9]{6}/t[0-9]{8}_[0-9]+\\.html");
        return "US".equals(region)&&url.matches("https://www\\.federalreserve\\.gov/newsevents/pressreleases/[A-Za-z0-9_-]+\\.htm");
    }
    static List<JSONObject> chinaPage(String html,String origin,long now) throws Exception{
        Map<String,JSONObject> found=new LinkedHashMap<>();
        Matcher li=LIST_ITEM.matcher(html);
        while(li.find()){
            Matcher a=NBS_LINK.matcher(li.group(1)),d=DISPLAY_DATE.matcher(li.group(1));
            if(a.find()&&d.find()){
                String url=new URL(new URL(origin),a.group(1)).toString();
                JSONObject n=news("CN",a.group(2),url,d.group(1).replace('/','-'),now);found.put(url,n);
            }
        }
        if(found.isEmpty())throw new IOException("数据发布列表未返回可识别的公告");
        return new ArrayList<>(found.values());
    }
    static List<JSONObject> newsFeed(String region,NetAccess.Transport net,String since,long now) throws Exception{
        List<JSONObject> found=new ArrayList<>();
        if(!"US".equals(region)){
            String origin="CN".equals(region)?CN_HOME:NDRC_HOME;
            for(int p=0;p<8;p++){
                List<JSONObject> page=chinaPage(net.get(origin+(p==0?"":"index_"+p+".html")),origin,now);
                boolean crossed=false;
                for(JSONObject n:page){if(n.getString("published").compareTo(since)<0)crossed=true;else found.add(n);}
                if(crossed)break;
            }
        }else{
            String raw=net.get(FED+"/json/ne-press.json").replaceFirst("^\uFEFF","");
            JSONArray archive=new JSONArray(raw);
            SimpleDateFormat parser=new SimpleDateFormat("M/d/yyyy h:mm:ss a",Locale.US);
            parser.setTimeZone(TimeZone.getTimeZone("America/New_York"));parser.setLenient(false);
            boolean valid=false;
            for(JSONObject n:list(archive)){
                String address=FED+n.optString("l");if(!allowedArticle("US",address))continue;
                String timestamp=n.getString("d");
                // Some early archive records have a date only. Check the year before parsing their optional time.
                if(timestamp.matches("[0-9]{1,2}/[0-9]{1,2}/[0-9]{4}"))timestamp+=" 12:00:00 AM";
                Date published=parser.parse(timestamp); valid=true;
                if(fmt(published.getTime(),"yyyy-MM-dd","America/New_York").compareTo(since)<0)continue;
                found.add(news("US",n.getString("t"),address,instant(published.getTime()),now));
            }
            if(!valid)throw new IOException("美联储归档格式无法识别");
        }
        return found;
    }
    static String article(JSONObject n,NetAccess.Transport net) throws Exception {
        String region=n.getString("region"),address=n.getString("url");
        if(!allowedArticle(region,address))throw new IOException("未收录的原文地址");
        String html=net.get(address);
        Pattern selector=address.startsWith(NDRC_HOME)?Pattern.compile("(?i)<div class=TRS_Editor[^>]*>|<div class=.article_con article_con_title.[^>]*>"):"CN".equals(region)?NEWS_BODY_CN:NEWS_BODY_US;
        Matcher body=selector.matcher(html);
        if(!body.find())throw new IOException("本次未读到公告正文");
        String segment=html.substring(body.end());
        Matcher stop=Pattern.compile("(?i)<footer|class=[\"'](?:detail-(?:share|bottom)|related|footer|article__footer|article_r)|<!--\\s*(?:End|Footer)").matcher(segment);
        if(stop.find())segment=segment.substring(0,stop.start());
        String value=text(segment);
        if(value.length()<35)throw new IOException("本次未读到足够的公告正文");
        return limit(value,4500);
    }
    static JSONObject refresh(JSONObject previous,NetAccess.Transport net,long now) throws Exception{
        JSONObject checks=previous.optJSONObject("checks"); checks=checks==null?obj():new JSONObject(checks.toString());
        JSONArray warnings=arr();Map<String,JSONObject> markets=new LinkedHashMap<>(),news=new HashMap<>();
        for(JSONObject m:list(items(previous,"markets")))markets.put(m.getString("id"),m);
        for(JSONObject n:list(items(previous,"news")))news.put(n.getString("id"),n);
        int successes=0, freshMarkets=0; Set<String> freshNews=new HashSet<>();
        List<String> indexes=Arrays.asList(CSI,SPX,IXIC), channels=Arrays.asList("CN","CN_NDRC","US");
        Map<String,Future<JSONObject>> prices=new LinkedHashMap<>();
        Map<String,Future<List<JSONObject>>> bulletins=new LinkedHashMap<>();
        ExecutorService workers=Executors.newFixedThreadPool(6);
        try{
            for(String id:indexes)prices.put(id,workers.submit(()->{
                JSONArray notes=arr();JSONObject m=quote(id,net,now,notes);return obj("market",m,"warnings",notes);
            }));
            for(String channel:channels){
                String since=day(now-90*DAY),old=checks.optString(channel,"");
                if(old.length()>=10){
                    SimpleDateFormat f=new SimpleDateFormat("yyyy-MM-dd",Locale.US);f.setTimeZone(TimeZone.getTimeZone("UTC"));
                    String checkpoint=day(f.parse(old.substring(0,10)).getTime()-3*DAY);
                    if(checkpoint.compareTo(since)>0)since=checkpoint;
                }
                final String earliest=since;
                bulletins.put(channel,workers.submit(()->newsFeed(channel,net,earliest,now)));
            }
            for(String id:indexes){
                try{
                    JSONObject result=prices.get(id).get(),fresh=result.getJSONObject("market"),cached=markets.get(id);
                    if(cached!=null && cached.getString("date").compareTo(fresh.getString("date"))>0)throw new IOException("来源比缓存旧");
                    markets.put(id,fresh);checks.put(id,instant(now));successes++;freshMarkets++;
                    JSONArray notes=items(result,"warnings");for(int i=0;i<notes.length();i++)warnings.put(notes.get(i));
                }catch(ExecutionException|IOException bad){
                    warnings.put((CSI.equals(id)?"沪深300":IXIC.equals(id)?"纳斯达克综合":"标普500")+"日线未更新，保留已有缓存。");
                }
            }
            for(String channel:channels){
                String publisher="CN".equals(channel)?CN:"CN_NDRC".equals(channel)?NDRC:US;
                try{
                    for(JSONObject n:bulletins.get(channel).get()){
                        JSONObject prior=news.get(n.getString("id"));
                        if(prior!=null && n.getString("title").equals(prior.optString("title")))n.put("fetchedAt",prior.optString("fetchedAt"));
                        news.put(n.getString("id"),n);
                    }
                    checks.put(channel,instant(now));freshNews.add(publisher);successes++;
                }catch(ExecutionException bad){warnings.put(publisher+"消息未更新，下次联网将按上次成功日期补采。");}
            }
        }finally{workers.shutdownNow();}
        boolean complete=freshMarkets==3 && freshNews.contains(US) && (freshNews.contains(CN)||freshNews.contains(NDRC));
        List<JSONObject> ordered=new ArrayList<>(news.values());
        Collections.sort(ordered,(a,b)->{int c=b.optString("published").compareTo(a.optString("published"));return c!=0?c:a.optString("id").compareTo(b.optString("id"));});
        JSONArray retained=arr();String oldest=day(now-90*DAY);
        for(JSONObject n:ordered)if((!freshNews.contains(n.optString("source")) || n.optString("published").compareTo(oldest)>=0) && retained.length()<500)retained.put(n);
        return obj("complete",complete,"updatedAt",successes>0?instant(now):previous.optString("updatedAt"),"markets",new JSONArray(markets.values()),
            "news",retained,"warnings",warnings,"checks",checks);
    }
    private LiveFeeds(){}
}
