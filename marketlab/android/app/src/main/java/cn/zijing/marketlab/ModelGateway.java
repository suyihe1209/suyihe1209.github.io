package cn.zijing.marketlab;

import java.io.IOException;
import java.net.URI;
import java.net.URLEncoder;
import java.util.*;
import org.json.*;
import static cn.zijing.marketlab.DataTools.*;

/** Routes and wire formats for model providers. No credentials are placed in URLs. */
final class ModelGateway {
    static final class Route {
        final String provider, endpoint, models;
        final boolean messages, googleModels, responses;
        Route(String provider,String endpoint,String models,boolean messages,boolean googleModels,boolean responses){
            this.provider=provider;this.endpoint=endpoint;this.models=models;this.messages=messages;this.googleModels=googleModels;this.responses=responses;
        }
        Map<String,String> headers(String key,boolean listing)throws IOException{
            if(key==null||key.trim().isEmpty()||key.matches("(?s).*[\\r\\n].*"))throw new IOException("请填写所选服务的 API Key。");
            Map<String,String> h=new LinkedHashMap<>();
            if(messages){h.put("x-api-key",key.trim());h.put("anthropic-version","2023-06-01");}
            else if(listing&&googleModels)h.put("x-goog-api-key",key.trim());
            else h.put("Authorization","Bearer "+key.trim());
            return h;
        }
    }
    static Route resolve(String selected,String address)throws IOException {
        String id=selected==null||selected.isEmpty()?"custom":selected;
        String input=address==null?"":address.trim();
        if(!id.equals("custom")&&input.isEmpty())input=ProviderCatalog.byId(id).baseUrl;
        URI uri;
        try{uri=new URI(input);}catch(Exception error){throw new IOException("服务地址格式有误。");}
        if(!"https".equalsIgnoreCase(uri.getScheme())||uri.getHost()==null||uri.getUserInfo()!=null||uri.getRawQuery()!=null||uri.getRawFragment()!=null
                || !uri.normalize().equals(uri) || uri.getRawPath().contains("%") || uri.getPort()==0 || uri.getPort()>65535)
            throw new IOException("请使用不含密钥、查询参数、跳转片段的公网 HTTPS 接口地址。");
        String host=uri.getHost().toLowerCase(Locale.ROOT);
        String origin="https://"+host+(uri.getPort()==-1?"":":"+uri.getPort());
        String path=uri.getPath().replaceAll("/+$","");
        String brand=null,defaultPath=null;
        for(ProviderCatalog.Entry entry:ProviderCatalog.ALL){
            if("custom".equals(entry.id))continue;
            URI official=URI.create(entry.baseUrl);
            if(host.equalsIgnoreCase(official.getHost())){
                if(brand==null || entry.id.equals(id)){
                    brand=entry.id;defaultPath=official.getPath().replaceAll("/+$","");
                }
            }
        }
        if(!id.equals("custom")&&(!id.equals(brand)||uri.getPort()!=-1&&uri.getPort()!=443))
            throw new IOException("预设密钥仅能发送给该服务的官方域名，自定义地址请单独配置。");
        if(path.isEmpty())path=defaultPath==null?"/v1":defaultPath;
        if(path.contains(":generateContent")||path.contains(":streamGenerateContent")||path.contains("/deployments/"))
            throw new IOException("当前地址属于另一种 API，请选对应官方预设，或填写兼容 Chat Completions 的基础地址。");
        String completion="/chat/completions",message="/messages";
        boolean responses=path.endsWith("/responses");
        boolean nativeMessages=!responses&&(path.endsWith(message)||"anthropic".equals(brand)&&!path.endsWith(completion));
        if(path.endsWith(completion))path=path.substring(0,path.length()-completion.length());
        else if(responses)path=path.substring(0,path.length()-"/responses".length());
        else if(path.endsWith(message))path=path.substring(0,path.length()-message.length());
        else if(path.endsWith("/models"))path=path.substring(0,path.length()-7);
        if(path.isEmpty()&&defaultPath!=null)path=defaultPath;
        if(path.endsWith(completion)||path.endsWith("/responses")||path.endsWith(message)||path.endsWith("/v1/v1")||path.endsWith("/chat"))
            throw new IOException("接口路径包含重复或不完整的后缀，请复制完整接口或基础地址。");
        if("gemini".equals(brand)){
            if(path.matches("/v1(?:beta)?"))path+="/openai";
            if(!path.matches("/v1(?:beta)?/openai"))throw new IOException("Gemini 服务请使用官方兼容路径 /v1beta/openai。");
        }
        String endpoint=origin+path+(responses?"/responses":nativeMessages?message:completion);
        boolean google="gemini".equals(brand);
        return new Route(brand==null?id:brand,endpoint,google?origin+"/v1beta/models":"mistral".equals(brand)?origin+"/v1/models":origin+path+"/models",nativeMessages,google,responses);
    }
    static boolean candidate(String model,JSONObject item){
        if(model.isEmpty() || model.length()>256 || model.matches("(?s).*[\\p{Cntrl}].*"))return false;
        JSONObject capabilities=item.optJSONObject("capabilities");
        if(capabilities!=null && (!capabilities.optBoolean("completion_chat",true)))return false;
        String id=model.toLowerCase(Locale.ROOT);
        // Exclude only clear non-chat families; absence of capabilities in a provider list implies no guarantee.
        return !id.matches(".*(?:^|[-_/.:])(?:embeddings?|embed|rerank(?:er)?|moderation|tts|asr|stt|whisper|transcribe|transcription|realtime|native-audio|audio|image|imagegen|imagen|video|veo|sora|lyria|music|dall-e|segment-anything)(?:$|[-_/.:]).*");
    }
    static List<String> ordered(Route route,SortedSet<String> available){
        LinkedHashSet<String> ordered=new LinkedHashSet<>();
        for(String known:ProviderCatalog.byId(route.provider).models)if(available.contains(known))ordered.add(known);
        ordered.addAll(available);return new ArrayList<>(ordered);
    }
    static String checkRoute(MarketConfig cfg)throws IOException{return resolve(cfg.providerId,cfg.baseUrl).endpoint;}
    static List<String> listModels(MarketConfig cfg)throws Exception{return listModels(resolve(cfg.providerId,cfg.baseUrl),cfg.key,NetAccess.LIVE);}
    static List<String> listModels(Route route,String key,NetAccess.Transport net)throws Exception{
        Map<String,String> headers=route.headers(key,true);
        TreeSet<String> ids=new TreeSet<>();Set<String> seen=new HashSet<>();String cursor="";
        for(int page=0;page<20;page++){
            String url=route.models;
            if(route.googleModels)url+="?pageSize=1000"+(cursor.isEmpty()?"":"&pageToken="+URLEncoder.encode(cursor,"UTF-8"));
            else if(route.messages)url+="?limit=100"+(cursor.isEmpty()?"":"&after_id="+URLEncoder.encode(cursor,"UTF-8"));
            String raw=net.model(url,headers,null);
            try{
                JSONObject envelope=new JSONObject(raw);JSONArray rows=envelope.getJSONArray(route.googleModels?"models":"data");
                for(int i=0;i<rows.length();i++){
                    JSONObject item=rows.getJSONObject(i);
                    String model;
                    if(route.googleModels){
                        JSONArray methods=item.optJSONArray("supportedGenerationMethods");boolean canGenerate=false;
                        if(methods!=null)for(int j=0;j<methods.length();j++)if("generateContent".equals(methods.optString(j)))canGenerate=true;
                        if(!canGenerate)continue;
                        model=item.getString("name").replaceFirst("^models/","");
                    }else{
                        if("retired".equals(item.optString("lifecycle")))continue;
                        model=item.getString("id");
                    }
                    if(candidate(model,item))ids.add(model);
                }
                cursor=route.googleModels?envelope.optString("nextPageToken",""):route.messages&&envelope.optBoolean("has_more")?envelope.getString("last_id"):"";
            }catch(JSONException invalid){throw new IOException("服务返回了无法识别的模型列表，请从该服务控制台复制模型 ID。");}
            if(cursor.isEmpty())return ordered(route,ids);
            if(cursor.length()>1400||!seen.add(cursor))throw new IOException("模型列表的分页回应无效。");
        }
        throw new IOException("模型列表过大，请从该服务控制台复制模型 ID。");
    }
    static final class Reply {
        final JSONObject history;final JSONArray calls;final String content;
        Reply(JSONObject history,JSONArray calls,String content){this.history=history;this.calls=calls;this.content=content;}
    }
    static final class Dialog {
        final Route route;final String model,system;final JSONArray messages;final JSONArray tools;
        Dialog(Route route,String model,String system,String question,JSONArray functions)throws JSONException{
            this(route,model,system,question,functions,arr());
        }
        Dialog(Route route,String model,String system,String question,JSONArray functions,JSONArray history)throws JSONException{
            this.route=route;this.model=model;this.system=system;
            messages=arr();if(!route.messages&&!route.responses)messages.put(obj("role","system","content",system));
            for (JSONObject turn : list(history)) {
                messages.put(obj("role","user","content",turn.getString("question")));
                messages.put(obj("role","assistant","content",turn.getString("answer")));
            }
            messages.put(obj("role","user","content",question));
            if(route.messages||route.responses){
                tools=arr();for(int i=0;i<functions.length();i++){
                    JSONObject fn=functions.getJSONObject(i).getJSONObject("function");
                    JSONObject translated=obj("name",fn.getString("name"),"description",fn.getString("description"));
                    if(route.messages)translated.put("input_schema",fn.getJSONObject("parameters"));
                    else translated.put("type","function").put("parameters",fn.getJSONObject("parameters")).put("strict",false);
                    tools.put(translated);
                }
            }else tools=functions;
        }
        JSONObject request(int round)throws JSONException{
            if(tools.length()==0){
                if(route.responses)return obj("model",model,"instructions",system,"input",messages,"store",false);
                JSONObject chat=obj("model",model,"messages",messages);
                if(route.messages)return chat.put("max_tokens",4096).put("system",system);
                return chat.put("stream",false);
            }
            if(route.responses)return obj("model",model,"instructions",system,"input",messages,"tools",tools,
                    "tool_choice",round==4?"none":"auto","store",false,"include",arr("reasoning.encrypted_content"));
            JSONObject request=obj("model",model,"messages",messages,"tools",tools);
            if(route.messages){
                // Current Claude reasoning models may only accept auto or none.
                return request.put("max_tokens",4096).put("system",system).put("tool_choice",obj("type",round==4?"none":"auto"));
            }
            // Auto is portable across thinking models (DeepSeek, Moonshot and Qwen included).
            // The research layer enforces actual tool evidence before displaying any answer.
            return request.put("tool_choice",round==4?"none":"auto").put("stream",false);
        }
        Reply decode(String raw)throws IOException{
            try{
                JSONObject envelope=new JSONObject(raw);
                if(route.responses){
                    String status=envelope.optString("status","completed");
                    if(!"completed".equals(status))throw new IOException("模型未完成本轮回答，请查看账户额度、模型可用性或缩短问题。");
                    JSONArray output=envelope.getJSONArray("output"),calls=arr();StringBuilder content=new StringBuilder();
                    for(int i=0;i<output.length();i++){
                        JSONObject item=output.getJSONObject(i);String type=item.getString("type");
                        if("function_call".equals(type))calls.put(obj("id",item.getString("call_id"),"type","function",
                                "function",obj("name",item.getString("name"),"arguments",item.getString("arguments"))));
                        if("message".equals(type))for(JSONObject part:list(item.getJSONArray("content")))
                            if("output_text".equals(part.optString("type")))content.append(part.getString("text"));
                    }
                    return new Reply(obj("output",output),calls,content.toString());
                }
                if(route.messages){
                    JSONArray blocks=envelope.getJSONArray("content"),calls=arr();StringBuilder content=new StringBuilder();
                    for(int i=0;i<blocks.length();i++){
                        JSONObject b=blocks.getJSONObject(i);String kind=b.getString("type");
                        if(kind.equals("text"))content.append(b.getString("text"));
                        if(kind.equals("tool_use"))calls.put(obj("id",b.getString("id"),"type","function","function",
                            obj("name",b.getString("name"),"arguments",b.getJSONObject("input").toString())));
                    }
                    // Preserve the complete set of original blocks, including signed thinking blocks.
                    return new Reply(obj("role","assistant","content",blocks),calls,content.toString());
                }
                JSONObject msg=envelope.getJSONArray("choices").getJSONObject(0).getJSONObject("message");
                JSONArray calls=msg.optJSONArray("tool_calls");
                if(calls==null)calls=arr();
                JSONObject history=obj("role","assistant","content",msg.isNull("content")?JSONObject.NULL:msg.get("content"));
                if(calls.length()>0)history.put("tool_calls",calls);
                // Preserve tool-call objects verbatim, including Gemini extra_content signatures.
                for(String field:Arrays.asList("reasoning_content","reasoning","reasoning_details","extra_content"))
                    if(msg.has(field)&&!msg.isNull(field))history.put(field,msg.get(field));
                Object body=msg.opt("content");
                StringBuilder text=new StringBuilder();
                if(body instanceof String)text.append((String)body);
                else if(body instanceof JSONArray)for(int i=0;i<((JSONArray)body).length();i++){
                    JSONObject part=((JSONArray)body).optJSONObject(i);
                    if(part!=null&&"text".equals(part.optString("type")))text.append(part.optString("text"));
                }
                return new Reply(history,calls,text.toString());
            }catch(JSONException invalid){throw new IOException("模型服务的回包与当前接口协议不匹配。请检查服务类型和模型 ID。");}
        }
        void results(Reply reply,JSONArray outputs)throws JSONException{
            if(route.responses){
                JSONArray output=reply.history.getJSONArray("output");
                for(int i=0;i<output.length();i++)messages.put(output.getJSONObject(i));
                for(int i=0;i<outputs.length();i++){
                    JSONObject result=outputs.getJSONObject(i);
                    messages.put(obj("type","function_call_output","call_id",result.getString("tool_call_id"),"output",result.getString("content")));
                }
                return;
            }
            messages.put(reply.history);
            if(route.messages){
                JSONArray blocks=arr();
                for(int i=0;i<outputs.length();i++){JSONObject result=outputs.getJSONObject(i);
                    blocks.put(obj("type","tool_result","tool_use_id",result.getString("tool_call_id"),"content",result.getString("content")));}
                messages.put(obj("role","user","content",blocks));
            }else for(int i=0;i<outputs.length();i++)messages.put(outputs.getJSONObject(i));
        }
    }
    private ModelGateway(){}
}
