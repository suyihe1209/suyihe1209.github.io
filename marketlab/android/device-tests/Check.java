package cn.zijing.marketlab.qa;

import android.app.*;
import android.content.*;
import android.os.*;
import android.view.*;
import android.widget.TextView;
import android.webkit.WebView;
import org.json.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.*;

public class Check extends Instrumentation {
    private Activity activity;
    private WebView web;
    private final StringBuilder trace=new StringBuilder();
    public void onCreate(Bundle args){super.onCreate(args);start();}
    private View find(View item,String label,boolean browser){
        if(browser&&item instanceof WebView)return item;
        if(item instanceof TextView&&label.equals(((TextView)item).getText().toString()))return item;
        if(item instanceof ViewGroup){ViewGroup parent=(ViewGroup)item;for(int i=0;i<parent.getChildCount();i++){
            View got=find(parent.getChildAt(i),label,browser);if(got!=null)return got;}}
        return null;
    }
    private String js(String code)throws Exception{
        CountDownLatch latch=new CountDownLatch(1);AtomicReference<String> out=new AtomicReference<>();
        runOnMainSync(()->web.evaluateJavascript(code,v->{out.set(v);latch.countDown();}));
        if(!latch.await(15,TimeUnit.SECONDS))throw new Exception("WebView did not respond: "+code);
        return out.get();
    }
    private void expect(String expr)throws Exception{
        long deadline=System.currentTimeMillis()+35000;
        do{if("true".equals(js("Boolean("+expr+")")))return;Thread.sleep(250);}while(System.currentTimeMillis()<deadline);
        throw new Exception("Failed "+expr+"; "+js("document.querySelector('[data-page]:not([hidden])')?.innerText.slice(-380)"));
    }
    private void route(String key)throws Exception{
        js("[...document.querySelectorAll('.ml-nav a')].find(a=>a.hash==='#"+key+"').click()");
        expect("document.querySelector('[data-page="+key+"]:not([hidden])')?.innerText.trim().length>10");
        expect("!document.querySelector('[data-page="+key+"]').innerText.includes('模块暂时无法打开')");
    }
    private void click(String selector)throws Exception{js("document.querySelector("+JSONObject.quote(selector)+").click()");}
    private void step(String s){trace.append(s).append("\n");Bundle out=new Bundle();out.putString("stream",s+"\n");sendStatus(1,out);}
    @Override public void onStart(){
        Bundle result=new Bundle();try{
            if(!Build.FINGERPRINT.contains("generic")&&!Build.MODEL.toLowerCase().contains("sdk")&&!Build.MODEL.toLowerCase().contains("emulator"))throw new Exception("Run on isolated QA emulator only");
            Context ctx=getTargetContext();Intent i=ctx.getPackageManager().getLaunchIntentForPackage(ctx.getPackageName());
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);activity=startActivitySync(i);waitForIdleSync();
            runOnMainSync(()->find(activity.getWindow().getDecorView(),"研究台",false).performClick());
            runOnMainSync(()->web=(WebView)find(activity.getWindow().getDecorView(),"",true));
            expect("window.ML_ANDROID&&window.MLMarkets?.snapshots.size>=3");
            expect("window.ML_DEVICE_BARS.length===3&&ML_DEVICE_BARS.every(m=>m.rows.length>=200)&&ML_DEVICE_NEWS.length>0");
            expect("ML_DEVICE_NEWS.some(n=>n.region==='cn')&&ML_DEVICE_NEWS.some(n=>n.region==='us')");
            step("Device cache: "+js("ML_DEVICE_BARS.map(m=>m.id+' '+m.rows.length+' through '+m.rows.at(-1).date).join(', ')")+"; news="+js("ML_DEVICE_NEWS.length"));
            for(String market:new String[]{"SP:SPX","NASDAQ:IXIC","CSI:000300"}){
                js("(()=>{let p=document.querySelector('#market-picker');p.value="+JSONObject.quote(market)+";p.onchange()})()");
                expect("window.MARKETLAB_DATA?.market.id==="+JSONObject.quote(market));}
            step("Market picker matches all three real index IDs");
            route("observe");expect("document.querySelector('#observe-module canvas')");js("[...document.querySelectorAll('#observe-module button')].find(b=>b.textContent==='保存到实验记录').click()");
            expect("JSON.parse(localStorage.getItem('ml.observe.runs.v1')).length>0");step("Observation saved");
            route("arena");expect("!document.querySelector('#workbench').hidden&&document.querySelector('#cutoff').options.length>1");
            js("(()=>{let p=document.querySelector('#cutoff');if(!p.disabled){p.selectedIndex=Math.floor(Math.random()*p.length);p.dispatchEvent(new Event('change'));}})()");
            Thread.sleep(600);js("document.querySelector('#probability').value=57;document.querySelector('#reason').value='Isolated emulator validation';document.querySelector('#lock').click()");
            expect("!document.querySelector('#results').hidden");click("#reveal");expect("document.querySelector('#outcome').innerText.length>6");step("Prediction locked and revealed");
            route("quant");click("#quant-module button[type=submit]");expect("JSON.parse(localStorage.getItem('ml.quant.runs.v1'))?.length>0");step("Quant experiment trained and saved");
            route("replay");js("document.querySelector('[data-r=length]').value=1");click("[data-r=begin]");expect("!document.querySelector('.replay-body').hidden");js("document.querySelector('[data-r=quantity]').value=1");click("[data-r=order]");click("[data-r=step]");expect("JSON.parse(localStorage.getItem('ml.replay.runs.v1'))?.length>0");step("Market replay order filled and session saved");
            route("macro");click("#macro-save");expect("JSON.parse(localStorage.getItem('ml.macro.runs.v1'))?.length>0");step("Macro scenarios saved");
            route("reports");expect("document.querySelector('[data-source=observe]')?.options.length>1");js("document.querySelectorAll('#reports-module select[data-source]').forEach(s=>{if(s.options.length>1)s.selectedIndex=1})");
            click("[data-report=create]");expect("!document.querySelector('[data-report=actions]').hidden");click("[data-report=json]");Thread.sleep(1600);step("Report created, waiting for tester to tap SAVE in Android file picker");
            long until=System.currentTimeMillis()+90000;AtomicBoolean focus=new AtomicBoolean();
            do{runOnMainSync(()->focus.set(activity.hasWindowFocus()));if(focus.get())break;Thread.sleep(350);}while(System.currentTimeMillis()<until);
            if(!focus.get())throw new Exception("File picker did not return; tap SAVE on the isolated emulator");
            Thread.sleep(1000);
            result.putString("stream","PASS\n"+trace);finish(Activity.RESULT_OK,result);
        }catch(Throwable error){result.putString("stream","FAIL "+error+"\n"+trace);finish(Activity.RESULT_CANCELED,result);}
    }
}
