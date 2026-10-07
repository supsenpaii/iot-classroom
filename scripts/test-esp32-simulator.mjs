import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../dist/server/server/db.js';
import { createApplication } from '../dist/server/server/app.js';
import { createSimulator } from '../esp32-simulator/server.mjs';

const dir=mkdtempSync(join(tmpdir(),'esp32-live-test-'));
const db=openDb(':memory:');
const config={origin:'',secret:randomBytes(48).toString('hex'),production:false,simulator:false,trustProxy:0,maxUpload:5242880,openRouterApiKeys:[]};
const backend=createApplication(db,config);
await new Promise(r=>backend.server.listen(0,'127.0.0.1',r));
config.origin=`http://127.0.0.1:${backend.server.address().port}`;
let sim=createSimulator({dataDir:dir,defaultUrl:config.origin}),origin=await sim.listen(0);
const until=async condition=>{const end=Date.now()+6000;while(Date.now()<end){if(condition())return;await new Promise(r=>setTimeout(r,10));}throw Error('Timeout');};
async function request(url,method='GET',body,auth,sourceOrigin) {
  const r=await fetch(url,{method,headers:{...(sourceOrigin?{Origin:sourceOrigin}:{}),'Content-Type':'application/json',...(auth?{Cookie:auth.cookie,'X-CSRF-Token':auth.csrf}:{})},body:body===undefined?undefined:JSON.stringify(body)});
  return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};
}
const local=(path,body)=>request(origin+path,'POST',body,undefined,origin);
const web=(path,method,body,auth)=>request(config.origin+'/api'+path,method,body,auth,config.origin);
try {
  const teacher=await web('/auth/register','POST',{email:'standalone@example.test',password:'standalone-test-password-2026'});
  assert.equal(teacher.status,201);const owner=teacher.data.id,auth={cookie:teacher.cookie,csrf:teacher.data.csrf};
  db.prepare('INSERT INTO classes VALUES (?,?,?,0)').run('class',owner,'Lớp thử');
  for(let i=0;i<2;i++)db.prepare('INSERT INTO students VALUES (?,?,?,?)').run('student'+i,'class',String(i),'Học sinh '+i);
  db.prepare('INSERT INTO question_banks(id,owner_teacher_id,name) VALUES (?,?,?)').run('bank',owner,'Đề');
  for(let i=0;i<2;i++)db.prepare('INSERT INTO questions VALUES (?,?,?)').run('q'+i,'bank',JSON.stringify({question:'Câu hỏi',option_a:'A',option_b:'B',option_c:'C',option_d:'D',correct_answer:'A'}));
  const session=backend.quiz.create(owner,{class_id:'class',bank_id:'bank',name:'Simulator',config:{count:2,seconds:60,random:false,auto_next:false,allow_change:true,pass_mark:5,leaderboard:false}});
  const code=(await web(`/sessions/${session}/pairing/open`,'POST',{command_id:randomUUID(),expected_version:0},auth)).data.room_code;
  const created=await local('/api/devices',{name:'ESP32 riêng',url:config.origin});assert.equal(created.status,201);const id=created.data.id;
  assert.equal((await local(`/api/devices/${id}/join`,{roomCode:code})).status,200);
  let device=sim.devices.get(id);await until(()=>device.synced);assert.equal(device.snapshot.assignment,'UNASSIGNED');
  const deviceId=device.config.deviceId;
  assert.equal(db.prepare('SELECT count(*) n FROM devices').get().n,1);
  assert.equal((await web(`/devices/${deviceId}/ticket`,'POST',{},auth)).status,403); // website simulator is disabled
  const state=await request(origin+'/api/state');assert.equal(JSON.stringify(state.data).includes(device.config.secret),false);
  const persisted=JSON.parse(readFileSync(join(dir,'devices.json')));assert.equal(persisted.devices[0].deviceId,deviceId);
  const student=db.prepare('SELECT id FROM session_students WHERE session_id=? ORDER BY student_code').get(session).id;
  assert.equal((await web(`/sessions/${session}/bindings/${student}`,'PUT',{device_id:deviceId},auth)).status,200);
  await until(()=>device.snapshot.binding_id);
  await local(`/api/devices/${id}/press`,{choice:'C'});await until(()=>device.ack.startsWith('Đã nhận'));
  assert.equal(db.prepare('SELECT test_choice FROM room_devices WHERE device_id=?').get(deviceId).test_choice,'C');
  const command=async action=>{const version=db.prepare('SELECT state_version FROM quiz_sessions WHERE id=?').get(session).state_version;return web(`/sessions/${session}/commands`,'POST',{action,command_id:randomUUID(),expected_version:version},auth);};
  assert.equal((await command('start')).status,200);await until(()=>device.snapshot.state==='RUNNING');
  await local(`/api/devices/${id}/drop-ack`,{});await local(`/api/devices/${id}/press`,{choice:'A'});
  await until(()=>!device.config.pending && device.ack.includes('gói gửi lại'));
  assert.equal(db.prepare('SELECT count(*) n FROM answers').get().n,1);
  await local(`/api/devices/${id}/press`,{choice:'D'});await until(()=>!device.config.pending);assert.equal(db.prepare('SELECT choice FROM answers').get().choice,'D');
  await local(`/api/devices/${id}/resend`,{});await until(()=>device.ack.includes('gói gửi lại'));assert.equal(db.prepare('SELECT seq FROM answers').get().seq,2);
  assert.equal((await command('pause')).status,200);await until(()=>device.snapshot.state==='PAUSED');
  await local(`/api/devices/${id}/press`,{choice:'B'});await until(()=>device.ack.startsWith('Đã nhận'));assert.equal(db.prepare('SELECT choice FROM answers').get().choice,'D');
  await local(`/api/devices/${id}/network`,{});assert.equal((await local(`/api/devices/${id}/press`,{choice:'A'})).status,400);
  await local(`/api/devices/${id}/network`,{});await until(()=>device.synced);assert.equal(device.snapshot.current_answer.choice,'D');
  await sim.close();sim=createSimulator({dataDir:dir,defaultUrl:config.origin});origin=await sim.listen(0);device=sim.devices.get(id);await until(()=>device.synced);
  assert.equal(device.config.deviceId,deviceId);assert.equal(db.prepare('SELECT count(*) n FROM devices').get().n,1);
  assert.equal((await command('resume')).status,200);await until(()=>device.snapshot.state==='RUNNING');
  await local(`/api/devices/${id}/reboot`,{});await until(()=>device.synced);await local(`/api/devices/${id}/press`,{choice:'A'});await until(()=>!device.config.pending);assert.equal(db.prepare('SELECT seq FROM answers').get().seq,3);
  db.prepare("UPDATE session_questions SET deadline_at=? WHERE session_id=? AND status='OPEN'").run(Date.now()-1,session);backend.quiz.tick();backend.realtime.schedule();await until(()=>device.snapshot.question.status==='CLOSED');
  assert.equal((await local(`/api/devices/${id}/press`,{choice:'B'})).status,400);
  assert.equal((await command('finish')).status,200);
  assert.equal((await web(`/sessions/${session}/report`,'GET',undefined,auth)).status,200);
  assert.equal((await web(`/devices/${deviceId}/revoke`,'POST',{},auth)).status,200);await until(()=>device.stopped);assert.equal(device.status,'Thiết bị bị thu hồi');
  assert.deepEqual(db.pragma('foreign_key_check'),[]);
  console.log('Simulator độc lập + backend thật: ROOM ID không login/ticket, ghép/bấm thử, đáp án, retry ACK, pause, mất mạng, restart giữ ID, deadline, báo cáo, thu hồi: đạt.');
}finally{await sim.close();await backend.close();db.close();rmSync(dir,{recursive:true});}
