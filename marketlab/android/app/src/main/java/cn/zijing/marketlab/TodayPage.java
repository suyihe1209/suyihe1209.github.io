package cn.zijing.marketlab;

import android.app.AlertDialog;
import android.graphics.*;
import android.graphics.drawable.GradientDrawable;
import android.view.*;
import android.widget.*;
import org.json.*;
import java.text.DecimalFormat;
import java.text.DecimalFormatSymbols;
import java.time.*;
import java.time.format.*;
import java.util.*;
import static cn.zijing.marketlab.MainActivity.*;

final class TodayPage {
    static final String[] IDS={"CSI:000300","SP:SPX","NASDAQ:IXIC"},NAMES={"沪深300","标普500","纳斯达克综合"},CODES={"CSI 300","S&P 500","NASDAQ COMP"};
    final MainActivity a;
    String region="";
    private int shown=12;
    private LinearLayout newsBody;
    TodayPage(MainActivity a){this.a=a;}
    static String latestDay(JSONObject d){
        String day="";JSONArray ms=d.optJSONArray("markets");if(ms!=null)for(int i=0;i<ms.length();i++){
            JSONObject m=ms.optJSONObject(i);if(m!=null&&m.optString("date").compareTo(day)>0)day=m.optString("date");
        }return day;
    }
    static String num(double n){return Double.isFinite(n)?new DecimalFormat("#,##0.00",DecimalFormatSymbols.getInstance(Locale.US)).format(n):"—";}
    static String pct(double n){return Double.isFinite(n)?(n>0?"+":"")+num(n)+"%":"—";}
    static double change(JSONObject m){
        JSONArray bars=m.optJSONArray("bars");if(bars==null||bars.length()<2)return Double.NaN;
        double current=bars.optJSONObject(bars.length()-1).optDouble("close"),prev=bars.optJSONObject(bars.length()-2).optDouble("close");
        return prev>0?(current/prev-1)*100:Double.NaN;
    }
    static JSONObject market(JSONObject d,String id){
        JSONArray ms=d.optJSONArray("markets");if(ms!=null)for(int i=0;i<ms.length();i++){
            JSONObject m=ms.optJSONObject(i);if(m!=null&&id.equals(m.optString("id")))return m;
        }return null;
    }
    static String shortDate(String iso){return iso!=null&&iso.length()>=10?iso.substring(5,10).replace('-','/'):"—";}
    static String localStamp(String iso){
        try{return Instant.parse(iso).atZone(ZoneId.systemDefault()).format(DateTimeFormatter.ofPattern("MM/dd HH:mm"));}catch(Exception e){return "—";}
    }
    private TextView mono(String value,int size,int color){return a.face(value,size,color,Typeface.MONOSPACE,Typeface.NORMAL);}
    private TextView serif(String val,int size,int color,int style){return a.face(val,size,color,Typeface.SERIF,style);}
    private void section(LinearLayout parent,String title,String detail){
        LinearLayout row=a.row();row.addView(serif(title,17,INK,Typeface.BOLD),new LinearLayout.LayoutParams(0,-2,1));
        row.addView(a.txt(detail,11,MUTED));parent.addView(row);
    }
    private void heading(LinearLayout page,String date){
        LinearLayout row=a.row();LinearLayout text=a.col();String dayOfWeek="等待收盘行情";
        try {LocalDate d=LocalDate.parse(date);dayOfWeek="周"+"一二三四五六日".charAt(d.getDayOfWeek().getValue()-1)+" · "+d.getYear();}catch(Exception ignore){}
        text.addView(mono(dayOfWeek,11,MUTED));text.addView(serif("收盘纪要",32,INK,Typeface.BOLD));row.addView(text,new LinearLayout.LayoutParams(0,-2,1));
        row.addView(serif(shortDate(date),40,TEAL,Typeface.ITALIC));page.addView(row);a.gap(page,9);a.rule(page);a.gap(page,15);
    }
    private void mood(LinearLayout page,JSONObject d){
        int up=0,down=0,flat=0;int[] colors=new int[3];double best=-Double.MAX_VALUE;String leading="";
        TreeSet<String> dates=new TreeSet<>();
        for(int i=0;i<IDS.length;i++){
            JSONObject m=market(d,IDS[i]);double c=m==null?Double.NaN:change(m);
            if(m!=null)dates.add(m.optString("date"));colors[i]=!Double.isFinite(c)?LINE:c>0?POS:c<0?NEG:MUTED;
            if(!Double.isFinite(c))continue;if(c>0)up++;else if(c<0)down++;else flat++;
            if(c>best){best=c;leading=NAMES[i];}
        }
        LinearLayout box=a.col();GradientDrawable grad=new GradientDrawable(GradientDrawable.Orientation.TL_BR,new int[]{0xff44313f,0xff2c2330});
        grad.setCornerRadius(a.px(12));grad.setStroke(a.px(1),0xff564150);box.setBackground(grad);box.setPadding(a.px(14),a.px(9),a.px(14),a.px(10));page.addView(box);
        section(box,"三项指数表现","前收对比");LinearLayout totals=a.row();
        int count=up+down+flat;if(count>0){totals.addView(serif(up+" 项上涨",21,POS,Typeface.BOLD));totals.addView(serif("    "+down+" 项下跌",21,NEG,Typeface.BOLD));if(flat>0)totals.addView(serif("    "+flat+" 项持平",16,MUTED,Typeface.NORMAL));}
        else totals.addView(serif("等待行情",21,INK,Typeface.BOLD));box.addView(totals);
        box.addView(new Pattern(a,colors),new LinearLayout.LayoutParams(-1,a.px(12)));
        String about=count==0?"联网后即可查看各指数相对前一交易日的变化。":count<3?"已取得 "+count+" 项可比较的收盘行情。":dates.size()>1?"交易日不同，各指数分别与自己的前收盘比较。":
            best<0?"三项指数均收跌，"+leading+"跌幅最小。":best==0&&flat==3?"三项指数与各自前收盘持平。":leading+(best>0?"涨幅居前，收涨 "+num(best)+"%。":"持平，其余指数未上涨。");
        box.addView(a.txt(about,12,MUTED));a.gap(page,15);
    }
    void render(LinearLayout page,JSONObject d){
        String cutoff=latestDay(d);heading(page,cutoff);mood(page,d);
        boolean mixedDates=false;
        for(String id:IDS){JSONObject m=market(d,id);if(m!=null&&!cutoff.equals(m.optString("date")))mixedDates=true;}
        if(a.updating||!d.optBoolean("complete",false)||!a.feedback.isEmpty()&&a.feedback.startsWith("更新失败")){
            String status=a.updating?"正在更新行情与消息…":!a.feedback.isEmpty()?a.feedback:cutoff.isEmpty()?"点上方刷新按钮，联网获取收盘行情和官方消息。":"部分来源尚未更新，已保留各自的缓存。";
            a.note(page,status);a.gap(page,8);
        }
        section(page,"指数一览","近 10 日 / 日涨跌");a.rule(page);
        for(int i=0;i<IDS.length;i++){
            final JSONObject m=market(d,IDS[i]);final int which=i;LinearLayout row=a.row();row.setMinimumHeight(a.px(52));
            LinearLayout text=a.col();text.addView(a.face(NAMES[i],14,INK,Typeface.DEFAULT,Typeface.BOLD));
            text.addView(mono(CODES[i]+(m!=null&&mixedDates?" · "+shortDate(m.optString("date")):""),10,MUTED));
            row.addView(text,new LinearLayout.LayoutParams(0,-2,1.15f));
            View spark=new Spark(a,m);row.addView(spark,new LinearLayout.LayoutParams(0,a.px(26),.7f));
            LinearLayout values=a.col();values.setGravity(Gravity.END);double c=m==null?Double.NaN:change(m);
            TextView close=mono(m==null?"—":num(m.optDouble("close")),16,INK),delta=mono(pct(c),11,c>0?POS:c<0?NEG:MUTED);
            close.setGravity(Gravity.END|Gravity.CENTER_VERTICAL);delta.setGravity(Gravity.END|Gravity.CENTER_VERTICAL);values.addView(close);values.addView(delta);
            row.addView(values,new LinearLayout.LayoutParams(0,-2,1.03f));page.addView(row);
            row.setContentDescription(NAMES[i]+(m==null?" 暂无缓存":" 收盘 "+num(m.optDouble("close"))+" 日涨跌 "+pct(c))+"，查看行情来源");
            a.touch(row,v->{if(m==null){a.message("尚无该指数缓存。请更新行情与消息。");return;}quote(which,m);});
        }
        a.gap(page,14);section(page,"官方消息","按发布日期");newsBody=a.col();page.addView(newsBody);news(d);
        a.gap(page,12);a.rule(page);String fetched=d.optString("updatedAt");
        page.addView(a.txt(fetched.isEmpty()?"尚无更新记录":"设备上次更新 "+localStamp(fetched)+" · 设备当地时间",11,MUTED));
        JSONArray warnings=d.optJSONArray("warnings");
        if(warnings!=null&&warnings.length()>0){TextView info=a.txt("查看 "+warnings.length()+" 项来源更新说明 ↗",12,TEAL);info.setMinHeight(a.px(40));a.touch(info,v->a.sourcesDialog());page.addView(info);}
        Button update=a.button(a.updating?"更新中…":"更新行情与消息",v->a.refresh(false));update.setEnabled(!a.updating);page.addView(update);
        a.gap(page,14);LinearLayout br=a.panel(page);br.addView(serif("每日研究简报",17,INK,Typeface.BOLD));JSONObject brief=a.readAnswer("briefResult");
        if(brief!=null)a.answer(br,brief);else a.note(br,"在设置中开启每日 AI 简报，或到助手页手动提问。");a.note(br,DailyJob.prefs(a).getString("briefStatus",""));
    }
    private void quote(int i,JSONObject m){
        JSONArray bars=m.optJSONArray("bars");double prev=bars!=null&&bars.length()>1?bars.optJSONObject(bars.length()-2).optDouble("close"):Double.NaN;
        String details=m.optString("date")+" · "+(i==0?"北京时间":"纽约时间")+"（"+m.optString("timezone")+"）"+" · 指数点\n\n开盘　"+num(m.optDouble("open"))+"\n最高　"+num(m.optDouble("high"))+"\n最低　"+num(m.optDouble("low"))
            +"\n收盘　"+num(m.optDouble("close"))+"\n前收　"+num(prev)+"\n日涨跌幅　"+pct(change(m))+"\n\n行情来源　"+m.optString("source")+"\n采集时间　"+localStamp(m.optString("fetchedAt"))+"（设备当地时间）";
        new AlertDialog.Builder(a).setTitle(NAMES[i]+" · 收盘报价").setMessage(details).setNegativeButton("关闭",null).setPositiveButton("打开行情出处",(dlg,w)->a.openSource(m.optString("url"))).show();
    }
    private void news(JSONObject d){
        newsBody.removeAllViews();LinearLayout filters=a.row();
        for(String choice:new String[]{"","CN","US"}){
            Button b=a.chip(choice.isEmpty()?"全部":choice.equals("CN")?"中国大陆":"美国",choice.equals(region),v->{region=choice;shown=12;news(d);});filters.addView(b);a.space(filters,5);
        }newsBody.addView(filters);JSONArray list=d.optJSONArray("news");int found=0;
        if(list!=null)for(int i=0;i<list.length();i++){
            JSONObject n=list.optJSONObject(i);if(n==null||!region.isEmpty()&&!region.equals(n.optString("region")))continue;
            if(++found>shown)continue;newsRow(n);
        }
        if(found==0)a.note(newsBody,region.isEmpty()?"还没有已缓存的官方消息。":"此地区暂无已缓存的消息。");
        if(found>shown)newsBody.addView(a.button("再显示 12 条消息",v->{shown+=12;news(d);}));
    }
    private void newsRow(JSONObject n){
        String r=n.optString("region"),published=n.optString("published"),zone=r.equals("US")?"纽约时间":"北京时间";String date=published,time="仅日期";
        try{if(published.length()!=10){
            ZonedDateTime dt=Instant.parse(published).atZone(ZoneId.of(r.equals("US")?"America/New_York":"Asia/Shanghai"));
            date=dt.toLocalDate().toString();time=dt.format(DateTimeFormatter.ofPattern("HH:mm"));}
        }catch(Exception ignored){date="";time="时刻未知";}
        a.rule(newsBody);LinearLayout row=a.row();row.setGravity(Gravity.TOP);row.setPadding(0,a.px(8),0,a.px(8));row.setMinimumHeight(a.px(50));
        LinearLayout when=a.col();when.addView(mono(shortDate(date),12,TEAL));when.addView(mono(time,10,MUTED));
        when.addView(a.txt(zone,9,MUTED));row.addView(when,new LinearLayout.LayoutParams(a.px(57),-2));
        LinearLayout words=a.col();words.addView(a.face(n.optString("title"),14,INK,Typeface.DEFAULT,Typeface.BOLD));words.addView(a.txt(n.optString("source"),11,MUTED));
        row.addView(words,new LinearLayout.LayoutParams(0,-2,1));row.addView(a.txt("↗",16,MUTED));newsBody.addView(row);
        final String stamp=date+"　"+time+" "+zone,summary=n.optString("summary","").trim(),name=n.optString("source");
        a.touch(row,v->new AlertDialog.Builder(a).setTitle(n.optString("title")).setMessage(name+"\n"+stamp+(summary.isEmpty()||summary.equals(n.optString("title"))?"":"\n\n"+summary))
            .setNegativeButton("关闭",null).setPositiveButton("打开官方原文",(dlg,w)->a.openSource(n.optString("url"))).show());
    }
    private static class Spark extends View {
        final Paint p=new Paint(Paint.ANTI_ALIAS_FLAG);final ArrayList<Double> points=new ArrayList<>();
        Spark(MainActivity a,JSONObject m){super(a);if(m==null)return;JSONArray b=m.optJSONArray("bars");if(b!=null)for(int i=Math.max(0,b.length()-10);i<b.length();i++){
            JSONObject row=b.optJSONObject(i);double v=row==null?Double.NaN:row.optDouble("close");if(Double.isFinite(v))points.add(v);
        }setContentDescription("近 "+points.size()+" 个交易日收盘走势");}
        protected void onDraw(Canvas c){
            if(points.size()<2)return;double lo=Collections.min(points),hi=Collections.max(points);float pad=getResources().getDisplayMetrics().density*3,width=Math.min(getWidth()-2*pad,pad*22),x0=(getWidth()-width)/2;
            Path path=new Path();for(int i=0;i<points.size();i++){float x=x0+i*width/(points.size()-1),y=hi==lo?getHeight()/2f:(float)(getHeight()-pad-(points.get(i)-lo)/(hi-lo)*(getHeight()-2*pad));
                if(i==0)path.moveTo(x,y);else path.lineTo(x,y);}
            p.setColor(TEAL);p.setStyle(Paint.Style.STROKE);p.setStrokeWidth(pad*.48f);p.setStrokeCap(Paint.Cap.ROUND);p.setStrokeJoin(Paint.Join.ROUND);c.drawPath(path,p);
        }
    }
    private static class Pattern extends View {
        final int[] colors;final Paint p=new Paint(Paint.ANTI_ALIAS_FLAG);Pattern(MainActivity a,int[] colors){super(a);this.colors=colors;}
        protected void onDraw(Canvas c){float dp=getResources().getDisplayMetrics().density,gap=4*dp,w=(getWidth()-2*gap)/3,h=6*dp,y=(getHeight()-h)/2;
            for(int i=0;i<3;i++){float x=i*(w+gap);c.save();c.clipRect(x,y,x+w,y+h);p.setColor(colors[i]);p.setStrokeWidth(dp*2);
                for(float k=-h;k<w;k+=5*dp)c.drawLine(x+k,y+h,x+k+h*.55f,y,p);c.restore();}
        }
    }
}
