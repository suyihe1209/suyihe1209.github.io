package cn.zijing.marketlab;
import android.content.*;
public final class ClockChanged extends BroadcastReceiver {
    @Override public void onReceive(Context c,Intent i){DailyJob.plan(c,true);}
}
