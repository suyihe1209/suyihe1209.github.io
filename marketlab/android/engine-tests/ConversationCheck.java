package cn.zijing.marketlab;

import java.util.Map;
import org.json.*;
import static cn.zijing.marketlab.DataTools.*;
import static cn.zijing.marketlab.ProviderCheck.*;

public final class ConversationCheck {
    static JSONObject ask(String question, JSONArray history, String... replies)throws Exception {
        int[] step={0}, loads={0};
        ToolResearch.Mode mode=ToolResearch.mode(question,history);
        return ToolResearch.run(question,"custom","https://example.org/v1",KEY,MODEL,mode,history,
            ()->{loads[0]++;return example();}, new Wire(){
                public String model(String url, Map<String,String> auth,String body)throws Exception{
                    JSONObject request=new JSONObject(body);
                    if(mode==ToolResearch.Mode.CHAT)check(!request.has("tools") && loads[0]==0,"chat bypasses quotes");
                    if(history.length()>0 && step[0]==0){
                        JSONArray m=request.getJSONArray("messages");
                        check(m.getJSONObject(1).getString("content").equals(history.getJSONObject(0).getString("question")),"previous question");
                        check(m.getJSONObject(2).getString("content").equals(history.getJSONObject(0).getString("answer")),"previous answer");
                    }
                    String reply=replies[step[0]++];
                    return openAI(reply.equals("CALL")?obj("role","assistant","tool_calls",arr(call("q"+step[0]))):obj("role","assistant","content",reply));
                }},n->"fixture",()->step[0]+1,0);
    }
    public static void main(String[] args)throws Exception{
        JSONObject hi=ask("你好",arr(),"你好！").put("question","你好");
        check(hi.getInt("calls")==1 && hi.getString("answer").equals("你好！"),"chat sends once");
        JSONObject market=ask("查标普500收盘",arr(hi),"CALL","收盘点位为 100 [S1]。").put("question","查标普500收盘");
        check(market.getJSONArray("sources").length()==1 && market.getInt("calls")==2 && market.getString("answer").startsWith("收盘"),"plain cited response");
        JSONObject next=ask("你刚才说的是什么意思？",arr(hi,market),"刚才说的是指数的收盘点位。");
        check(next.getInt("calls")==1 && next.getJSONArray("sources").length()==0,"research to conversational follow-up");
        for(String invalid:new String[]{"查到 99999 [S99]。","没有引用的行情 99999","{\"answer\":\"收盘 99999\"",""}){
            JSONObject result=ask("标普500行情",arr(),"CALL",invalid);
            check(result.getString("answer").contains("100 点")&&!result.getString("answer").contains("99999"),"recover from invalid citation");
        }
        JSONObject skipped=ask("标普500收盘多少",arr(),"未经核验的价格 99999");
        check(skipped.getJSONArray("sources").length()==1 && skipped.getString("answer").contains("100 点"),"independent cached evidence");
        check(!ask("今天有哪些官方消息？",arr(),"没有证据却编造的报道").getString("answer").contains("编造"),"missing evidence");
        check(ToolResearch.mode("那昨天呢？",arr(market))==ToolResearch.Mode.RESEARCH,"dated follow-up");
        check(ToolResearch.mode("what is a stock index?",arr())==ToolResearch.Mode.CHAT,"concept");
        System.out.println("PASS: chat, history, grounded prose, missing/invalid JSON and IDs, cache fallback, no evidence, dated follow-up.");
    }
}
