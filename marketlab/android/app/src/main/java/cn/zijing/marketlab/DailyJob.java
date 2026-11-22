package cn.zijing.marketlab;

import android.app.job.*;
import android.content.*;
import java.time.*;
import java.util.concurrent.*;
import org.json.*;

public final class DailyJob extends JobService {
    static final ExecutorService WORK=Executors.newSingleThreadExecutor();
    private static final int A=48101, B=48102;
    static android.content.SharedPreferences prefs(Context c){return c.getSharedPreferences("daily",Context.MODE_PRIVATE);}
    static int hour(Context c){return prefs(c).getInt("hour",8);}
    static long latestDue(Context c){
        ZonedDateTime now=ZonedDateTime.now(),today=now.toLocalDate().atTime(hour(c),0).atZone(now.getZone());
        return (now.isBefore(today)?today.minusDays(1):today).toInstant().toEpochMilli();
    }
    static void plan(Context c,boolean replace){schedule(c,replace,0);}
    private static void schedule(Context c,boolean replace,int completing){
        JobScheduler scheduler=(JobScheduler)c.getSystemService(JOB_SCHEDULER_SERVICE);
        if(!prefs(c).getBoolean("auto",true)){scheduler.cancel(A);scheduler.cancel(B);return;}
        if(!replace&&(scheduler.getPendingJob(A)!=null||scheduler.getPendingJob(B)!=null))return;
        if(replace&&completing==0){scheduler.cancel(A);scheduler.cancel(B);}
        long now=System.currentTimeMillis(), due=latestDue(c), done=prefs(c).getLong("success",0);
        long next=done<due||briefDue(c)?now+5000:Instant.ofEpochMilli(due).atZone(ZoneId.systemDefault()).plusDays(1).toInstant().toEpochMilli();
        int id=completing==A?B:A;
        scheduler.schedule(new JobInfo.Builder(id,new ComponentName(c,DailyJob.class))
          .setPersisted(true).setMinimumLatency(Math.max(1000,next-now)).setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
          .setBackoffCriteria(30*60*1000L,JobInfo.BACKOFF_POLICY_EXPONENTIAL).build());
    }
    private static boolean briefDue(Context c){
        String period=Instant.ofEpochMilli(latestDue(c)).atZone(ZoneId.systemDefault()).toLocalDate().toString();
        return prefs(c).getBoolean("brief",false)&&!period.equals(prefs(c).getString("briefAttempt",""));
    }
    static JSONObject refresh(Context c,boolean allowBrief) throws Exception {
        JSONObject data=ResearchEngine.refresh(c);
        boolean complete=data.optBoolean("complete",false);
        prefs(c).edit().putString("lastStatus",complete?"采集成功":"部分来源未更新").apply();
        if(complete)prefs(c).edit().putLong("success",System.currentTimeMillis()).apply();
        if(allowBrief&&complete)dailyBrief(c);
        return data;
    }
    private static void dailyBrief(Context c) throws Exception {
        if(briefDue(c)) {
            final String day=Instant.ofEpochMilli(latestDue(c)).atZone(ZoneId.systemDefault()).toLocalDate().toString();
            MarketConfig cfg=MarketConfig.read(c);
            if(cfg.ready()&&!day.equals(prefs(c).getString("briefAttempt",""))) {
                prefs(c).edit().putString("briefAttempt",day).commit();
                try {
                    JSONObject answer=ResearchEngine.ask(c,"请根据中国和美国最新已收盘指数行情与今天已核实的官方消息，给出中文研究简报。逐项注明实际日期和来源，缺项明确标出。",cfg,false);
                    prefs(c).edit().putString("briefResult",answer.toString()).putString("briefStatus","").apply();
                }catch(Exception failure){prefs(c).edit().putString("briefStatus","本次自动简报未生成，检查配置或额度后可手动提问。").apply();}
            }
        }
    }
    private Future<?> running;
    @Override public boolean onStartJob(JobParameters params){
        running=WORK.submit(()->{
            boolean retry=true;
            try{
                if(prefs(this).getBoolean("auto",true)) {
                    if(prefs(this).getLong("success",0)<latestDue(this)){
                        retry=!refresh(this,true).optBoolean("complete",false);
                    }else {dailyBrief(this);retry=false;}
                }else retry=false;
            }catch(Exception ignored){prefs(this).edit().putString("lastStatus","后台采集未完成，将在联网后重试。").apply();}
            boolean again=retry;
            if(!Thread.currentThread().isInterrupted())new android.os.Handler(getMainLooper()).post(()->{
                jobFinished(params,again);if(!again)schedule(this,true,params.getJobId());
            });
        });return true;
    }
    @Override public boolean onStopJob(JobParameters p){if(running!=null)running.cancel(true);return true;}
}
