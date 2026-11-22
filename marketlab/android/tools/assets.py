"""Prepare the Android-only web workbench from an allowlist. Never copy local market caches, APKs or keys."""
import re
import shutil
import sys
from pathlib import Path
module=Path(__file__).resolve().parents[2]
out=Path(sys.argv[1])/'site'
def copy(rel):
    src=module/rel
    if src.is_file():
        target=out/'marketlab'/rel
        target.parent.mkdir(parents=True,exist_ok=True)
        shutil.copyfile(src,target)
for rel in ['index.html','app.js','lab.css','suite.js','suite.css','common.js','chart.js','records.js','official.js','README.md',
            'observe/market.js','observe/market.css','observe/assets.js','quant/engine.js','quant/lab.js','quant/style.css','replay/lab.js','replay/style.css',
            'scenario/lab.js','scenario/model.js','report/lab.js','data/market.js','markets/context.js','markets/catalog.js','markets/model.js','markets/catalog.css','markets/local.js']:
    copy(rel)
# Include locally referenced scripts or styles used by the current workbench except private source folders.
entry=(module/'index.html').read_text()
for ref in re.findall(r'(?:src|href)="([A-Za-z0-9._/-]+\.(?:css|js))"',entry):
    rel=Path(ref)
    if '..' in rel.parts or rel.is_absolute() or any(c in ('cn','us','private','downloads') for c in rel.parts): continue
    copy(ref)
for doc in (module/'docs').glob('*.md'):copy(str(doc.relative_to(module)))
for folder in ['observe','quant','replay']:
    copy(folder+'/README.md')
style=(module.parent/'style.css').read_text()
# The system CJK serif fallback avoids shipping an extra font payload or a desktop font licence.
(out/'style.css').write_text(re.sub(r'@font-face\s*\{[^}]*\}', '',style))
page=out/'marketlab/index.html'
html=page.read_text()
html=re.sub(r'<header class="site-header">.*?</header>', '',html, count=1,flags=re.S)
html=re.sub(r'<a class="back-link"[^>]*>.*?</a>', '',html, count=1,flags=re.S)
html=html.replace('<head>','<head>\n<script>window.ML_ANDROID=true;</script>\n<script defer src="android-export.js"></script>')
if 'src="markets/local.js"' not in html:
    html=html.replace('src="data/market.js"></script>', 'src="data/market.js"></script><script defer src="markets/local.js"></script>')
html=html.replace('在此设备载入所选指数，或选择有权使用的 MarketLab 行情快照。','打开 App 的「今日」并点击「更新行情与消息」。返回研究台后，可点上方的「载入新行情」。')
html=re.sub(r'<button id="acquire-index".*?</label>', '<div hidden>\\g<0></div>',html,count=1,flags=re.S)
html=html.replace('AI 分析师</h3>', 'AI 分析师</h3><p class="fine">手机问答从底部「助手」进入。本页的 AI 概率与正式前瞻盖时需桌面本机服务。</p>')
# These adaptations operate only on the APK's generated WebView assets.
night=module/'android'/'workbench'
html=re.sub(r'<header class="mast">.*?</header>',(night/'head.html').read_text(),html,count=1,flags=re.S)
html=html.replace('<body>','<body data-night-page="overview">')
html=html.replace('</head>','<link rel="stylesheet" href="night.css"><script defer src="night.js"></script></head>')
html=html.replace('<title>MarketLab · AI 金融市场实验室 · 柳园最终兵器</title>','<meta name="color-scheme" content="dark"><title>MarketLab · 研究台</title>')
for name in ('night.css','night.js'):
    shutil.copyfile(night/name,out/'marketlab'/name)
# Mobile canvas draws pixel colors, whereas SVG figures and forms inherit CSS.
palette={'#e0d3bf':'#514351','#ded6c9':'#514351','#585170':'#c5b1c0','#6b6484':'#b6a3b2',
         '#b3261e':'#f3a3ad','#0f7a46':'#a6cebf','#0a6d7d':'#dfb7d9','#b84442':'#a6cebf',
         '#6b3fb8':'#efad9e','#8a5a00':'#ebc798'}
for script in ('chart.js','common.js'):
    generated=out/'marketlab'/script
    content=generated.read_text()
    for old,new in palette.items():content=content.replace(old,new)
    generated.write_text(content)
# Add a standalone print-safe theme to the generated report's own document.
import json
report=out/'marketlab/report/lab.js'
report_text=report.read_text()
needle='doc.head.append(style);'
if report_text.count(needle)!=1:raise RuntimeError("Cannot locate generated report stylesheet")
report.write_text(report_text.replace(needle,'style.textContent+='+json.dumps((night/'report.css').read_text())+';'+needle))
page.write_text(html)
quant=out/'marketlab/quant/lab.js'
if quant.exists():
    text=quant.read_text().replace("link.download='marketlab-quant-'","link.download='MarketLab-quant-'").replace("link.click();setTimeout(","document.body.append(link);link.click();link.remove();setTimeout(")
    quant.write_text(text)
(out/'marketlab/android-export.js').write_text("""document.addEventListener('click',async event=>{
 const link=event.target.closest('a[download]');if(!link||!link.href.startsWith('blob:'))return;
 event.preventDefault();try{const res=await fetch(link.href);const text=await res.text();window.MarketLabExport.save(link.download,text);}catch{alert('导出失败，请重试。');}
},true);""")
print('Offline assets:',sum(p.stat().st_size for p in out.rglob('*') if p.is_file()),'bytes')
