package cn.zijing.marketlab.qa;

import android.app.*;
import android.content.*;
import android.os.*;
import android.view.*;
import android.widget.*;
import java.lang.reflect.*;
import java.text.SimpleDateFormat;
import java.util.*;
import org.json.*;

/** Exercises the shipped activity on a disposable emulator. Only synthetic credentials and transport. */
public final class ChatCheck extends Instrumentation {
    Bundle args;
    Activity activity;
    Context ctx;
    String phase;
    int sends;
    static final String TEST="marketlab-test.invalid";
    static final String ticker="NASDAQ:IXIC";
    @Override public void onCreate(Bundle args){super.onCreate(args);this.args=args;start();}
    static void check(boolean ok,String why){if(!ok)throw new AssertionError(why);}
    Class<?> app(String type)throws Exception{return ctx.getClassLoader().loadClass("cn.zijing.marketlab."+type);}
    static String day(){return new SimpleDateFormat("yyyy-MM-dd",Locale.US).format(new Date());}
    void prepare()throws Exception{
        check(!ctx.getSharedPreferences("model",0).contains("blob"),"fresh emulator required");
        Class<?> cfg=app("MarketConfig");Object c=cfg.newInstance();
        cfg.getField("baseUrl").set(c,"https://"+TEST+"/v1");cfg.getField("model").set(c,"qa-chat");
        cfg.getField("key").set(c,"local-dummy");cfg.getField("dailyLimit").setInt(c,20);
        Method save=cfg.getDeclaredMethod("save",Context.class);save.setAccessible(true);save.invoke(c,ctx);
        ctx.getSharedPreferences("daily",0).edit().putBoolean("auto",false).commit();
        ctx.getSharedPreferences("market.research.v1",0).edit().putString("budgetDay",day()).putInt("budgetUsed",19).commit();
    }
    static JSONObject obj(Object... pairs)throws Exception{JSONObject o=new JSONObject();for(int i=0;i<pairs.length;i+=2)o.put((String)pairs[i],pairs[i+1]);return o;}
    static JSONArray arr(Object... values){JSONArray a=new JSONArray();for(Object v:values)a.put(v);return a;}
    void fake()throws Exception{
        Class<?> type=app("NetAccess$Transport");
        Object wire=Proxy.newProxyInstance(type.getClassLoader(),new Class<?>[]{type},(proxy,m,a)->{
            check(m.getName().equals("model")&&a[0].toString().contains(TEST),"unexpected network");
            sends++;JSONObject payload=new JSONObject(a[2].toString());
            JSONArray msgs=payload.getJSONArray("messages");JSONObject last=msgs.getJSONObject(msgs.length()-1);String body=last.getString("content");
            JSONObject reply;
            if("tool".equals(last.getString("role")))reply=obj("role","assistant","content","本次测试的纳指收盘为 12345 点 [S1]。");
            else if(body.contains("查纳指"))reply=obj("role","assistant","tool_calls",arr(obj("id","verify1","type","function","function",obj("name","market_bars","arguments",obj("id",ticker).toString()))));
            else if(body.contains("刚才")){
                check(msgs.toString().contains("12345 点"),"follow-up missing history");
                reply=obj("role","assistant","content","刚才说的是收盘点位。");
            }else reply=obj("role","assistant","content","你好，我可以和你聊天。");
            return obj("choices",arr(obj("message",reply))).toString();
        });
        Field live=app("NetAccess").getDeclaredField("LIVE");live.setAccessible(true);live.set(null,wire);
        JSONObject bars=obj("id",ticker,"name","纳斯达克综合指数","source","测试行情","date","2026-11-20","url","https://example.org/series","bars",arr(obj("date","2026-11-20","close",12345)));
        ctx.getSharedPreferences("market.research.v1",0).edit().putString("dashboard",obj("updatedAt","2099-01-01T00:00:00Z","markets",arr(bars),"news",arr()).toString()).commit();
    }
    View find(View v,String text){
        if(v instanceof TextView && text.contentEquals(((TextView)v).getText()))return v;
        if(v instanceof ViewGroup){ViewGroup g=(ViewGroup)v;for(int i=0;i<g.getChildCount();i++){View x=find(g.getChildAt(i),text);if(x!=null)return x;}}
        return null;
    }
    View get(String text){return find(activity.getWindow().getDecorView(),text);}
    void send(String question,String expected)throws Exception{
        runOnMainSync(()->{View label=get("你的消息");EditText box=activity.findViewById(label.getLabelFor());box.setText(question);get("发送").performClick();});
        for(int i=0;i<100;i++){boolean[] found={false};runOnMainSync(()->found[0]=get(expected)!=null);if(found[0])return;SystemClock.sleep(80);}
        throw new AssertionError("Message not displayed: "+expected);
    }
    void interactive()throws Exception{
        boolean restart="reopen".equals(phase);
        if(!restart)fake();
        Intent intent=ctx.getPackageManager().getLaunchIntentForPackage(ctx.getPackageName());intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        activity=startActivitySync(intent);waitForIdleSync();runOnMainSync(()->get("助手").performClick());waitForIdleSync();
        if(restart){runOnMainSync(()->check(get("刚才说的是收盘点位。")!=null,"saved history after relaunch"));return;}
        send("你好","你好，我可以和你聊天。");
        send("查纳指收盘","本次测试的纳指收盘为 12345 点 [S1]。");
        send("你刚才说的是什么意思？","刚才说的是收盘点位。");
        check(sends==4,"one chat, two research, one follow-up");
        SharedPreferences p=ctx.getSharedPreferences("market.research.v1",0);
        check(p.getInt("budgetUsed",-1)==23 && p.getInt("questions",-1)==3,"beyond old limit");
        runOnMainSync(()->check(get("今天提问")!=null && get("今天模型调用")!=null && get("23")!=null,"visible counters"));
    }
    @Override public void onStart(){
        Bundle result=new Bundle();
        try{ctx=getTargetContext();check(Build.MODEL.contains("sdk")||Build.FINGERPRINT.contains("generic"),"emulator only");
            phase=args.getString("phase","verify");if("prepare".equals(phase))prepare();else interactive();
            result.putString("result","PASS "+phase+" model sends="+sends);finish(Activity.RESULT_OK,result);
        }catch(Throwable failure){result.putString("failure",android.util.Log.getStackTraceString(failure));finish(Activity.RESULT_CANCELED,result);}
    }
}
