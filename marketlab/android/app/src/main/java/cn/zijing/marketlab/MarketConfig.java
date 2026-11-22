package cn.zijing.marketlab;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import org.json.JSONObject;
import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

public final class MarketConfig {
    public String providerId = "custom", baseUrl = "", model = "", key = "";
    private static final String ALIAS = "MarketLab.model.profile.v1";
    public boolean ready(){return !baseUrl.isEmpty() && !model.isEmpty() && !key.isEmpty();}
    private static SharedPreferences prefs(Context c){return c.getSharedPreferences("model",Context.MODE_PRIVATE);}
    private static synchronized SecretKey secret(boolean create) throws Exception {
        KeyStore ks=KeyStore.getInstance("AndroidKeyStore"); ks.load(null);
        if(ks.containsAlias(ALIAS))return (SecretKey)ks.getKey(ALIAS,null);
        if(!create)throw new IllegalStateException("原有加密密钥不可用，请重新保存模型配置。");
        KeyGenerator gen=KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES,"AndroidKeyStore");
        gen.init(new KeyGenParameterSpec.Builder(ALIAS,KeyProperties.PURPOSE_ENCRYPT|KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build());
        return gen.generateKey();
    }
    static JSONObject fromLegacy(JSONObject json) throws Exception {
        String original = json.getString("url");
        String id = ProviderCatalog.legacyId(original);
        String url = id.equals("custom") ? original : ProviderCatalog.byId(id).baseUrl;
        JSONObject profile=new JSONObject().put("url",url).put("model",json.getString("model")).put("key",json.getString("key"));
        return new JSONObject().put("version",2).put("active",id)
            .put("profiles",new JSONObject().put(id,profile));
    }
    private static JSONObject store(Context c) throws Exception {
        SharedPreferences p=prefs(c);
        if(!p.contains("blob"))return new JSONObject().put("version",2).put("active","openai").put("profiles",new JSONObject());
        Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE,secret(false),new GCMParameterSpec(128,Base64.decode(p.getString("nonce",""),Base64.NO_WRAP)));
        JSONObject json=new JSONObject(new String(cipher.doFinal(Base64.decode(p.getString("blob",""),Base64.NO_WRAP)),"UTF-8"));
        if(!json.has("version"))return fromLegacy(json);
        if(json.getInt("version")!=2)throw new IllegalStateException("模型配置版本不受支持。");
        return json;
    }
    static MarketConfig profile(JSONObject store,String id) throws Exception {
        MarketConfig cfg=new MarketConfig();ProviderCatalog.Entry entry=ProviderCatalog.byId(id);
        cfg.providerId=id;cfg.baseUrl=entry.baseUrl;
        JSONObject saved=store.getJSONObject("profiles").optJSONObject(id);
        if(saved!=null){
            cfg.baseUrl=saved.getString("url");cfg.model=saved.getString("model");cfg.key=saved.getString("key");
        }
        cfg.validate();return cfg;
    }
    static synchronized MarketConfig read(Context c) throws Exception {
        JSONObject saved=store(c);return profile(saved,saved.getString("active"));
    }
    static synchronized MarketConfig read(Context c,String id) throws Exception {return profile(store(c),id);}
    void validate(){
        ProviderCatalog.Entry entry=ProviderCatalog.byId(providerId);
        if(!baseUrl.isEmpty())ProviderCatalog.canonicalUrl(baseUrl);
        if(!entry.id.equals("custom")&&!ProviderCatalog.sameRoute(baseUrl,entry.baseUrl))
            throw new IllegalArgumentException("当前地址与所选品牌不符。");
        if(!key.isEmpty()&&!ready())throw new IllegalArgumentException("请填写服务地址和模型 ID。");
    }
    String useKey(String entered,String url){
        if(!entered.isEmpty())return entered;
        if(key.isEmpty()||ProviderCatalog.sameRoute(url,baseUrl))return key;
        throw new IllegalArgumentException("接口地址已改变，请重新输入该地址对应的 API Key。");
    }
    static void putProfile(JSONObject store,MarketConfig cfg) throws Exception {
        cfg.validate();
        store.remove("limit");
        store.put("active",cfg.providerId);
        store.getJSONObject("profiles").put(cfg.providerId,new JSONObject().put("url",cfg.baseUrl).put("model",cfg.model).put("key",cfg.key));
    }
    void save(Context c) throws Exception {
        synchronized(MarketConfig.class){
            JSONObject saved=store(c);putProfile(saved,this);persist(c,saved);
        }
    }
    private static void persist(Context c,JSONObject json) throws Exception {
        Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.ENCRYPT_MODE,secret(true));
        String blob=Base64.encodeToString(cipher.doFinal(json.toString().getBytes("UTF-8")),Base64.NO_WRAP);
        if(!prefs(c).edit().putString("blob",blob).putString("nonce",Base64.encodeToString(cipher.getIV(),Base64.NO_WRAP)).commit())
            throw new IllegalStateException("设备未能保存配置。");
    }
    static synchronized boolean remove(Context c,String id) throws Exception {
        JSONObject data=store(c);data.getJSONObject("profiles").remove(ProviderCatalog.byId(id).id);persist(c,data);
        return data.getString("active").equals(id);
    }
    static synchronized void clear(Context c) throws Exception {
        if(!prefs(c).edit().clear().commit())throw new IllegalStateException("未能清除配置。");
        KeyStore ks=KeyStore.getInstance("AndroidKeyStore");ks.load(null);if(ks.containsAlias(ALIAS))ks.deleteEntry(ALIAS);
    }
}
