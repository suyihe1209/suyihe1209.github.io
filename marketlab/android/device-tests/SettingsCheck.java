package cn.zijing.marketlab.qa;

import android.app.*;
import android.content.*;
import android.os.*;
import android.view.*;
import android.widget.*;
import android.util.Base64;
import android.security.keystore.*;
import javax.crypto.*;
import javax.crypto.spec.GCMParameterSpec;
import org.json.JSONObject;
import java.security.KeyStore;
import java.util.*;

/** Run only on a fresh, disposable emulator. Does not contact any model service. */
public final class SettingsCheck extends Instrumentation {
    Activity activity;
    @Override public void onCreate(Bundle args){super.onCreate(args);start();}
    private List<View> views(){
        List<View> result=new ArrayList<>();collect(activity.getWindow().getDecorView(),result);return result;
    }
    private void collect(View v,List<View> all){
        if(v.getVisibility()!=View.VISIBLE)return;all.add(v);
        if(v instanceof ViewGroup)for(int i=0;i<((ViewGroup)v).getChildCount();i++)collect(((ViewGroup)v).getChildAt(i),all);
    }
    private View text(String label){
        for(View v:views())if(v instanceof TextView&&((TextView)v).getText().toString().equals(label))return v;
        throw new AssertionError("Missing control: "+label);
    }
    private EditText field(String label){
        TextView l=(TextView)text(label);return activity.findViewById(l.getLabelFor());
    }
    private Spinner list(String description){
        for(View v:views())if(v instanceof Spinner&&description.contentEquals(v.getContentDescription()==null?"":v.getContentDescription()))return (Spinner)v;
        throw new AssertionError("Missing selector: "+description);
    }
    private void select(String control,String option){
        onUi(()->{Spinner s=list(control);for(int i=0;i<s.getCount();i++)if(s.getItemAtPosition(i).toString().equals(option)){s.setSelection(i);return;}
            throw new AssertionError("Missing option: "+option);});
    }
    private void onUi(Runnable r){
        final Throwable[] problem={null};runOnMainSync(()->{try{r.run();}catch(Throwable t){problem[0]=t;}});
        waitForIdleSync();SystemClock.sleep(110);
        if(problem[0]!=null)throw new AssertionError(problem[0]);
    }
    private static void ok(boolean state,String detail){if(!state)throw new AssertionError(detail);}
    private void click(String label){onUi(()->text(label).performClick());}
    private void launch(Context ctx){
        Intent intent=ctx.getPackageManager().getLaunchIntentForPackage(ctx.getPackageName());
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);activity=startActivitySync(intent);waitForIdleSync();click("设置");
    }
    private JSONObject decrypt(SharedPreferences p,SecretKey key)throws Exception{
        Cipher c=Cipher.getInstance("AES/GCM/NoPadding");c.init(Cipher.DECRYPT_MODE,key,new GCMParameterSpec(128,Base64.decode(p.getString("nonce",""),Base64.NO_WRAP)));
        return new JSONObject(new String(c.doFinal(Base64.decode(p.getString("blob",""),Base64.NO_WRAP)),"UTF-8"));
    }
    @Override public void onStart(){
        Bundle result=new Bundle();Context ctx=getTargetContext();SharedPreferences p=ctx.getSharedPreferences("model",Context.MODE_PRIVATE);
        String alias="MarketLab.model.profile.v1";boolean managed=false;
        try{
            String device=Build.MODEL.toLowerCase(Locale.ROOT);
            if(!device.contains("sdk")&&!device.contains("emulator")&&!Build.FINGERPRINT.contains("generic"))throw new AssertionError("Only use an isolated emulator");
            KeyStore store=KeyStore.getInstance("AndroidKeyStore");store.load(null);
            if(p.contains("blob")||store.containsAlias(alias))throw new AssertionError("Use a fresh test emulator without any saved model credentials");
            KeyGenerator g=KeyGenerator.getInstance("AES","AndroidKeyStore");g.init(new KeyGenParameterSpec.Builder(alias,KeyProperties.PURPOSE_ENCRYPT|KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build());SecretKey key=g.generateKey();managed=true;
            Cipher enc=Cipher.getInstance("AES/GCM/NoPadding");enc.init(Cipher.ENCRYPT_MODE,key);
            JSONObject old=new JSONObject().put("url","https://api.openai.com/v1").put("model","my-legacy-model-id").put("key","qa-openai-only").put("limit",13);
            p.edit().putString("blob",Base64.encodeToString(enc.doFinal(old.toString().getBytes("UTF-8")),Base64.NO_WRAP))
                .putString("nonce",Base64.encodeToString(enc.getIV(),Base64.NO_WRAP)).commit();
            launch(ctx);
            onUi(()->{
                ok(list("服务品牌").getCount()==15,"provider count");
                ok(list("模型").getSelectedItem().toString().equals("my-legacy-model-id"),"unsuggested legacy model");
                ok(field("API Key").getHint().toString().contains("已保存"),"legacy key");
                ok(views().stream().noneMatch(v->v instanceof TextView && "每日模型请求上限".contentEquals(((TextView)v).getText())),"old daily limit removed");
            });
            select("服务品牌","字节跳动 · 豆包");
            onUi(()->{
                ok(field("官方接口地址").getText().toString().endsWith(".volces.com/api/v3"),"Ark address");
                ok(!field("API Key").getHint().toString().contains("已保存"),"cross-provider key");
                List<View> controls=views();ok(controls.indexOf(list("服务品牌"))<controls.indexOf(field("官方接口地址"))
                    &&controls.indexOf(field("官方接口地址"))<controls.indexOf(list("模型"))
                    &&controls.indexOf(list("模型"))<controls.indexOf(field("API Key")),"control order");
            });
            select("模型","手动填写模型 / 接入点 ID");
            onUi(()->{field("模型或接入点 ID").setText("ep-qa-private");field("API Key").setText("qa-ark-only");});
            click("保存设置");
            JSONObject data=decrypt(p,key);
            ok(data.getString("active").equals("ark")&&!data.has("limit"),"stored selection");
            ok(data.getJSONObject("profiles").getJSONObject("ark").getString("model").equals("ep-qa-private"),"Ark manual endpoint");
            ok(data.getJSONObject("profiles").getJSONObject("openai").getString("key").equals("qa-openai-only"),"preserved older key");
            select("服务品牌","OpenAI · GPT");onUi(()->ok(field("API Key").getHint().toString().contains("已保存"),"switch back"));
            select("服务品牌","自定义兼容服务");
            onUi(()->{field("服务接口地址").setText("https://one.example/v1");field("模型或接入点 ID").setText("custom-deployment");field("API Key").setText("qa-custom-only");});
            click("保存设置");
            onUi(()->{field("服务接口地址").setText("https://two.example/v1");
                ok(field("API Key").getText().length()==0&&!field("API Key").getHint().toString().contains("已保存"),"host switch");});
            click("保存设置");
            ok(decrypt(p,key).getJSONObject("profiles").getJSONObject("custom").getString("url").equals("https://one.example/v1"),"saving a changed host without a new key was refused");
            result.putString("stream","PASS: displayed old encrypted profile, selected all settings in order, saved Ark manual endpoint, restored per-brand key and enforced custom endpoint isolation.");
            finish(Activity.RESULT_OK,result);
        }catch(Throwable ex){result.putString("stream","FAIL "+ex);finish(Activity.RESULT_CANCELED,result);}
        finally{if(managed)try{p.edit().clear().commit();KeyStore store=KeyStore.getInstance("AndroidKeyStore");store.load(null);store.deleteEntry(alias);}catch(Exception ignored){}}
    }
}
