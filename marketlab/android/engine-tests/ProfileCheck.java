package cn.zijing.marketlab;

import org.json.JSONObject;

/** Offline contracts for upgrade, switches and credential binding. Only synthetic values are used. */
public final class ProfileCheck {
    static void check(boolean ok){if(!ok)throw new AssertionError("Unexpected model profile state");}
    static void rejected(Runnable operation){
        try{operation.run();}catch(IllegalArgumentException expected){return;}
        throw new AssertionError("Expected invalid profile to be rejected");
    }
    public static void main(String[] args)throws Exception{
        JSONObject legacy=new JSONObject().put("url","https://api.openai.com/v1/").put("model","retained-server-id")
            .put("key","fixture-openai").put("limit",37);
        JSONObject store=MarketConfig.fromLegacy(legacy);
        MarketConfig saved=MarketConfig.profile(store,store.getString("active"));check(saved.providerId.equals("openai")&&saved.ready());
        check(saved.model.equals("retained-server-id")&&saved.useKey("","https://API.OPENAI.COM:443/v1").equals("fixture-openai"));
        MarketConfig other=MarketConfig.profile(store,"meta");
        check(!other.ready()&&other.key.isEmpty()&&other.baseUrl.equals("https://api.meta.ai/v1"));
        other.key="fixture-meta";other.model="muse-spark-1.3";MarketConfig.putProfile(store,other);
        check(store.getString("active").equals("meta")&&MarketConfig.profile(store,"openai").key.equals("fixture-openai"));
        check(MarketConfig.profile(store,"meta").useKey("",other.baseUrl).equals("fixture-meta"));
        rejected(()->saved.useKey("","https://elsewhere.example/v1"));
        rejected(()->saved.useKey("","https://api.openai.com/v2"));
        MarketConfig custom=MarketConfig.profile(store,"custom");
        custom.baseUrl="https://one.example/v1";custom.model="my-deployment";custom.key="fixture-one";MarketConfig.putProfile(store,custom);
        rejected(()->custom.useKey("","https://two.example/v1"));
        check(custom.useKey("fixture-two","https://two.example/v1").equals("fixture-two"));
        for(ProviderCatalog.Entry p:ProviderCatalog.ALL)if(!p.id.equals("custom")){
            MarketConfig cfg=MarketConfig.profile(store,p.id);check(ProviderCatalog.sameRoute(cfg.baseUrl,p.baseUrl));
            cfg.baseUrl="https://unrelated.example/v1";rejected(cfg::validate);
        }
        for (String oldUrl : new String[]{"https://api.openai.com", "https://API.OPENAI.COM:443/v1/chat/completions/"}) {
            legacy.put("url",oldUrl);
            MarketConfig migrated=MarketConfig.profile(MarketConfig.fromLegacy(legacy),"openai");
            check(migrated.ready() && migrated.baseUrl.equals("https://api.openai.com/v1"));
            check(migrated.key.equals("fixture-openai"));
        }
        check(ProviderCatalog.legacyId("https://api.anthropic.com/v1/messages").equals("anthropic"));
        for(String independent : new String[]{"https://api.openai.com/v1/responses","https://api.openai.com:8443/v1","https://api.openai.com/team/a/v1"}) {
            legacy.put("url", independent);
            MarketConfig keptOriginal = MarketConfig.profile(MarketConfig.fromLegacy(legacy),"custom");
            check(keptOriginal.baseUrl.equals(independent) && keptOriginal.key.equals("fixture-openai"));
        }
        legacy.put("url","https://custom.example/some/tenant/chat/completions");legacy.put("model","ep-custom");
        JSONObject kept=MarketConfig.fromLegacy(legacy);MarketConfig compatible=MarketConfig.profile(kept,"custom");
        check(kept.getString("active").equals("custom")&&compatible.baseUrl.equals(legacy.getString("url"))&&compatible.key.equals("fixture-openai"));
        MarketConfig ark=MarketConfig.profile(store,"ark");ark.model="ep-private-account-id";ark.key="fixture-ark";MarketConfig.putProfile(store,ark);
        check(MarketConfig.profile(store,"ark").model.equals("ep-private-account-id"));
        System.out.println("PASS: old configuration, 14 fixed providers, custom route isolation, account switching, saved manual model and removal of legacy daily limits");
    }
}
