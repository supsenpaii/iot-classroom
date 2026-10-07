const $ = selector => document.querySelector(selector);
const cards = new Map(); let state, selected, busy = false, polling = false, available = false;
const names = { LOBBY:'Phòng chờ', RUNNING:'Đang diễn ra', PAUSED:'Tạm dừng', WAITING:'Chờ vào phòng hoặc mở hoạt động', FINISHED:'Đã kết thúc', CANCELLED:'Đã hủy' };
function message(selector, text) { $(selector).textContent = text; $(selector).hidden = !text; }
async function command(path, body = {}) {
  const response = await fetch(path, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body) });
  const data = await response.json(); if (!response.ok) throw Error(data.message); return data;
}
async function action(id, name, body) {
  message('#error','');
  try { await command(`/api/devices/${id}/${name}`, body); await refresh(); }
  catch (e) { message('#error', e.message || 'Không kết nối được chương trình simulator.'); }
}
function select(id) { selected = id; for (const [key, card] of cards) card.classList.toggle('selected', key === id); }
function cardFor(d) {
  if (cards.has(d.id)) return cards.get(d.id);
  const card = $('#device-template').content.firstElementChild.cloneNode(true);
  card.addEventListener('pointerdown', () => select(d.id)); card.addEventListener('focusin', () => select(d.id));
  card.querySelector('.join-form').addEventListener('submit', e => {
    e.preventDefault(); void action(d.id, 'join', { url: state.devices.find(x=>x.id===d.id).url, roomCode:new FormData(e.target).get('roomCode') });
  });
  card.querySelectorAll('[data-choice]').forEach(button => button.addEventListener('click', () => void action(d.id, 'press', {choice:button.dataset.choice})));
  card.querySelectorAll('[data-action]').forEach(button => button.addEventListener('click', () => {
    if (button.dataset.action === 'delete' && !confirm('Xóa cấu hình thiết bị trên máy này? Thiết bị trên web vẫn còn; gỡ hoặc thu hồi ở web nếu cần.')) return;
    void action(d.id, button.dataset.action);
  }));
  cards.set(d.id,card); $('#devices').append(card); if (!selected) select(d.id); return card;
}
function render() {
  $('#count').textContent = state.devices.length; $('#empty').hidden = !!state.devices.length;
  for (const [id,card] of cards) if (!state.devices.some(d=>d.id===id)) {card.remove();cards.delete(id);if(selected===id)selected=null;}
  for (const d of state.devices) {
    const card = cardFor(d), s=d.snapshot, text=(selector,value)=>{card.querySelector(selector).textContent=value;};
    card.querySelectorAll('button').forEach(button=>button.disabled=false);
    text('.device-name',d.name); text('.status',d.status); card.querySelector('.status').classList.toggle('online',d.connected);
    text('.device-id',d.deviceId || 'Chưa đăng ký'); text('.server-url',d.url); text('.pending',d.pending ? `${d.pending.type} · ${d.pending.request_id}` : 'Không có');
    text('.screen-title',s.mode==='flashcard'?'ÔN TẬP FLASHCARD':s.mode==='poll'?'KHẢO SÁT':s.mode==='attendance'?'ĐIỂM DANH':'BÀI KIỂM TRA');
    text('.screen-state',names[s.state]||s.state);
    text('.screen-answer',s.mode==='flashcard'?(s.current_rating==='KNOWN'?'NHỚ':s.current_rating==='AGAIN'?'CHƯA NHỚ':'A / B'):s.mode==='poll'?(s.current_choice||'A–'+ 'ABCD'[s.options-1]):s.mode==='attendance'?(s.checked_in?'CÓ MẶT':'BẤM PHÍM'):(s.current_answer?.choice||'—'));
    text('.screen-detail',s.mode==='flashcard'?`Thẻ ${s.card?.index}/${s.card?.total} · A/OK = Nhớ · B/DEL = Chưa nhớ`:s.mode==='poll'?`${s.options} lựa chọn · bấm để gửi ý kiến`:s.mode==='attendance'?'Bấm phím bất kỳ để điểm danh':s.binding_id?`Đã ghép học sinh · ${s.question?.status==='OPEN'?'Đang nhận đáp án':s.question?.status==='CLOSED'?'Câu đã đóng':'Bấm A/B/C/D để thử'}`:'Chưa ghép học sinh · chọn học sinh trên web');
    text('.ack',d.ack); card.querySelector('.led').classList.toggle('acknowledged',d.ack.startsWith('Đã ACK')||d.ack.startsWith('Đã nhận'));
    card.querySelectorAll('[data-choice]').forEach(button => button.disabled=!available || !d.connected);
    card.querySelector('[data-action=network]').textContent=d.offline?'Nối lại mạng':'Ngắt mạng';
    card.querySelector('[data-action=drop-ack]').setAttribute('aria-pressed',String(d.dropAck));
    card.querySelector('[data-action=resend]').disabled=!d.hasLast || !d.connected || !!d.pending;
    card.querySelector('[data-action=reboot]').disabled=!d.deviceId;
    card.querySelector('[data-action=connect]').disabled=!d.deviceId;
    card.querySelector('.join-form button').disabled=d.joining;
    card.querySelector('.join-form input').disabled=d.joining;
    if(d.joining)card.querySelectorAll('[data-action]').forEach(button=>button.disabled=true);
    card.querySelector('.join-form button').textContent=d.joining?'Đang vào…':'Vào phòng';
    const log=card.querySelector('.log');log.replaceChildren(...d.log.map(entry=>{const li=document.createElement('li');li.textContent=`${new Date(entry.time).toLocaleTimeString('vi-VN')} · ${entry.message}`;return li;}));
  }
  if (!selected && state.devices.length) select(state.devices[0].id);
  clocks();
}
function clocks() {
  if(!state)return;
  for(const d of state.devices){const s=d.snapshot,q=s.question;let text='';
    if(q?.status==='OPEN')text=`${s.state==='PAUSED'?Math.ceil(q.remaining_ms/1000):Math.max(0,Math.ceil((q.deadline_at-Date.now()-d.offset)/1000))} giây ${s.state==='PAUSED'?'· đã tạm dừng':'· thời gian do server quyết định'}`;
    cards.get(d.id).querySelector('.clock').textContent=text;
  }
}
async function refresh() {
  if(polling)return;polling=true;
  try { const response=await fetch('/api/state');if(!response.ok)throw Error(); state=await response.json();available=true;
    if(!$('#url').value)$('#url').value=state.defaultUrl;
    $('#connection').textContent='Chương trình đang chạy · dữ liệu kết nối thật';render();
  } catch { available=false;$('#connection').textContent='Mất kết nối chương trình trên máy. Chạy lại npm start trong esp32-simulator.';for(const card of cards.values())card.querySelectorAll('button').forEach(b=>b.disabled=true); }
  finally{polling=false;}
}
$('#create').addEventListener('submit',async e=>{e.preventDefault();if(busy)return;busy=true;const button=e.target.querySelector('button');button.disabled=true;message('#error','');
  try{const d=await command('/api/devices',Object.fromEntries(new FormData(e.target)));selected=d.id;await refresh();select(d.id);$('#name').value=`ESP32-${String(state.devices.length+1).padStart(2,'0')}`;message('#notice','Đã thêm thiết bị. Nhập ROOM ID trong thẻ bên dưới để tự kết nối.');}
  catch(e){message('#error',e.message||'Không kết nối được simulator.');}finally{busy=false;button.disabled=false;}
});
document.addEventListener('keydown',e=>{
  if(e.repeat || ['INPUT','TEXTAREA','SELECT','BUTTON','SUMMARY'].includes(e.target.tagName)||!selected)return;
  const key=e.key.toUpperCase(), choice='ABCD'.includes(key)&&key.length===1?key:({'1':'A','2':'B','3':'C','4':'D','ENTER':'OK','BACKSPACE':'DEL'})[key];
  if(choice){e.preventDefault();void action(selected,'press',{choice});}
});
void refresh();setInterval(refresh,500);setInterval(clocks,200);
