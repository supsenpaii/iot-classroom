import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import { WebSocketServer } from 'ws';
import { mkdtempSync, rmSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Device, serverUrl } from './device.mjs';
import { createSimulator } from './server.mjs';
const until = async condition => { const end=Date.now()+5000; while(Date.now()<end){if(condition())return;await new Promise(r=>setTimeout(r,10));}throw Error('Timeout'); };
test('URL, lưu cấu hình riêng, chặn Origin/Host và không trả secret ra giao diện', async () => {
  assert.equal(serverUrl('https://example.test'),'https://example.test');
  for(const url of ['file:///tmp/x','https://user:pass@example.test/','https://example.test/path','https://example.test/?secret=x'])assert.throws(()=>serverUrl(url));
  const dir=mkdtempSync(join(tmpdir(),'esp32-ui-test-'));
  const simulator=createSimulator({dataDir:dir,defaultUrl:'https://example.test'});
  const origin=await simulator.listen(0);
  const api=async (body,requestOrigin=origin)=>fetch(origin+'/api/devices',{method:'POST',headers:{Origin:requestOrigin,'Content-Type':'application/json'},body:JSON.stringify(body)});
  try {
    assert.equal((await api({name:'ESP32'},'https://evil.test')).status,403);
    const response=await api({name:'ESP32',url:'https://example.test'});assert.equal(response.status,201);
    const d=await response.json();assert.ok(d.id);
    assert.equal(statSync(join(dir,'devices.json')).mode & 0o777,0o600);
    assert.equal(JSON.parse(readFileSync(join(dir,'devices.json'))).devices.length,1);
    simulator.devices.get(d.id).config.secret='private-not-for-browser';
    const state=await (await fetch(origin+'/api/state')).text();assert.equal(state.includes('private-not-for-browser'),false);
    const badHost = await new Promise((resolve,reject)=>{const req=httpRequest(origin+'/api/state',{headers:{Host:'evil.test'}},res=>{res.resume();resolve(res.statusCode);});req.on('error',reject);req.end();});
    assert.equal(badHost,403);
  }finally{await simulator.close();rmSync(dir,{recursive:true});}
});
test('Giao thức native: headers, mất ACK, lựa chọn hàng đợi, pause, reboot và các chế độ',async()=>{
  const server=createServer();const wss=new WebSocketServer({server});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const url=`http://127.0.0.1:${server.address().port}`;
  const config={id:'local',name:'ESP32',url,deviceId:'device',secret:'secret',wsUrl:url.replace('http','ws')};
  let saved=0, remote, messageLog=[],snapshot={id:'room',state:'RUNNING',state_version:1,server_time:Date.now(),binding_id:'binding',question:{id:'q',status:'OPEN',deadline_at:Date.now()+60000},current_answer:null};
  wss.on('connection',(ws,req)=>{
    assert.equal(req.headers.authorization,'Bearer secret');assert.equal(req.headers['x-device-id'],'device');assert.equal(req.headers.origin,undefined);
    remote=ws;ws.send(JSON.stringify({v:1,type:'session.snapshot',data:{...snapshot,server_time:Date.now()}}));
    ws.on('message',data=>{const p=JSON.parse(data);messageLog.push(p);if(p.type==='button.test'){ws.send(JSON.stringify({type:'button.ack',assigned:true}));return;}
      const type={'answer.submit':'answer.ack','flashcard.rate':'flashcard.ack','poll.vote':'poll.ack','attendance.checkin':'attendance.ack'}[p.type];
      if(type)ws.send(JSON.stringify({type,request_id:p.request_id,accepted:true,choice:p.choice,rating:p.rating,duplicate:messageLog.filter(m=>m.request_id===p.request_id).length>1}));
    });
  });
  let device=new Device(config,()=>saved++,{retryMs:60});
  const push=async s=>{snapshot={...s,server_time:Date.now()};remote.send(JSON.stringify({type:'session.snapshot',data:snapshot}));await until(()=>device.snapshot.state_version===s.state_version);};
  try{
    device.connect();await until(()=>device.synced);
    device.dropAck=true;device.press('A');device.press('D');
    await until(()=>!config.pending && messageLog.some(m=>m.choice==='D'));
    const a=messageLog.filter(m=>m.choice==='A');assert.ok(a.length>=2);assert.equal(a[0].request_id,a[1].request_id);
    assert.equal(messageLog.find(m=>m.choice==='D').seq,2);assert.ok(saved);
    device.resend();await until(()=>device.ack.includes('gói gửi lại'));
    await push({...snapshot,state:'PAUSED',state_version:2,question:{...snapshot.question,remaining_ms:10000}});
    device.press('B');await until(()=>device.ack.startsWith('Đã nhận bấm thử'));assert.equal(messageLog.at(-1).type,'button.test');
    device.network();assert.throws(()=>device.press('C'),/chưa kết nối/);device.network();await until(()=>device.synced);
    await push({...snapshot,state:'RUNNING',state_version:3,question:{...snapshot.question,deadline_at:Date.now()+60000},current_answer:{choice:'D',seq:2}});
    device.reboot();await until(()=>device.synced);device.press('B');await until(()=>!config.pending);assert.equal(messageLog.at(-1).seq,3);
    await push({id:'review',mode:'flashcard',state:'RUNNING',state_version:4,card:{id:'card',index:1,total:2},current_rating:null});
    device.press('OK');await until(()=>!config.pending);assert.equal(messageLog.at(-1).rating,'KNOWN');
    device.press('DEL');await until(()=>!config.pending);assert.equal(messageLog.at(-1).rating,'AGAIN');
    await push({id:'poll',mode:'poll',state:'RUNNING',state_version:5,options:2});assert.throws(()=>device.press('D'));device.press('B');await until(()=>!config.pending);assert.equal(messageLog.at(-1).type,'poll.vote');
    await push({id:'attendance',mode:'attendance',state:'RUNNING',state_version:6,checked_in:false});device.press('OK');await until(()=>!config.pending);assert.equal(messageLog.at(-1).type,'attendance.checkin');
    await push({id:'room',state:'RUNNING',state_version:7,binding_id:'binding',question:{id:'q',status:'OPEN',deadline_at:Date.now()-1}});assert.throws(()=>device.press('A'),/hết giờ/);
    // A queued press from one question must not become an answer for the next.
    config.pending={v:1,type:'answer.submit',request_id:'old-pending',session_id:'room',binding_id:'binding',question_instance_id:'q',seq:3,choice:'B'};
    config.queued={choice:'A',scope:'quiz:room:binding:q:'};
    await push({...snapshot,state_version:8,question:{id:'q2',status:'OPEN',deadline_at:Date.now()+60000}});await until(()=>!config.pending);assert.equal(config.queued,null);
    assert.equal(messageLog.some(m=>m.question_instance_id==='q2'),false);
    remote.close(4001,'Revoked');await until(()=>device.stopped);assert.equal(device.status,'Thiết bị bị thu hồi');
  }finally{device.stop();for(const ws of wss.clients)ws.terminate();await new Promise(r=>wss.close(r));await new Promise(r=>server.close(r));}
});
