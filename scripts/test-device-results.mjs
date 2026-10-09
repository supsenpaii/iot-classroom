import assert from 'node:assert/strict';
import { openDb } from '../dist/server/server/db.js';
import { Quiz } from '../dist/server/server/quiz.js';
const db=openDb(':memory:');
try {
 db.exec(`INSERT INTO teachers VALUES ('t','t@test','hash',0);
 INSERT INTO classes VALUES ('c','t','Class',0);
 INSERT INTO question_banks(id,owner_teacher_id,name) VALUES ('bank','t','Bank');
 INSERT INTO devices(id,owner_teacher_id,label,secret_hash) VALUES ('d','t','Device','hash');
 INSERT INTO quiz_sessions(id,owner_teacher_id,class_id,bank_id,class_name,name,room_code,config,state,current_order,created_at) VALUES ('s','t','c','bank','Class','Quiz','123','{"count":4,"seconds":20,"pass_mark":5,"leaderboard":false}','RUNNING',3,0);
 INSERT INTO session_students(id,session_id,student_id,student_code,full_name) VALUES ('st','s','student','001','Student');
 INSERT INTO session_devices VALUES ('b','s','st','d',1,0);`);
 for(let i=1;i<=4;i++) {
 db.prepare('INSERT INTO session_questions(id,session_id,question_order,data,status,voided) VALUES (?,?,?,?,?,?)').run('q'+i,'s',i,JSON.stringify({correct_answer:'A'}),i===4?'PENDING':i===3?'OPEN':'CLOSED',i===2?1:0);
 if(i<4) db.prepare('INSERT INTO answers VALUES (?,?,?,?,?,?,?)').run('q'+i,'st','b',i===3?'B':'A',1,0,100);
 }
 const quiz=new Quiz(db);
 const live=quiz.deviceSnapshot('d');
 assert.equal(live.total_questions,4);assert.equal(live.question.question_order,3);assert.equal(live.seconds_per_question,20);assert.equal(live.result,null);
 quiz.finish('s');
 const done=quiz.deviceSnapshot('d');
 assert.equal(done.state,'FINISHED');assert.deepEqual(done.result,{correct:1,total:2,score:5});
 assert.deepEqual(new Quiz(db).deviceSnapshot('d').result,done.result);
 db.prepare(`INSERT INTO quiz_sessions(id,owner_teacher_id,class_id,bank_id,class_name,name,room_code,config,state,created_at) SELECT 'next',owner_teacher_id,class_id,bank_id,class_name,name,'456',config,'LOBBY',1 FROM quiz_sessions WHERE id='s'`).run();
 db.prepare("INSERT INTO room_devices(session_id,device_id,joined_at) VALUES ('next','d',1)").run();
 assert.equal(quiz.deviceSnapshot('d').id,'next');
 assert.equal(quiz.deviceSnapshot('d').assignment,'UNASSIGNED');
 assert.equal(quiz.deviceSnapshot('d').result,undefined);
 db.prepare("DELETE FROM room_devices WHERE session_id='next'").run();
 db.prepare('UPDATE session_students SET absent=1').run();
 assert.equal(quiz.deviceSnapshot('d').result.score,null);
 db.prepare("UPDATE devices SET revoked=1 WHERE id='d'").run();assert.equal(quiz.deviceSnapshot('d').state,'WAITING');
 db.prepare("UPDATE devices SET revoked=0 WHERE id='d'").run();
 db.prepare("DELETE FROM session_events WHERE type='device.result'").run();assert.equal(quiz.deviceSnapshot('d').state,'WAITING');
 console.log('Device progress/results: counts, no early result, void/pending exclusion, score, reconnect, absence, revocation and removed-binding protection passed.');
} finally {db.close();}
