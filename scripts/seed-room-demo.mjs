import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { openDb, acquireAppLock } from '../dist/server/server/db.js';
import { Quiz } from '../dist/server/server/quiz.js';
import { questionSchema } from '../dist/server/shared/protocol.js';
const email=process.argv[2]?.trim().toLowerCase();
if(!email)throw Error('Dừng app, backup rồi chạy: npm run demo:create -- email-giao-vien');
const path=process.env.DATABASE_PATH||'./data/app.sqlite';
const release=acquireAppLock(path),db=openDb(path);
try{
 const teacher=db.prepare('SELECT id FROM teachers WHERE email=?').get(email);
 if(!teacher)throw Error('Không tìm thấy tài khoản giáo viên.');
 const sample=JSON.parse(readFileSync(new URL('../samples/demo-room-id-10-cau.json',import.meta.url),'utf8'));
 const questions=sample.questions.map(q=>questionSchema.parse(q));
 const result=db.transaction(()=>{
  const classId=randomUUID(),bankId=randomUUID();
  db.prepare('INSERT INTO classes VALUES (?,?,?,0)').run(classId,teacher.id,sample.class_name);
  sample.students.forEach((name,i)=>db.prepare('INSERT INTO students VALUES (?,?,?,?)').run(randomUUID(),classId,`DEMO${String(i+1).padStart(2,'0')}`,name));
  db.prepare('INSERT INTO question_banks(id,owner_teacher_id,name,subject) VALUES (?,?,?,?)').run(bankId,teacher.id,sample.bank_name,'Toán — dữ liệu demo');
  for(const q of questions)db.prepare('INSERT INTO questions VALUES (?,?,?)').run(randomUUID(),bankId,JSON.stringify(q));
  const sessionId=new Quiz(db).create(teacher.id,{class_id:classId,bank_id:bankId,name:'DEMO ROOM ID — 10 câu',config:{count:10,seconds:15,random:false,auto_next:true,allow_change:true,pass_mark:5,leaderboard:false}});
  return {classId,bankId,sessionId,students:sample.students.length,questions:questions.length};
 })();
 console.log(JSON.stringify(result));
}finally{db.close();release();}
