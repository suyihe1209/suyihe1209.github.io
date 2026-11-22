"""Install verified personal archives outside the redistributable website."""
import argparse
import hashlib
import json
import os
import shutil
import tempfile
from pathlib import Path

HERE=Path(__file__).resolve().parent
SYMBOLS={"cn":"CSI:000300","us":"SP:SPX","nasdaq":"NASDAQ:IXIC"}
CUTOFF="2026-11-18"
FILES=("market.json","market.js","source.json","source.csv")

def install(root, sources, link_dir):
    root.mkdir(parents=True,exist_ok=True)
    snapshots=[]
    for (name,symbol),src in zip(SYMBOLS.items(),sources):
        data=json.loads((src/'market.json').read_text(encoding='utf-8'))
        source=data['source']
        if data['market']['id']!=symbol or source['asOf']!=CUTOFF or data['bars'][-1]['date']!=CUTOFF:
            raise ValueError(f'{name} 非指定市场或截止日')
        if hashlib.sha256((src/'source.csv').read_bytes()).hexdigest()!=source['sha256']:
            raise ValueError(f'{name} 文件校验不一致')
        snapshots.append(data)
        dest=root/name
        if dest.exists():
            stored=json.loads((dest/'market.json').read_text())
            if stored['experiment']['snapshotSha256']!=data['experiment']['snapshotSha256']:
                raise ValueError(f'{dest} 已有其他数据。请指定新的缓存目录。')
        else:
            with tempfile.TemporaryDirectory(dir=root) as tmp:
                new=Path(tmp)/name;new.mkdir(mode=0o700)
                for item in FILES:shutil.copyfile(src/item,new/item)
                os.rename(new,dest)
    target=root/'browser-20261118.js'
    with tempfile.NamedTemporaryFile('w',dir=root,delete=False,encoding='utf-8') as stage:
        stage.write('window.ML_LOCAL_MARKETS='+json.dumps(snapshots,ensure_ascii=True,separators=(',',':'))+';\n')
    os.replace(stage.name,target)
    if link_dir:
        link=link_dir/'file-cache.js'
        if link.is_symlink() and link.resolve()==target.resolve():return
        if link.exists() or link.is_symlink():raise ValueError('现有本地预览链接指向另一份数据。')
        link.symlink_to(target)
if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('sources',nargs=3,type=Path,metavar='SNAPSHOT')
    p.add_argument('--root',type=Path,default=Path.home()/'.marketlab'/'markets')
    p.add_argument('--link-dir',type=Path,default=HERE)
    args=p.parse_args();install(args.root,args.sources,args.link_dir)
