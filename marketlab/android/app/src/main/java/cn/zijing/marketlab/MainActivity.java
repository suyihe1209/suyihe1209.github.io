package cn.zijing.marketlab;

import android.app.*;
import android.os.*;
import android.content.*;
import android.net.*;
import android.view.*;
import android.graphics.Typeface;
import android.graphics.drawable.Drawable;
import android.content.res.ColorStateList;
import android.graphics.drawable.GradientDrawable;
import android.text.InputType;
import android.widget.*;
import android.webkit.WebView;
import org.json.*;
import java.io.*;
import java.util.Arrays;

public final class MainActivity extends Activity {
    static final int INK=0xfff5edf1,TEAL=0xffdfb7d9,MUTED=0xffc5b1c0,PAPER=0xff201923,WHITE=0xff2a222c,LINE=0xff483a48,POS=0xfff3a3ad,NEG=0xffa6cebf,FAINT=0xffa691a2;
    private static final String[] TABS={"今日","助手","研究台","设置"};
    private static final int[] ICONS={R.drawable.ml_today,R.drawable.ml_assistant,R.drawable.ml_research,R.drawable.ml_settings};
    private LinearLayout outer,body,nav,page;private ScrollView currentScroll;private TextView heading;private int tab;String feedback="";private String question="",askError="";
    private ResearchPage research;boolean updating;private boolean asking,destroyed;private String pendingExport;
    private ConnectivityManager.NetworkCallback connectivity;private Button applyMarketData;private ImageButton refreshIcon;
    private final Button[] buttons=new Button[4];private TodayPage todayPage;
    private SharedPreferences watchCache;
    private final SharedPreferences.OnSharedPreferenceChangeListener cacheListener=(prefs,field)->{
        if(!"dashboard".equals(field)||updating||destroyed)return;
        runOnUiThread(()->{if(destroyed)return;if(tab==0)refreshScreen();
            if(research!=null){research.checkUpdate();applyMarketData.setVisibility(tab==2&&research.hasUpdate()?View.VISIBLE:View.GONE);}});
    };
    int px(int n){return Math.round(n*getResources().getDisplayMetrics().density);}
    LinearLayout col(){LinearLayout c=new LinearLayout(this);c.setOrientation(LinearLayout.VERTICAL);return c;}
    LinearLayout row(){LinearLayout r=new LinearLayout(this);r.setOrientation(LinearLayout.HORIZONTAL);r.setGravity(Gravity.CENTER_VERTICAL);return r;}
    GradientDrawable bg(int color,int radius){GradientDrawable d=new GradientDrawable();d.setColor(color);d.setCornerRadius(px(radius));return d;}
    private GradientDrawable border(int color,int radius){GradientDrawable d=bg(color,radius);d.setStroke(px(1),LINE);return d;}
    void touch(View v,View.OnClickListener click){android.util.TypedValue h=new android.util.TypedValue();
        if(getTheme().resolveAttribute(android.R.attr.selectableItemBackground,h,true))v.setForeground(getDrawable(h.resourceId));
        v.setFocusable(true);v.setOnClickListener(click);}
    TextView txt(String text,int size,int color){TextView t=new TextView(this);t.setText(text);t.setTextSize(size);t.setTextColor(color);t.setPadding(0,px(1),0,px(1));t.setIncludeFontPadding(false);t.setGravity(Gravity.CENTER_VERTICAL);return t;}
    TextView face(String text,int size,int color,Typeface family,int style){TextView t=txt(text,size,color);t.setTypeface(family,style);return t;}
    private TextView title(String s,int size){return face(s,size,INK,Typeface.SERIF,Typeface.BOLD);}
    void gap(LinearLayout c,int dp){c.addView(new View(this),new LinearLayout.LayoutParams(1,px(dp)));}
    void space(LinearLayout c,int dp){c.addView(new View(this),new LinearLayout.LayoutParams(px(dp),1));}
    void rule(LinearLayout c){View line=new View(this);line.setBackgroundColor(LINE);c.addView(line,new LinearLayout.LayoutParams(-1,Math.max(1,px(1))));}
    Button button(String s,View.OnClickListener action){
        Button b=new Button(this);b.setText(s);b.setAllCaps(false);b.setTextSize(13);b.setTextColor(TEAL);b.setBackgroundTintList(null);b.setBackground(border(WHITE,9));
        b.setMinWidth(0);b.setMinimumWidth(0);b.setMinHeight(px(44));b.setMinimumHeight(px(44));b.setPadding(px(10),px(2),px(10),px(2));b.setElevation(0);b.setStateListAnimator(null);touch(b,action);return b;
    }
    private Button primary(String s,View.OnClickListener action){Button b=button(s,action);b.setBackground(bg(TEAL,9));b.setTextColor(PAPER);b.setTypeface(Typeface.DEFAULT,Typeface.BOLD);return b;}
    Button chip(String s,boolean selected,View.OnClickListener f){Button b=button(s,f);b.setTextSize(12);b.setSelected(selected);b.setMinHeight(px(40));b.setMinimumHeight(px(40));b.setTextColor(selected?INK:MUTED);
        b.setBackground(selected?border(0xff44323f,7):bg(PAPER,7));return b;}
    private ImageButton iconButton(String name,int res,View.OnClickListener click){
        ImageButton b=new ImageButton(this);b.setImageResource(res);b.setImageTintList(ColorStateList.valueOf(MUTED));b.setScaleType(ImageView.ScaleType.CENTER);b.setContentDescription(name);b.setBackground(bg(PAPER,7));touch(b,click);return b;
    }
    LinearLayout panel(LinearLayout parent){LinearLayout c=col();c.setBackground(border(WHITE,15));c.setPadding(px(13),px(12),px(13),px(14));parent.addView(c);return c;}
    private LinearLayout card(){LinearLayout c=panel(page);gap(page,15);return c;}
    void note(LinearLayout c,String s){if(s!=null&&!s.isEmpty()){TextView t=txt(s,12,MUTED);t.setLineSpacing(px(2),1);c.addView(t);}}
    private void intro(String name,String detail){page.addView(title(name,29));gap(page,3);note(page,detail);gap(page,14);}
    private void inputStyle(EditText e){e.setTextSize(15);e.setTextColor(INK);e.setHintTextColor(FAINT);e.setBackgroundTintList(null);e.setBackground(border(PAPER,12));e.setPadding(px(11),px(8),px(11),px(8));e.setMinHeight(px(44));}
    private EditText field(LinearLayout c,String label,String value,String hint,int type){
        gap(c,7);TextView l=txt(label,12,MUTED);c.addView(l);EditText e=new EditText(this);e.setId(View.generateViewId());l.setLabelFor(e.getId());
        e.setSingleLine(true);e.setInputType(type);e.setText(value);e.setHint(hint);inputStyle(e);c.addView(e);return e;
    }
    void message(String s){Toast.makeText(this,s,Toast.LENGTH_LONG).show();}
    public void onCreate(Bundle state){
        super.onCreate(state);
        todayPage=new TodayPage(this);
        if(state!=null){tab=state.getInt("tab");todayPage.region=state.getString("newsRegion","");question=state.getString("question","");pendingExport=state.getString("export");}
        outer=col();outer.setBackgroundColor(PAPER);setContentView(outer);
        LinearLayout top=row();top.setPadding(px(17),0,px(7),0);TextView wordmark=face("MarketLab",25,INK,Typeface.SERIF,Typeface.BOLD_ITALIC);wordmark.setLetterSpacing(-.035f);top.addView(wordmark);
        heading=txt("",11,MUTED);heading.setPadding(px(9),0,0,0);top.addView(heading,new LinearLayout.LayoutParams(0,-1,1));
        applyMarketData=button("载入新行情",v->new AlertDialog.Builder(this).setMessage("载入刚更新的行情和消息？页面会重新打开，请先保存正在编辑的内容。").setNegativeButton("稍后",null).setPositiveButton("载入",(d,w)->{if(research!=null)research.applyUpdate();applyMarketData.setVisibility(View.GONE);}).show());
        top.addView(applyMarketData);refreshIcon=iconButton("更新行情与消息",R.drawable.ml_refresh,v->refresh(false));top.addView(refreshIcon,new LinearLayout.LayoutParams(px(44),-1));
        top.addView(iconButton("查看行情与公告来源",R.drawable.ml_source,v->sourcesDialog()),new LinearLayout.LayoutParams(px(44),-1));outer.addView(top,new LinearLayout.LayoutParams(-1,px(51)));
        body=col();outer.addView(body,new LinearLayout.LayoutParams(-1,0,1));rule(outer);
        nav=row();nav.setPadding(px(7),px(2),px(7),px(2));outer.addView(nav,new LinearLayout.LayoutParams(-1,px(54)));
        for(int i=0;i<TABS.length;i++){
            final int index=i;Button b=button(TABS[i],v->show(index));buttons[i]=b;b.setGravity(Gravity.CENTER);b.setBackground(bg(PAPER,7));b.setPadding(0,px(4),0,px(3));
            b.setTextSize(11);b.setIncludeFontPadding(false);b.setCompoundDrawablePadding(px(2));nav.addView(b,new LinearLayout.LayoutParams(0,-1,1));
        }
        watchCache=getSharedPreferences("market.research.v1",MODE_PRIVATE);watchCache.registerOnSharedPreferenceChangeListener(cacheListener);
        DailyJob.plan(this,false);show(tab);
        registerNetwork();
    }
    private void registerNetwork(){
        ConnectivityManager cm=(ConnectivityManager)getSystemService(CONNECTIVITY_SERVICE);
        connectivity=new ConnectivityManager.NetworkCallback(){
            @Override public void onAvailable(Network n){runOnUiThread(()->{
                if(destroyed||!DailyJob.prefs(MainActivity.this).getBoolean("auto",true))return;
                long last=DailyJob.prefs(MainActivity.this).getLong("success",0),attempt=DailyJob.prefs(MainActivity.this).getLong("foregroundAttempt",0);
                if(last<DailyJob.latestDue(MainActivity.this)&&System.currentTimeMillis()-attempt>30*60*1000L&&!updating){
                    DailyJob.prefs(MainActivity.this).edit().putLong("foregroundAttempt",System.currentTimeMillis()).apply();refresh(true);
                }
            });}
        };try{cm.registerDefaultNetworkCallback(connectivity);}catch(Exception ignored){}
    }
    private void show(int index){
        tab=Math.max(0,Math.min(index,TABS.length-1));heading.setText(new String[]{"市场研究","助手","研究台","设置"}[tab]);
        for(int i=0;i<4;i++){Drawable icon=getDrawable(ICONS[i]).mutate();icon.setBounds(0,0,px(18),px(18));icon.setTint(i==tab?TEAL:MUTED);
            buttons[i].setCompoundDrawables(null,icon,null,null);buttons[i].setTypeface(Typeface.DEFAULT,i==tab?Typeface.BOLD:Typeface.NORMAL);
            buttons[i].setTextColor(i==tab?INK:MUTED);buttons[i].setSelected(i==tab);}
        refreshIcon.setVisibility(tab==0?View.VISIBLE:View.GONE);refreshIcon.setEnabled(!updating);refreshIcon.setAlpha(updating?.45f:1f);
        applyMarketData.setVisibility(tab==2&&research!=null&&research.hasUpdate()?View.VISIBLE:View.GONE);
        body.removeAllViews();
        if(tab==2){if(research==null)research=new ResearchPage(this);body.addView(research,new LinearLayout.LayoutParams(-1,-1));return;}
        ScrollView scroll=new ScrollView(this);currentScroll=scroll;scroll.setFillViewport(true);body.addView(scroll,new LinearLayout.LayoutParams(-1,-1));page=col();page.setPadding(px(17),px(7),px(17),px(17));scroll.addView(page);
        if(tab==0)today();else if(tab==1)assistant();else settings();
    }
    private JSONObject dash(){try{return ResearchEngine.dashboard(this);}catch(Exception ignored){return new JSONObject();}}
    JSONObject readAnswer(String key){try{return new JSONObject(DailyJob.prefs(this).getString(key,""));}catch(Exception e){return null;}}
    private void today(){todayPage.render(page,dash());}
    void sourcesDialog(){
        JSONObject data=dash();LinearLayout content=col();content.setPadding(px(18),px(10),px(18),px(15));ScrollView scroll=new ScrollView(this);scroll.addView(content);
        note(content,data.optString("updatedAt").isEmpty()?"尚无已缓存行情和消息。":"缓存更新于 "+TodayPage.localStamp(data.optString("updatedAt"))+" · 设备当地时间");
        if(!feedback.isEmpty())note(content,feedback);
        JSONArray warnings=data.optJSONArray("warnings");if(warnings!=null)for(int i=0;i<warnings.length();i++)note(content,warnings.optString(i));
        for(int i=0;i<TodayPage.IDS.length;i++){
            JSONObject m=TodayPage.market(data,TodayPage.IDS[i]);if(m==null)continue;gap(content,9);content.addView(title(TodayPage.NAMES[i],16));
            note(content,m.optString("date")+" · "+m.optString("timezone")+" · "+TodayPage.num(m.optDouble("close"))+" 点");source(content,m.optString("source"),m.optString("url"));
        }
        JSONArray all=data.optJSONArray("news");java.util.Set<String> names=new java.util.HashSet<>();
        if(all!=null)for(int i=0;i<all.length();i++){JSONObject n=all.optJSONObject(i);if(n!=null&&names.add(n.optString("source"))){gap(content,8);source(content,n.optString("source")+" · 最新公告",n.optString("url"));}}
        new AlertDialog.Builder(this).setTitle("行情与公告来源").setView(scroll).setPositiveButton("关闭",null).show();
    }
    private void refreshScreen(){
        int position=currentScroll==null?0:currentScroll.getScrollY();
        show(0);final ScrollView screen=currentScroll;if(position>0&&screen!=null)screen.post(()->screen.scrollTo(0,position));
    }
    void refresh(boolean automatic){
        if(updating)return;updating=true;feedback="";if(tab==0)refreshScreen();
        DailyJob.WORK.execute(()->{
            String status;
            try{DailyJob.refresh(getApplicationContext(),automatic);status=DailyJob.prefs(this).getString("lastStatus","已更新");}
            catch(Exception ex){status="更新失败："+safe(ex);}
            final String result=status;runOnUiThread(()->{if(destroyed)return;updating=false;feedback=result;if(research!=null){research.checkUpdate();applyMarketData.setVisibility(tab==2&&research.hasUpdate()?View.VISIBLE:View.GONE);}if(tab==0)refreshScreen();});
        });
    }
    private void source(LinearLayout c,String label,String url){if(url==null||url.isEmpty())return;Button b=button(label==null||label.isEmpty()?"查看来源":label,v->openSource(url));c.addView(b);}
    void openSource(String value){
        try{Uri u=Uri.parse(value);if(!"https".equalsIgnoreCase(u.getScheme())&&!"http".equalsIgnoreCase(u.getScheme()))return;
            startActivity(new Intent(Intent.ACTION_VIEW,u).addCategory(Intent.CATEGORY_BROWSABLE));
        }catch(Exception ex){message("未找到可打开来源的浏览器。");}
    }
    private String safe(Exception e){
        String msg=e.getMessage();if(msg==null||msg.isEmpty())return "请检查网络或设置后重试。";
        return msg.replaceAll("(?i)Bearer\\s+\\S+","[已隐藏]").replaceAll("(?i)sk-[A-Za-z0-9_-]+","[已隐藏]");
    }
    void answer(LinearLayout c,JSONObject obj){
        note(c,obj.optString("updatedAt"));TextView out=txt(obj.optString("answer"),16,INK);out.setTextIsSelectable(true);c.addView(out);
        JSONArray sources=obj.optJSONArray("sources");if(sources!=null&&sources.length()>0){c.addView(title("查证来源",16));for(int i=0;i<sources.length();i++){JSONObject s=sources.optJSONObject(i);if(s==null)continue;source(c,"["+s.optString("id")+"] "+s.optString("title",s.optString("source")),s.optString("url"));note(c,s.optString("source")+"  "+s.optString("date"));}}
        if(obj.has("calls"))note(c,"本条回复调用模型 "+obj.optInt("calls")+" 次。");
    }
    private void assistant(){
        intro("研究助手","聊聊你的问题，也可以查行情和公告。");
        MarketConfig config;try{config=MarketConfig.read(this);}catch(Exception e){config=new MarketConfig();}
        boolean ready=config.ready();
        LinearLayout status=row();status.setBackgroundColor(WHITE);
        View edge=new View(this);edge.setBackgroundColor(TEAL);status.addView(edge,new LinearLayout.LayoutParams(px(2),-1));
        LinearLayout stat=col();stat.setPadding(px(12),px(9),px(12),px(10));status.addView(stat,new LinearLayout.LayoutParams(0,-2,1));
        stat.addView(face(ready?ProviderCatalog.byId(config.providerId).name+" · "+config.model:"模型尚未配置",14,INK,Typeface.DEFAULT,Typeface.BOLD));
        note(stat,ready?"可以接着上一轮提问。查询市场数据时，助手会标出查到的来源。":"回答需连接自己的模型服务。已缓存的资料可直接查阅。");page.addView(status);gap(page,14);
        LinearLayout c=card();EditText q=field(c,"你的消息",question,"发消息，或接着上一轮提问",InputType.TYPE_CLASS_TEXT|InputType.TYPE_TEXT_FLAG_MULTI_LINE);
        q.setSingleLine(false);q.setMinLines(3);q.setGravity(Gravity.TOP|Gravity.START);
        q.addTextChangedListener(new android.text.TextWatcher(){public void beforeTextChanged(CharSequence s,int a,int count,int after){}public void onTextChanged(CharSequence s,int start,int before,int count){question=s.toString();}public void afterTextChanged(android.text.Editable e){}});
        gap(c,7);LinearLayout prompts=row();c.addView(prompts);
        for(String preset:new String[]{"三项指数涨跌如何？","今天有哪些官方消息？"}){
            Button prompt=chip(preset,false,v->{q.setText(preset);q.setSelection(q.length());});prompt.setTextSize(11);prompt.setPadding(px(4),0,px(4),0);
            prompts.addView(prompt,new LinearLayout.LayoutParams(0,-2,1));space(prompts,4);
        }
        gap(c,7);LinearLayout actions=row();c.addView(actions);
        Button ask=primary(ready?(asking?"正在回复…":"发送"):"查看模型设置",v->{
            if(!ready){show(3);return;}
            final String text=q.getText().toString().trim();if(text.isEmpty()||text.length()>2000){message("请输入 1 至 2000 字的消息。");return;}
            MarketConfig cfg;try{cfg=MarketConfig.read(this);}catch(Exception ex){message("模型设置无法解密，请重新配置。");show(3);return;}
            if(!cfg.ready()){message("请先配置自己的模型服务与密钥。");show(3);return;}
            asking=true;askError="";show(1);DailyJob.WORK.execute(()->{
                try{
                    ResearchEngine.ask(getApplicationContext(),text,cfg,true);
                    runOnUiThread(()->{if(destroyed)return;asking=false;if(question.trim().equals(text))question="";if(tab==1)show(1);});
                }catch(Exception ex){runOnUiThread(()->{if(destroyed)return;asking=false;askError="发送未完成："+safe(ex);if(tab==1)show(1);});}
            });
        });ask.setEnabled(!asking);actions.addView(ask,new LinearLayout.LayoutParams(0,-2,1));space(actions,7);
        actions.addView(button("查阅缓存资料",v->sourcesDialog()),new LinearLayout.LayoutParams(0,-2,1));if(!askError.isEmpty())note(c,askError);
        LinearLayout audit=row();page.addView(audit);
        String[] names={"今天提问","今天模型调用"},vals={String.valueOf(ResearchEngine.today(this,true)),String.valueOf(ResearchEngine.today(this,false))};
        for(int i=0;i<2;i++){LinearLayout cell=col();cell.setBackground(border(WHITE,13));cell.setPadding(px(11),px(9),px(11),px(9));cell.addView(txt(names[i],11,MUTED));
            cell.addView(face(vals[i],19,INK,Typeface.MONOSPACE,Typeface.NORMAL));audit.addView(cell,new LinearLayout.LayoutParams(0,-2,1));if(i==0)space(audit,7);}
        gap(page,15);
        try{
            JSONArray history=ResearchEngine.history(this,config);
            for(int i=history.length()-1;i>=0;i--){
                JSONObject turn=history.getJSONObject(i);LinearLayout last=card();
                last.addView(title(turn.optString("question"),17));answer(last,turn);
            }
            if(history.length()==0){JSONObject old=readAnswer("lastAnswer");
                if(old!=null){LinearLayout last=card();last.addView(title("上个版本保存的回答",17));answer(last,old);}}
        }catch(Exception error){note(page,"本机对话暂时无法读取。");}
    }
    private final class ModelSettings {
        final Spinner brand=new Spinner(MainActivity.this),models=new Spinner(MainActivity.this);
        final TextView hint,modelStatus,apiLabel,routeNote;
        final EditText url,manual,key;
        final Button lookup,docs,forget;
        final LinearLayout panel;
        final String manualLabel="手动填写模型 / 接入点 ID";
        MarketConfig loaded;
        boolean binding,accountList;
        int revision;
        ModelSettings(LinearLayout c,MarketConfig active){
            panel=c;loaded=active;
            gap(c,7);c.addView(txt("服务品牌",12,MUTED));brand.setContentDescription("服务品牌");c.addView(brand);
            ArrayAdapter<ProviderCatalog.Entry> providers=new ArrayAdapter<>(MainActivity.this,android.R.layout.simple_spinner_dropdown_item,ProviderCatalog.ALL);
            brand.setAdapter(providers);int start=0;for(int i=0;i<ProviderCatalog.ALL.length;i++)if(ProviderCatalog.ALL[i].id.equals(active.providerId))start=i;
            brand.setSelection(start);
            gap(c,6);apiLabel=txt("",12,MUTED);c.addView(apiLabel);
            url=new EditText(MainActivity.this);url.setId(View.generateViewId());url.setSingleLine(true);url.setTextSize(15);url.setInputType(InputType.TYPE_CLASS_TEXT|InputType.TYPE_TEXT_VARIATION_URI);url.setHint("https://服务商地址/v1");inputStyle(url);c.addView(url);apiLabel.setLabelFor(url.getId());
            routeNote=txt("",13,MUTED);routeNote.setTextIsSelectable(true);c.addView(routeNote);
            gap(c,6);c.addView(txt("模型",12,MUTED));models.setContentDescription("模型");c.addView(models);
            manual=field(c,"模型或接入点 ID","","使用控制台提供的完整 ID",InputType.TYPE_CLASS_TEXT);
            key=field(c,"API Key","","输入当前服务的密钥",InputType.TYPE_CLASS_TEXT|InputType.TYPE_TEXT_VARIATION_PASSWORD);
            key.setSaveEnabled(false);key.setImportantForAutofill(View.IMPORTANT_FOR_AUTOFILL_NO);
            lookup=button("从当前账户读取模型列表",v->discover());c.addView(lookup);
            modelStatus=txt("",13,MUTED);modelStatus.setAccessibilityLiveRegion(View.ACCESSIBILITY_LIVE_REGION_POLITE);c.addView(modelStatus);
            hint=txt("",13,MUTED);c.addView(hint);docs=button("查看该品牌官方说明",v->openSource(ProviderCatalog.byId(loaded.providerId).docs));c.addView(docs);
            forget=button("移除此品牌已保存的配置",v->{
                String id=loaded.providerId;
                new AlertDialog.Builder(MainActivity.this).setMessage("移除「"+ProviderCatalog.byId(id).name+"」的模型和密钥？")
                    .setNegativeButton("取消",null).setPositiveButton("移除",(d,w)->{try{
                        boolean wasActive=MarketConfig.remove(MainActivity.this,id);
                        if(wasActive)DailyJob.prefs(MainActivity.this).edit().putBoolean("brief",false).apply();
                        if(wasActive)show(3);else bind(MarketConfig.read(MainActivity.this,id));
                    }catch(Exception ex){message(safe(ex));}}).show();
            });c.addView(forget);
            models.setOnItemSelectedListener(new AdapterView.OnItemSelectedListener(){
                public void onNothingSelected(AdapterView<?> parent){}
                public void onItemSelected(AdapterView<?> parent,View v,int n,long item){manualRow();}
            });
            bind(active);
            url.addTextChangedListener(new android.text.TextWatcher(){
                public void beforeTextChanged(CharSequence s,int start,int count,int after){}
                public void onTextChanged(CharSequence s,int start,int before,int count){
                    if(binding)return;revision++;key.setText("");keyHint();showRoute();lookup.setEnabled(true);
                    choices(java.util.Collections.emptyList(),"");modelStatus.setText("接口已变更，输入该服务的密钥后可读取模型。");
                }
                public void afterTextChanged(android.text.Editable e){}
            });
            key.addTextChangedListener(new android.text.TextWatcher(){
                public void beforeTextChanged(CharSequence s,int start,int count,int after){}
                public void onTextChanged(CharSequence s,int start,int before,int count){
                    if(binding)return;revision++;lookup.setEnabled(true);
                    if(accountList){accountList=false;choices(Arrays.asList(ProviderCatalog.byId(loaded.providerId).models),selectedModel());}
                    modelStatus.setText("可读取当前密钥可见的模型，也可手动填写。");
                }
                public void afterTextChanged(android.text.Editable e){}
            });
            brand.setOnItemSelectedListener(new AdapterView.OnItemSelectedListener(){
                public void onNothingSelected(AdapterView<?> parent){}
                public void onItemSelected(AdapterView<?> parent,View v,int n,long item){
                    String id=ProviderCatalog.ALL[n].id;if(id.equals(loaded.providerId))return;
                    try{bind(MarketConfig.read(MainActivity.this,id));}
                    catch(Exception ex){message(safe(ex));brand.setSelection(Arrays.asList(ProviderCatalog.ALL).indexOf(ProviderCatalog.byId(loaded.providerId)));}
                }
            });
        }
        private void bind(MarketConfig cfg){
            binding=true;accountList=false;revision++;loaded=cfg;ProviderCatalog.Entry p=ProviderCatalog.byId(cfg.providerId);
            boolean custom="custom".equals(p.id);hint.setText(p.note);docs.setVisibility(p.docs.isEmpty()?View.GONE:View.VISIBLE);
            apiLabel.setText(custom?"服务接口地址":"官方接口地址");url.setEnabled(custom);url.setText(cfg.baseUrl);
            key.setText("");keyHint();showRoute();forget.setVisibility(cfg.key.isEmpty()?View.GONE:View.VISIBLE);lookup.setEnabled(true);manual.setText("");
            choices(Arrays.asList(p.models),cfg.model);
            modelStatus.setText(custom?"可向填写的接口查询账户模型，或手动输入模型 ID。":"预设型号取自官方文档。读取账户列表后可选择其他型号。");
            binding=false;
        }
        private void showRoute(){
            MarketConfig route=new MarketConfig();route.providerId=loaded.providerId;route.baseUrl=url.getText().toString().trim();
            if(route.baseUrl.isEmpty()){routeNote.setText("");return;}
            try{routeNote.setText("模型请求将发送到 "+ModelGateway.checkRoute(route));}
            catch(Exception e){routeNote.setText(safe(e));}
        }
        private void keyHint(){
            boolean stored=!loaded.key.isEmpty()&&ProviderCatalog.sameRoute(loaded.baseUrl,url.getText().toString().trim());
            key.setHint(stored?"此地址已保存密钥，留空沿用":"输入当前服务的密钥");
        }
        private void choices(java.util.Collection<String> ids,String selectedId){
            java.util.LinkedHashSet<String> entries=new java.util.LinkedHashSet<>(ids);
            if(!selectedId.isEmpty()&&!entries.contains(selectedId))entries.add(selectedId);
            java.util.ArrayList<String> values=new java.util.ArrayList<>(entries);values.add(manualLabel);
            int at=selectedId.isEmpty()?0:values.indexOf(selectedId);
            models.setAdapter(new ArrayAdapter<>(MainActivity.this,android.R.layout.simple_spinner_dropdown_item,values));
            models.setSelection(Math.max(0,at));manualRow();
        }
        private void manualRow(){
            boolean show=manualLabel.equals(models.getSelectedItem());int idx=panel.indexOfChild(manual);
            manual.setVisibility(show?View.VISIBLE:View.GONE);if(idx>0)panel.getChildAt(idx-1).setVisibility(show?View.VISIBLE:View.GONE);
        }
        private String selectedModel(){
            Object item=models.getSelectedItem();return item==null||manualLabel.equals(item)?manual.getText().toString().trim():item.toString();
        }
        MarketConfig config(){
            MarketConfig cfg=new MarketConfig();cfg.providerId=loaded.providerId;cfg.baseUrl=url.getText().toString().trim();
            cfg.model=selectedModel();cfg.key=loaded.useKey(key.getText().toString().trim(),cfg.baseUrl);
            return cfg;
        }
        private void discover(){
            final MarketConfig cfg;
            try{cfg=config();if(cfg.key.isEmpty())throw new IllegalArgumentException("请先输入这个服务对应的 API Key。");}
            catch(Exception ex){modelStatus.setText(safe(ex));return;}
            final int request=++revision;String before=selectedModel();lookup.setEnabled(false);modelStatus.setText("正在向当前服务查询模型…");
            DailyJob.WORK.execute(()->{
                try{
                    java.util.List<String> ids=ModelGateway.listModels(cfg);
                    runOnUiThread(()->{
                        if(destroyed||!panel.isAttachedToWindow()||request!=revision)return;lookup.setEnabled(true);
                        if(ids.isEmpty()){modelStatus.setText("服务未列出可选模型。可保留预设型号或手动填写控制台 ID。");return;}
                        accountList=true;choices(ids,before);modelStatus.setText("服务返回 "+ids.size()+" 个可选模型，可切换或手动输入。");
                    });
                }catch(Exception ex){runOnUiThread(()->{if(destroyed||!panel.isAttachedToWindow()||request!=revision)return;
                    lookup.setEnabled(true);modelStatus.setText("模型列表未读取："+safe(ex)+"。可保留当前选择或手动填写。");});}
            });
        }
    }
    private void settings(){
        MarketConfig saved;try{saved=MarketConfig.read(this);}catch(Exception e){saved=new MarketConfig();message("旧配置无法解密，请重新填写。");}
        intro("应用设置","管理模型服务、每日更新和简报。");
        LinearLayout c=card();c.addView(title("模型服务",17));
        note(c,"保存后，研究助手和自动简报将使用所选服务。");
        ModelSettings modelSettings=new ModelSettings(c,saved);
        LinearLayout auto=card();auto.addView(title("每日更新",17));Switch update=new Switch(this);update.setText("每日自动补采");update.setTextSize(14);update.setMinHeight(px(46));update.setChecked(DailyJob.prefs(this).getBoolean("auto",true));auto.addView(update);
        EditText hour=field(auto,"每天从几点开始（设备当地时间）",String.valueOf(DailyJob.hour(this)),"0–23",InputType.TYPE_CLASS_NUMBER);
        note(auto,"应用不设每日调用上限。一次查证可能需要多次模型调用。");
        Switch brief=new Switch(this);brief.setText("每日 AI 简报");brief.setTextSize(14);brief.setMinHeight(px(46));brief.setChecked(DailyJob.prefs(this).getBoolean("brief",false));auto.addView(brief);
        note(auto,"系统会根据网络和省电策略安排时间。手机恢复联网或再次打开时会检查遗漏。自动简报的模型调用也会计入当天统计，费用由模型服务商决定。");
        gap(auto,9);auto.addView(primary("保存设置",v->{
            try{
                MarketConfig cfg=modelSettings.config();
                int h=Integer.parseInt(hour.getText().toString().trim());
                if(h<0||h>23)throw new IllegalArgumentException("开始时间应为 0 至 23 的整点。");
                if(brief.isChecked()&&(!cfg.ready()||!update.isChecked()))throw new IllegalArgumentException("自动简报需要模型配置和每日更新。");
                if(!cfg.baseUrl.isEmpty())ModelGateway.checkRoute(cfg);
                cfg.save(this);DailyJob.prefs(this).edit().putBoolean("auto",update.isChecked()).putBoolean("brief",brief.isChecked()).putInt("hour",h).apply();
                DailyJob.plan(this,true);message("设置已保存。");show(3);
            }catch(NumberFormatException e){message("请输入有效的整点。");}catch(Exception e){message(safe(e));}
        }));
        gap(auto,8);auto.addView(button("清除全部模型配置",v->new AlertDialog.Builder(this).setMessage("清除本机所有品牌的服务地址、模型与密钥，并关闭自动 AI 简报？")
           .setNegativeButton("取消",null).setPositiveButton("清除",(d,w)->{try{MarketConfig.clear(this);DailyJob.prefs(this).edit().putBoolean("brief",false).apply();show(3);}catch(Exception e){message("清除未完成。");}}).show()));
        LinearLayout about=card();about.addView(title("关于",17));String version="";
        try{version=getPackageManager().getPackageInfo(getPackageName(),0).versionName;}catch(android.content.pm.PackageManager.NameNotFoundException ignored){}
        note(about,"MarketLab "+version+" · 中美市场研究与模拟实验。数据保留原始日期和来源。");
    }
    void export(String name,String text){
        if(pendingExport!=null)return;
        File file=null;
        try{
            file=File.createTempFile("ml-report-",".pending",getCacheDir());
            try(OutputStream out=new FileOutputStream(file)){out.write(text.getBytes("UTF-8"));}
            pendingExport=file.getName();
            Intent i=new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE)
                .setType(name.endsWith(".json")?"application/json":"text/html").putExtra(Intent.EXTRA_TITLE,name);
            startActivityForResult(i,2711);
        }catch(Exception e){if(file!=null)file.delete();pendingExport=null;message("无法准备导出，请检查设备存储和文档保存器。");}
    }
    @Override protected void onActivityResult(int request,int result,Intent data){super.onActivityResult(request,result,data);
        if(request!=2711)return;final String pending=pendingExport;pendingExport=null;
        if(pending==null||!pending.matches("ml-report-[A-Za-z0-9_-]+\\.pending"))return;
        final File source=new File(getCacheDir(),pending);
        if(result!=RESULT_OK||data==null||data.getData()==null){source.delete();return;}
        final Uri uri=data.getData();DailyJob.WORK.execute(()->{
            try(InputStream in=new FileInputStream(source);OutputStream out=getContentResolver().openOutputStream(uri,"wt")){
                if(out==null)throw new IOException();
                byte[] buffer=new byte[32768];int count;
                while((count=in.read(buffer))!=-1)out.write(buffer,0,count);
            }catch(Exception e){runOnUiThread(()->message("报告写入失败，请重试。"));return;}
            finally{source.delete();}
            runOnUiThread(()->message("报告已保存。"));
        });
    }
    @Override public void onBackPressed(){if(tab==2&&research!=null&&research.canGoBack()){research.goBack();return;}if(tab!=0){show(0);return;}super.onBackPressed();}
    @Override protected void onSaveInstanceState(Bundle state){super.onSaveInstanceState(state);state.putInt("tab",tab);state.putString("newsRegion",todayPage.region);state.putString("question",question);state.putString("export",pendingExport);}
    @Override protected void onDestroy(){destroyed=true;if(watchCache!=null)watchCache.unregisterOnSharedPreferenceChangeListener(cacheListener);if(connectivity!=null)try{((ConnectivityManager)getSystemService(CONNECTIVITY_SERVICE)).unregisterNetworkCallback(connectivity);}catch(Exception ignored){}
        if(research!=null){if(research.getParent() instanceof ViewGroup)((ViewGroup)research.getParent()).removeView(research);research.removeJavascriptInterface("MarketLabExport");research.destroy();}super.onDestroy();}
}
