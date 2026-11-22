package cn.zijing.marketlab;

import java.io.IOException;
import java.util.*;
import org.json.*;
import static cn.zijing.marketlab.DataTools.*;

/** Protocol-level regression tests. Nothing here contacts a model provider. */
public final class ProviderCheck {
    interface Attempt {void run()throws Exception;}
    static void check(boolean ok,String why){if(!ok)throw new AssertionError(why);}
    static void expect(Attempt fn,String why)throws Exception{
        try{fn.run();throw new AssertionError(why);}catch(IOException expected){}
    }
    static String openAI(JSONObject msg)throws Exception{return obj("choices",arr(obj("message",msg))).toString();}
    static JSONObject call(String id)throws Exception{return obj("id",id,"type","function","function",obj("name","market_bars","arguments","{\"id\":\"SP:SPX\"}"));}
    static final String KEY="fixture-credential-do-not-transmit",MODEL="fixture-model";
    static final JSONObject example()throws Exception{return obj("markets",arr(obj("id",LiveFeeds.SPX,"name","标普500","url","https://example.org/series","source","测试资料","date","2026-11-20","bars",arr(obj("date","2026-11-20","close",100)))));}
    static class Wire implements NetAccess.Transport {
        public String get(String ignored){throw new AssertionError("unexpected fetch");}
        public String model(String url,Map<String,String> h,String body)throws Exception{throw new AssertionError("unexpected model call");}
    }
    static void routing()throws Exception{
        for(ProviderCatalog.Entry e:ProviderCatalog.ALL){
            if("custom".equals(e.id))continue;
            ModelGateway.Route r=ModelGateway.resolve(e.id,e.baseUrl);
            String expected=e.baseUrl+(e.id.equals("anthropic")?"/messages":"/chat/completions");
            check(r.endpoint.equals(expected),e.id+" endpoint");
            check(ModelGateway.resolve(e.id,java.net.URI.create(e.baseUrl).getScheme()+"://"+java.net.URI.create(e.baseUrl).getHost()).endpoint.equals(expected),e.id+" host only");
            check(ModelGateway.resolve(e.id,expected+"/").endpoint.equals(expected),e.id+" full URL");
        }
        check(ModelGateway.resolve("custom","https://example.org/proxy/v2/chat/completions/").endpoint.equals("https://example.org/proxy/v2/chat/completions"),"preserve custom prefix");
        check(ModelGateway.resolve("custom","https://example.org/chat/completions").endpoint.equals("https://example.org/chat/completions"),"explicit unversioned endpoint");
        check(ModelGateway.resolve("custom","https://example.org").endpoint.equals("https://example.org/v1/chat/completions"),"bare compatible base");
        check(ModelGateway.resolve("custom","https://api.openai.com/v1/models").models.equals("https://api.openai.com/v1/models"),"model list pasted");
        check(ModelGateway.resolve("custom","https://example.org/v1/responses").responses,"explicit Responses route");
        check(ModelGateway.resolve("openai","https://api.openai.com/responses").endpoint.equals("https://api.openai.com/v1/responses"),"known unversioned Responses");
        expect(()->ModelGateway.resolve("custom","https://example.org/v1/responses/chat/completions"),"invalid mixed endpoints");
        expect(()->ModelGateway.resolve("openai","https://other.example/v1"),"no cross-host preset credentials");
        expect(()->ModelGateway.resolve("custom","https://example.org/v1/chat/completions/chat/completions"),"duplicated path");
        expect(()->ModelGateway.resolve("custom","https://example.org/v1?key="+KEY),"query credentials rejected");
    }
    static void wireLoop(ProviderCatalog.Entry preset)throws Exception{
        final boolean claude=preset.id.equals("anthropic"),google=preset.id.equals("gemini");
        final int[] n={0};String reasoning=String.join("",Collections.nCopies(1400,"history-part"));
        Wire wire=new Wire(){
            public String model(String url,Map<String,String> h,String body)throws Exception{
                n[0]++;check(!url.contains(KEY)&&!body.contains(KEY),"credential only in auth headers");
                JSONObject r=new JSONObject(body);check(r.getString("model").equals(MODEL),"model ID unchanged");
                String finalText=obj("answer","已查到指数收盘 [S1]。","citations",arr("S1")).toString();
                JSONArray msgs=r.getJSONArray("messages");
                if(claude){
                    check(url.endsWith("/v1/messages")&&KEY.equals(h.get("x-api-key"))&&"2023-06-01".equals(h.get("anthropic-version"))&&!h.containsKey("Authorization"),"native Claude auth");
                    check(r.getInt("max_tokens")>0 && r.has("system")&&"auto".equals(r.getJSONObject("tool_choice").getString("type")),"native Claude envelope");
                    if(n[0]==1){
                        check(msgs.length()==1&&r.getJSONArray("tools").getJSONObject(0).has("input_schema"),"Claude native tool definitions");
                        return obj("content",arr(obj("type","thinking","thinking","draft","signature","opaque-Claude"),obj("type","tool_use","id","toolu_1","name","market_bars","input",obj("id",LiveFeeds.SPX)),
                              obj("type","tool_use","id","toolu_2","name","market_bars","input",obj("id",LiveFeeds.SPX)))).toString();
                    }
                    JSONArray blocks=msgs.getJSONObject(1).getJSONArray("content");
                    check(blocks.length()==3 && blocks.getJSONObject(0).getString("signature").equals("opaque-Claude"),"Claude complete signed blocks");
                    JSONArray out=msgs.getJSONObject(2).getJSONArray("content");
                    check(out.length()==2&&out.getJSONObject(1).getString("tool_use_id").equals("toolu_2"),"Claude one user turn, two tool results");
                    return obj("content",arr(obj("type","text","text",finalText))).toString();
                }
                check(("Bearer "+KEY).equals(h.get("Authorization"))&&!h.containsKey("x-api-key"),"compatible auth");
                check("auto".equals(r.getString("tool_choice")),"thinking-mode-safe tool selection");
                if(n[0]==1){
                    JSONObject tc=call("call_1");if(google)tc.put("extra_content",obj("google",obj("thought_signature","opaque-Gemini")));
                    return openAI(obj("role","assistant","reasoning_content",reasoning,"tool_calls",arr(tc),"content",JSONObject.NULL));
                }
                JSONObject assistant=msgs.getJSONObject(2);
                check(assistant.getString("reasoning_content").equals(reasoning),"preserve full reasoning across call");
                if(google)check(assistant.getJSONArray("tool_calls").getJSONObject(0).getJSONObject("extra_content").getJSONObject("google").getString("thought_signature").equals("opaque-Gemini"),"Gemini thought signature");
                check(msgs.getJSONObject(3).getString("tool_call_id").equals("call_1"),"matching tool IDs");
                return openAI(obj("role","assistant","content",finalText));
            }
        };
        int[] count={0};
        JSONObject answer=ToolResearch.run("查询收盘",preset.id,preset.baseUrl,KEY,MODEL,ToolResearch.Mode.RESEARCH,arr(),ProviderCheck::example,wire,note->"unused",()->++count[0],0);
        check(n[0]==2&&count[0]==2&&answer.getJSONArray("sources").length()==1,preset.id+" end to end");
    }
    static void discovery()throws Exception{
        for(ProviderCatalog.Entry e:ProviderCatalog.ALL){
            if("custom".equals(e.id))continue;
            ModelGateway.Route route=ModelGateway.resolve(e.id,e.baseUrl);
            boolean g=e.id.equals("gemini"),a=e.id.equals("anthropic");int[] count={0};
            List<String> ids=ModelGateway.listModels(route,KEY,new Wire(){
                public String model(String uri,Map<String,String> h,String body)throws Exception{
                    count[0]++;check(body==null&&!uri.contains(KEY)&&uri.startsWith(route.models),"safe GET models");
                    if(g){
                        check(uri.startsWith("https://generativelanguage.googleapis.com/v1beta/models?")&&KEY.equals(h.get("x-goog-api-key")),"Google native list");
                        if(count[0]==1)return obj("models",arr(obj("name","models/home-a","supportedGenerationMethods",arr("generateContent")),obj("name","models/embed","supportedGenerationMethods",arr("embedContent")),obj("name","models/gemini-4-flash-tts","supportedGenerationMethods",arr("generateContent"))),"nextPageToken","a/b").toString();
                        check(uri.contains("pageToken=a%2Fb"),"Google correct next page");return obj("models",arr(obj("name","models/home-b","supportedGenerationMethods",arr("generateContent")))).toString();
                    }
                    if(a&&count[0]==1)return obj("data",arr(obj("id","home-a"),obj("id","retired","lifecycle","retired")),"has_more",true,"last_id","home-a").toString();
                    if(a)check(uri.contains("after_id=home-a"),"Claude correct cursor");
                    if(e.id.equals("mistral"))check(uri.equals("https://api.mistral.ai/v1/models"),"Mistral discovery origin");
                    return obj("data",arr(obj("id","home-b"),obj("id","gpt-image-1"),obj("id","text-embedding-3-small"),obj("id","x-no-tools","capabilities",obj("function_calling",false)))).toString();
                }
            });
            check(ids.equals(g?Arrays.asList("home-a","home-b"):a?Arrays.asList("home-a","home-b","x-no-tools"):Arrays.asList("home-b","x-no-tools")),"discovery "+e.id);
        }
        ModelGateway.Route r=ModelGateway.resolve("openai","https://api.openai.com");
        expect(()->ModelGateway.listModels(r,"",new Wire()),"no API key, no network");
        String poisoned=obj("error",obj("code","model_not_found","message","model was missing secret "+KEY)).toString();
        String diagnostic=NetAccess.modelError(404,poisoned,false).getMessage();
        check(!diagnostic.contains(KEY)&&diagnostic.contains("模型或接入点"),"safe diagnosis for 404 model");
        check(NetAccess.modelError(404,"<html>missing "+KEY+"</html>",false).getMessage().contains("实际接口地址"),"404 route");
        check(NetAccess.modelError(401,poisoned,true).getMessage().contains("API Key"),"401 authentication");
    }
    static void responses(String base)throws Exception{
        final ModelGateway.Route route=ModelGateway.resolve("custom",base);
        check(route.endpoint.equals(base)&&route.models.equals(base.replace("/responses","/models")),"explicit Responses + discovery");
        final int[] calls={0},charges={0};
        String opaque="opaque-encrypted-reasoning";
        Wire mock=new Wire(){
            public String model(String url,Map<String,String> headers,String body)throws Exception{
                JSONObject req=new JSONObject(body);JSONArray input=req.getJSONArray("input"),fn=req.getJSONArray("tools");
                check(url.equals(base)&&!req.getBoolean("store")&&!req.has("previous_response_id")&&!req.has("messages"),"stateless native Responses");
                check(req.getJSONArray("include").getString(0).equals("reasoning.encrypted_content")&&req.has("instructions"),"reasoning continuity");
                check(fn.getJSONObject(0).has("parameters")&&!fn.getJSONObject(0).has("function"),"flatten tool definition");
                if(++calls[0]==1){
                    return obj("status","completed","output",arr(obj("type","reasoning","id","rs_local","summary",arr(),"encrypted_content",opaque),
                        obj("type","function_call","id","fc_item","call_id","call_logical","name","market_bars","arguments",obj("id",LiveFeeds.SPX).toString()),
                        obj("type","function_call","id","fc_second","call_id","call_second","name","market_bars","arguments",obj("id",LiveFeeds.SPX).toString()))).toString();
                }
                check(input.length()==6&&opaque.equals(input.getJSONObject(1).getString("encrypted_content"))&&"fc_item".equals(input.getJSONObject(2).getString("id")),"preserve every original item in order");
                check("function_call_output".equals(input.getJSONObject(4).getString("type"))&&"call_logical".equals(input.getJSONObject(4).getString("call_id"))
                        &&"call_second".equals(input.getJSONObject(5).getString("call_id")),"logical call IDs paired");
                check(input.getJSONObject(4).getString("output").contains("S1"),"real tool result");
                return obj("status","completed","output",arr(obj("type","message","content",arr(obj("type","output_text","text",obj("answer","已验证 [S1]。","citations",arr("S1")).toString()))))).toString();
            }
        };
        JSONObject answer=ToolResearch.run("核验","custom",base,KEY,MODEL,ToolResearch.Mode.RESEARCH,arr(),ProviderCheck::example,mock,n->"",()->++charges[0],0);
        check(answer.getInt("used")==2&&charges[0]==2&&calls[0]==2,"Responses exact charging");
        ModelGateway.Dialog dlg=new ModelGateway.Dialog(route,MODEL,"test","test",ToolResearch.tools());
        expect(()->dlg.decode(obj("status","incomplete","output",arr()).toString()),"recognize unfinished Responses");
        expect(()->dlg.decode(obj("status","completed","output",arr(obj("type","function_call","id","fc_without_call_id"))).toString()),"reject missing logical call ID");
        int[] limited={0};Wire repeated=new Wire(){
            int count=0;
            public String model(String url,Map<String,String> h,String body)throws Exception{
                return obj("status","completed","output",arr(obj("type","function_call","call_id","id_"+(++count),"name","market_bars","arguments",obj("id",LiveFeeds.SPX).toString()))).toString();
            }
        };
        JSONObject ended=ToolResearch.run("核验","custom",base,KEY,MODEL,ToolResearch.Mode.RESEARCH,arr(),ProviderCheck::example,repeated,n->"",()->++limited[0],0);
        check(limited[0]==2 && ended.getString("answer").contains("100"),"duplicate calls stop with verified facts");

    }
    public static void main(String[] args)throws Exception{
        routing();discovery();
        responses("https://api.openai.com/v1/responses");responses("https://example.org/custom/prefix/responses");
        String preferred=ProviderCatalog.byId("openai").models[0];
        ModelGateway.Route route=ModelGateway.resolve("openai","https://api.openai.com");
        check(ModelGateway.ordered(route,new TreeSet<>(Arrays.asList("a-unknown",preferred))).get(0).equals(preferred),"known account-visible models first");
        for(ProviderCatalog.Entry e:ProviderCatalog.ALL)if(!e.id.equals("custom"))wireLoop(e);
        System.out.println("PASS: all "+(ProviderCatalog.ALL.length-1)+" preset request routes + native stateless Responses, authenticated discovery, paginated Claude and Gemini, real protocol-shaped tool loops, signed/opaque history, custom paths and safe 404s. No model provider contacted.");
    }
}
