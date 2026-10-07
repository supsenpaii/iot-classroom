import { EventEmitter } from 'node:events';
import { randomBytes, randomUUID } from 'node:crypto';
import WebSocket from 'ws';

export function serverUrl(value) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/')
    throw Error('Nhập địa chỉ server HTTP/HTTPS, không có đường dẫn hoặc thông tin đăng nhập.');
  return url.origin;
}
const scope = s => [s.mode || 'quiz', s.id, s.binding_id, s.question?.id, s.card?.id].join(':');
const errors = {
  QUESTION_CLOSED: 'Câu đã đóng hoặc hết giờ', SESSION_PAUSED: 'Bài đang tạm dừng',
  STALE_SEQUENCE: 'Gói cũ bị từ chối', DEVICE_NOT_ASSIGNED: 'Chưa ghép học sinh hoặc đã hết quyền',
  ANSWER_LOCKED: 'Đáp án đầu tiên đã khóa', REQUEST_REUSED: 'Mã gửi lại khác nội dung',
  STORAGE_ERROR: 'Server chưa lưu được dữ liệu; đang thử lại', CARD_CHANGED: 'Đã chuyển thẻ',
  REVIEW_CLOSED: 'Đã kết thúc ôn tập', POLL_CLOSED: 'Đã đóng khảo sát',
  ATTENDANCE_CLOSED: 'Đã đóng điểm danh', DEVICE_BUSY: 'Thiết bị đang ở buổi khác',
};
export class Device extends EventEmitter {
  constructor(config, save, { retryMs = 1200 } = {}) {
    super(); this.config = config; this.save = save; this.retryMs = retryMs;
    this.snapshot = { state: 'WAITING' }; this.status = 'Chưa kết nối'; this.ack = 'Chưa gửi';
    this.log = []; this.seq = 0; this.synced = false; this.offline = false;
    this.stopped = true; this.attempt = 0; this.epoch = 0; this.dropAck = false;
  }
  view() {
    return { id: this.config.id, name: this.config.name, url: this.config.url,
      deviceId: this.config.deviceId || null, status: this.status, ack: this.ack,
      connected: this.socket?.readyState === WebSocket.OPEN && this.synced,
      offline: this.offline, joining: !!this.joining, dropAck: this.dropAck,
      snapshot: this.snapshot, offset: this.offset || 0, log: this.log,
      pending: this.config.pending ? { type: this.config.pending.type, choice: this.config.pending.choice, request_id: this.config.pending.request_id } : null,
      hasLast: !!this.config.last, queued: this.config.queued?.choice || null };
  }
  note(message) {
    this.log.unshift({ time: Date.now(), message }); this.log = this.log.slice(0, 30);
    this.emit('change');
  }
  persist() { this.save(); this.emit('change'); }
  async join(url, roomCode) {
    if (this.joining) throw Error('Đang vào phòng, hãy đợi phản hồi.');
    if (this.config.pending) throw Error('Còn gói chờ ACK. Nối lại và xử lý gói đó trước khi đổi phòng.');
    url = serverUrl(url); roomCode = String(roomCode).replace(/\s/g, '');
    if (!/^\d{8}$/.test(roomCode)) throw Error('ROOM ID phải gồm 8 chữ số.');
    if (this.config.deviceId && this.config.url !== url)
      throw Error('Thiết bị đã đăng ký ở server khác. Tạo thiết bị mô phỏng mới để dùng server này.');
    if (!this.config.secret) this.config.secret = randomBytes(32).toString('hex');
    if (!this.config.joinPacket || this.config.joinPacket.room_code !== roomCode || this.config.url !== url)
      this.config.joinPacket = { v: 1, room_code: roomCode, request_id: randomUUID(), device_name: this.config.name,
        device_secret: this.config.secret, ...(this.config.deviceId ? { device_id: this.config.deviceId } : {}) };
    this.config.url = url; this.persist();
    this.joining = true; this.status = 'Đang vào phòng…'; this.emit('change');
    const controller = new AbortController(); this.joinAbort = controller;
    try {
      const response = await fetch(url + '/api/device-pairing/join', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(this.config.joinPacket), signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]),
        redirect: 'error',
      });
      const result = await response.json();
      if (!response.ok) throw Error(result.message || `Không vào được phòng (${response.status})`);
      if (typeof result.device_id !== 'string') throw Error('Server trả cấu hình thiết bị không hợp lệ.');
      const expectedSocket = url.replace(/^http/, 'ws') + '/ws';
      if (result.ws_url !== expectedSocket) throw Error('Địa chỉ WebSocket khác server đã chọn. Kiểm tra PUBLIC_ORIGIN trên web.');
      this.config.deviceId = result.device_id; this.config.name = result.label || this.config.name;
      this.config.wsUrl = expectedSocket; this.config.joinPacket = null;
      this.persist(); this.note(result.duplicate ? 'Đã khôi phục kết quả vào phòng sau retry.' : result.status === 'ASSIGNED' ? 'Đã tự vào phòng và ghép học sinh. Kiểm tra tên trên web giáo viên.' : 'Đã tự vào phòng. Chọn học sinh trên web giáo viên.');
      this.offline = false; this.connect();
    } catch (error) {
      this.status = 'Không vào được phòng';
      this.note(error.name === 'TimeoutError' || error.name === 'TypeError' ? 'Mất kết nối khi vào phòng. Bấm lại cùng mã để retry nguyên gói.' : error.message);
      throw error;
    } finally { this.joining = false; this.joinAbort = null; this.emit('change'); }
  }
  disconnect() {
    this.stopped = true; this.epoch++; this.synced = false;
    clearTimeout(this.reconnectTimer); clearTimeout(this.retryTimer);
    this.socket?.terminate(); this.socket = null;
  }
  connect() {
    if (!this.config.deviceId) throw Error('Nhập ROOM ID để đăng ký thiết bị trước.');
    this.disconnect(); this.stopped = false; this.offline = false; this.attempt = 0;
    this.open();
  }
  open() {
    if (this.stopped || this.offline) return;
    const epoch = this.epoch;
    this.status = this.attempt ? 'Đang tự nối lại…' : 'Đang kết nối…'; this.emit('change');
    const ws = new WebSocket(this.config.wsUrl, { headers: { Authorization: `Bearer ${this.config.secret}`, 'X-Device-Id': this.config.deviceId },
      handshakeTimeout: 10000, maxPayload: 4096, perMessageDeflate: false });
    this.socket = ws; this.synced = false;
    ws.on('message', bytes => {
      if (epoch !== this.epoch) return;
      try { this.receive(JSON.parse(bytes)); }
      catch { this.note('Không đọc được gói từ server.'); ws.close(1008); }
    });
    ws.on('error', () => { if (epoch === this.epoch) this.note('Không kết nối được WebSocket; kiểm tra mạng, địa chỉ và quyền thiết bị.'); });
    ws.on('close', code => {
      if (epoch !== this.epoch) return;
      this.synced = false; clearTimeout(this.retryTimer);
      if (code === 4001 || code === 4002) {
        this.stopped = true; this.status = code === 4001 ? 'Thiết bị bị thu hồi' : 'Kết nối bị thay thế';
      } else if (!this.stopped && !this.offline) {
        this.status = 'Mất kết nối · chờ nối lại';
        this.reconnectTimer = setTimeout(() => this.open(), Math.min(10000, 1000 * 2 ** this.attempt++) + Math.random() * 300);
      }
      this.emit('change');
    });
  }
  receive(msg) {
    if (msg.type === 'session.snapshot') {
      const s = msg.data;
      if (!s || typeof s.state !== 'string') throw Error('Invalid snapshot');
      if (this.synced && s.id === this.snapshot.id && (s.mode || 'quiz') === (this.snapshot.mode || 'quiz') && s.state_version < this.snapshot.state_version) return;
      const changed = scope(s) !== scope(this.snapshot);
      this.snapshot = s; this.offset = s.server_time - Date.now(); this.synced = true;
      this.status = 'Đã kết nối'; this.attempt = 0;
      const hadQueued = !!this.config.queued;
      if (changed) { this.seq = s.current_answer?.seq || 0; this.config.queued = null; }
      else this.seq = Math.max(this.seq, s.current_answer?.seq || 0);
      if (this.config.pending?.type === 'answer.submit' && this.config.pending.binding_id === s.binding_id && this.config.pending.question_instance_id === s.question?.id)
        this.seq = Math.max(this.seq, this.config.pending.seq);
      if (changed && hadQueued) this.persist(); else this.emit('change');
      if (this.config.pending) this.transmit();
    } else if (['answer.ack', 'flashcard.ack', 'poll.ack', 'attendance.ack'].includes(msg.type)) {
      if (this.dropAck) { this.dropAck = false; this.note('Đã mô phỏng mất ACK; sẽ gửi lại nguyên gói.'); return; }
      this.ack = msg.accepted ? `Đã ACK ${msg.choice || (msg.rating === 'KNOWN' ? 'Nhớ' : msg.rating === 'AGAIN' ? 'Chưa nhớ' : 'điểm danh')}${msg.duplicate ? ' · gói gửi lại' : ''}` : `Từ chối: ${errors[msg.code] || msg.code}`;
      this.note(this.ack);
      if (this.config.pending?.request_id === msg.request_id) {
        this.config.pending = null; clearTimeout(this.retryTimer);
        const queued = this.config.queued; this.config.queued = null; this.persist();
        if (queued && queued.scope === scope(this.snapshot)) this.press(queued.choice);
      }
    } else if (msg.type === 'button.ack') {
      this.ack = msg.assigned ? 'Đã nhận bấm thử · đã ghép học sinh' : 'Đã nhận bấm thử · chưa ghép học sinh'; this.note(this.ack);
    } else if (msg.type === 'error') {
      this.ack = errors[msg.code] || `Lỗi: ${msg.code}`; this.note(this.ack);
      if (msg.code !== 'STORAGE_ERROR') { this.config.pending = null; this.config.queued = null; clearTimeout(this.retryTimer); this.persist(); }
    }
  }
  press(choice) {
    if (!['A', 'B', 'C', 'D', 'OK', 'DEL'].includes(choice)) throw Error('Phím không hợp lệ.');
    if (!this.synced || this.socket?.readyState !== WebSocket.OPEN) throw Error('Thiết bị chưa kết nối; không ghi đáp án offline.');
    const s = this.snapshot;
    let packet;
    if (s.mode === 'attendance') packet = { v: 1, type: 'attendance.checkin', request_id: randomUUID(), attendance_id: s.id };
    else if (s.mode === 'poll') {
      if (!'ABCD'.includes(choice) || 'ABCD'.indexOf(choice) >= s.options) throw Error(`Khảo sát chỉ nhận ${'ABCD'.slice(0, s.options)}.`);
      packet = { v: 1, type: 'poll.vote', request_id: randomUUID(), poll_id: s.id, choice };
    } else if (s.mode === 'flashcard') {
      const rating = ['A', 'OK'].includes(choice) ? 'KNOWN' : ['B', 'DEL'].includes(choice) ? 'AGAIN' : null;
      if (!rating) throw Error('Ôn tập: A/OK = Nhớ, B/DEL = Chưa nhớ.');
      packet = { v: 1, type: 'flashcard.rate', request_id: randomUUID(), review_id: s.id, card_id: s.card.id, rating };
    } else {
      if (!'ABCD'.includes(choice)) throw Error('Kiểm tra sử dụng phím A/B/C/D.');
      if (['LOBBY', 'PAUSED'].includes(s.state)) {
        this.socket.send(JSON.stringify({ v: 1, type: 'button.test', choice })); this.ack = `Đang bấm thử ${choice}…`; this.emit('change'); return;
      }
      if (!s.binding_id) throw Error('Chưa ghép học sinh trên web giáo viên.');
      if (s.state !== 'RUNNING' || s.question?.status !== 'OPEN' || s.question.deadline_at <= Date.now() + this.offset) throw Error('Câu chưa mở hoặc đã hết giờ.');
      packet = { v: 1, type: 'answer.submit', request_id: randomUUID(), session_id: s.id,
        question_instance_id: s.question.id, binding_id: s.binding_id, seq: this.seq + 1, choice };
    }
    if (this.config.pending) {
      this.config.queued = { choice, scope: scope(s) }; this.persist(); this.ack = 'Chờ ACK · giữ lựa chọn mới nhất'; this.emit('change'); return;
    }
    if (packet.type === 'answer.submit') this.seq = packet.seq;
    this.config.pending = packet; this.config.last = packet; this.persist();
    this.ack = `Đang gửi ${choice} · chờ ACK…`; this.note(this.ack); this.transmit();
  }
  transmit() {
    clearTimeout(this.retryTimer);
    if (!this.config.pending || !this.synced || this.socket?.readyState !== WebSocket.OPEN) return;
    this.socket.send(JSON.stringify(this.config.pending));
    this.retryTimer = setTimeout(() => this.transmit(), this.retryMs);
  }
  resend() {
    if (!this.config.last || !this.synced) throw Error('Chưa có gói đã gửi hoặc chưa kết nối.');
    if (this.config.pending) throw Error('Đang chờ ACK; gói chờ sẽ tự gửi lại.');
    this.socket.send(JSON.stringify(this.config.last)); this.note('Đã gửi lại nguyên gói cuối.');
  }
  network() {
    if (this.offline) this.connect();
    else { this.disconnect(); this.offline = true; this.status = 'Mất mạng mô phỏng'; this.note('Đã ngắt mạng, giữ cấu hình và gói chờ ACK.'); }
  }
  reboot() {
    this.disconnect(); this.snapshot = { state: 'WAITING' }; this.seq = 0; this.config.queued = null;
    this.persist(); this.note('Khởi động lại: giữ Device ID và gói chờ ACK, lấy snapshot mới.'); this.connect();
  }
  stop() { this.joinAbort?.abort(); this.disconnect(); }
}
