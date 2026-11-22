'use strict';
// One primary key per market, horizon and cutoff. IndexedDB serializes concurrent writes.
window.openMarketLabRecords = () => new Promise((resolve,reject)=>{
  if(!window.indexedDB){reject(Error('此浏览器不支持本机记录'));return;}
  const open=indexedDB.open('marketlab-predictions-v1',1);
  open.onupgradeneeded=()=>open.result.createObjectStore('predictions',{keyPath:'id'});
  open.onerror=()=>reject(open.error);
  open.onblocked=()=>reject(Error('另一个窗口占用了记录库，请关闭旧窗口后刷新。'));
  open.onsuccess=()=>{
    const db=open.result;
    db.onversionchange=()=>db.close();
    const records={
      all(){return new Promise((done,fail)=>{
        const req=db.transaction('predictions').objectStore('predictions').getAll();
        req.onsuccess=()=>done(req.result);req.onerror=()=>fail(req.error);
      });},
      add(value){return new Promise((done,fail)=>{
        const tx=db.transaction('predictions','readwrite');tx.objectStore('predictions').add(value);
        tx.oncomplete=done;tx.onabort=()=>fail(tx.error);
      });},
      change(id,update){return new Promise((done,fail)=>{
        const tx=db.transaction('predictions','readwrite'), store=tx.objectStore('predictions'),req=store.get(id);
        req.onsuccess=()=>{if(req.result && update(req.result))store.put(req.result);};
        tx.oncomplete=done;tx.onabort=()=>fail(tx.error);
      });}
    };
    resolve(records);
  };
});
