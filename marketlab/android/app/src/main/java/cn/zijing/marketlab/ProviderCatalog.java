package cn.zijing.marketlab;

import java.net.URI;
import java.util.Locale;

/** Presets only point to first-party inference services. Model availability belongs to the user's account. */
final class ProviderCatalog {
    static final class Entry {
        final String id, name, baseUrl, docs, note;
        final String[] models;
        Entry(String id,String name,String baseUrl,String docs,String note,String... models){
            this.id=id;this.name=name;this.baseUrl=baseUrl;this.docs=docs;this.note=note;this.models=models;
        }
        @Override public String toString(){return name;}
    }
    static final Entry[] ALL={
        new Entry("openai","OpenAI · GPT","https://api.openai.com/v1","https://developers.openai.com/api/docs/models/","使用 OpenAI 开发者平台项目的 API Key。","gpt-5.4-mini","gpt-5.4"),
        new Entry("anthropic","Anthropic · Claude","https://api.anthropic.com/v1","https://platform.claude.com/docs/en/api/messages","使用 Claude Console 工作区签发的 API Key；通过原生 Messages 接口调用。","claude-sonnet-5-5","claude-sonnet-4-6"),
        new Entry("gemini","Google · Gemini","https://generativelanguage.googleapis.com/v1beta/openai","https://ai.google.dev/gemini-api/docs/openai","使用 Gemini Developer API 的密钥，并选支持函数调用的文本模型。","gemini-3.5-flash"),
        new Entry("xai","xAI · Grok","https://api.x.ai/v1","https://docs.x.ai/developers/rest-api-reference/inference/chat-completions","使用 xAI 推理密钥。此服务通过官方 Chat Completions 接口连接。","grok-4.7"),
        new Entry("mistral","Mistral AI","https://api.mistral.ai/openai/v1","https://docs.mistral.ai/inference/conversations/chat-completion","使用 Mistral 的官方 OpenAI 兼容接口，当前为公开预览。","mistral-small-latest","mistral-large-latest"),
        new Entry("meta","Meta · Muse","https://api.meta.ai/v1","https://dev.meta.ai/docs/overview","使用 Meta Model API 密钥；预设为标准模式。选择 Contributor 模型前请查阅官方资料使用条款。","muse-spark-1.3","muse-wonder-1.0"),
        new Entry("deepseek","DeepSeek · 深度求索","https://api.deepseek.com/v1","https://api-docs.deepseek.com/","使用 DeepSeek 开放平台密钥。","deepseek-flash","deepseek-v4-pro"),
        new Entry("moonshot","月之暗面 · Kimi","https://api.moonshot.cn/v1","https://platform.kimi.com/docs/get-api-key","使用 Kimi 国内站 API 密钥。国际站可在自定义服务中填写对应地址。","kimi-k3.1-pro","kimi-k3.1-pro-highspeed"),
        new Entry("ark","字节跳动 · 豆包","https://ark.cn-beijing.volces.com/api/v3","https://docs.volcengine.com/docs/ark/models-api?lang=zh","使用火山方舟北京地域 API Key。可选择已开通的模型，或手动填写控制台的 ep- 推理接入点 ID。","doubao-seed-evolving"),
        new Entry("qwen","阿里云 · 通义千问","https://dashscope.aliyuncs.com/compatible-mode/v1","https://help.aliyun.com/zh/model-studio/compatibility-of-openai-with-dashscope","预填百炼北京公共地址，须配北京地域密钥。使用业务空间专属域名或其他地域时请选择自定义服务。","qwen-plus","qwen4-max"),
        new Entry("glm","智谱 · GLM","https://open.bigmodel.cn/api/paas/v4","https://docs.bigmodel.cn/cn/guide/capabilities/function-calling","使用智谱开放平台按量 API Key。此地址与单独订阅的 Coding Plan 不同。","glm-5.3"),
        new Entry("minimax","MiniMax · 稀宇科技","https://api.minimax.cn/v1","https://platform.minimax.cn/docs/api-reference/text-openai-api","使用 MiniMax 中国站密钥和兼容接口。国际站或特定套餐请核对自己的服务地址。","MiniMax-M3.1-Flash","MiniMax-M3"),
        new Entry("baidu","百度千帆 · 文心","https://qianfan.baidubce.com/v2","https://cloud.baidu.com/doc/qianfan-api/s/wmwbl48n4","使用千帆 V2 API Key。自部署模型请输入控制台列出的 API 名称。","ernie-5.1","ernie-5.5-flash-preview"),
        new Entry("tencent","腾讯 TokenHub · 混元","https://tokenhub.tencentmaas.com/v1","https://cloud.tencent.com/document/product/1823/132252","使用腾讯云 TokenHub 的 API Key。账户还可查询平台提供的其他模型。","hy4-flash","hy4"),
        new Entry("custom","自定义兼容服务","","","可填写服务方给出的 HTTPS 基础地址，或完整的 Chat Completions、Responses 接口。请选择支持函数调用的模型。")
    };
    static Entry byId(String id){
        for(Entry entry:ALL)if(entry.id.equals(id))return entry;
        throw new IllegalArgumentException("未知的服务品牌。");
    }
    static String canonicalUrl(String value){
        try{
            URI uri=new URI(value.trim());
            if(!"https".equalsIgnoreCase(uri.getScheme())||uri.getHost()==null||uri.getUserInfo()!=null||
                uri.getRawQuery()!=null||uri.getRawFragment()!=null||uri.getPort()==0||uri.getPort()>65535||
                !uri.normalize().equals(uri))throw new IllegalArgumentException();
            String host=uri.getHost().toLowerCase(Locale.ROOT);
            String port=uri.getPort()<0||uri.getPort()==443?"":":"+uri.getPort();
            return "https://"+host+port+uri.getRawPath().replaceAll("/+$","");
        }catch(Exception ex){throw new IllegalArgumentException("请填写有效的 HTTPS 服务地址。");}
    }
    static boolean sameRoute(String a,String b){
        if(a==null||b==null||a.isEmpty()||b.isEmpty())return false;
        try{return canonicalUrl(a).equals(canonicalUrl(b));}catch(IllegalArgumentException ex){return false;}
    }
    static String legacyId(String url){
        for (Entry entry : ALL) {
            if (entry.baseUrl.isEmpty()) continue;
            String officialOrigin = URI.create(entry.baseUrl).resolve("/").toString();
            String operation = entry.id.equals("anthropic") ? "/messages" : "/chat/completions";
            if (sameRoute(url, officialOrigin) || sameRoute(url, entry.baseUrl)
                    || sameRoute(url, entry.baseUrl + operation)) return entry.id;
        }
        // A tenant path or an explicitly selected alternate protocol belongs to the original endpoint.
        return "custom";
    }
    private ProviderCatalog(){}
}
