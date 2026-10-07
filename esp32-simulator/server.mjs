import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync, chmodSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Device, serverUrl } from './device.mjs';

export function createSimulator({ dataDir = process.env.SIMULATOR_DATA_DIR || join(homedir(), '.iot-esp32-simulator'), defaultUrl = process.env.CLASSROOM_URL || 'https://sup-legion-y7000p-irh8.taila2cede.ts.net' } = {}) {
  const dir = resolve(dataDir), file = join(dir, 'devices.json');
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const registry = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : { devices: [] };
  if (!Array.isArray(registry.devices) || registry.devices.length > 50) throw Error('File cấu hình thiết bị không hợp lệ.');
  const devices = new Map();
  const save = () => {
    const temporary = file + '.tmp';
    writeFileSync(temporary, JSON.stringify(registry), { mode: 0o600 }); chmodSync(temporary, 0o600);
    renameSync(temporary, file);
  };
  const add = config => { const device = new Device(config, save); devices.set(config.id, device); return device; };
  registry.devices.forEach(add);
  const publicDir = fileURLToPath(new URL('./public/', import.meta.url));
  const server = createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    const port = server.address()?.port;
    const hosts = [`localhost:${port}`, `127.0.0.1:${port}`];
    if (!hosts.includes(req.headers.host)) { res.writeHead(403).end('Host không hợp lệ'); return; }
    const pathname = new URL(req.url, 'http://localhost').pathname;
    const json = (status, value) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(value)); };
    try {
      if (req.method === 'GET' && pathname === '/api/state') {
        json(200, { defaultUrl, dataDir: dir, devices: [...devices.values()].map(d => d.view()) }); return;
      }
      if (req.method === 'POST' && pathname.startsWith('/api/')) {
        if (!hosts.map(h => `http://${h}`).includes(req.headers.origin) || !req.headers['content-type']?.startsWith('application/json')) { json(403, { message: 'Mở giao diện simulator trên localhost để thao tác.' }); return; }
        let body = '', size = 0;
        for await (const chunk of req) { size += chunk.length; if (size > 4096) throw Error('Dữ liệu quá lớn.'); body += chunk; }
        const input = JSON.parse(body || '{}');
        if (pathname === '/api/devices') {
          const name = String(input.name || '').trim();
          if (!name || name.length > 80) throw Error('Tên thiết bị phải dài 1–80 ký tự.');
          if (devices.size >= 50) throw Error('Chỉ tạo tối đa 50 thiết bị mô phỏng.');
          const config = { id: randomUUID(), name, url: serverUrl(input.url || defaultUrl) };
          registry.devices.push(config); const d = add(config); save(); json(201, d.view()); return;
        }
        const match = /^\/api\/devices\/([^/]+)\/([a-z-]+)$/.exec(pathname);
        const d = match && devices.get(match[1]);
        if (!d) { json(404, { message: 'Không tìm thấy thiết bị.' }); return; }
        switch (match[2]) {
          case 'join': await d.join(input.url || d.config.url, input.roomCode); break;
          case 'press': d.press(input.choice); break;
          case 'connect': d.connect(); break;
          case 'network': d.network(); break;
          case 'reboot': d.reboot(); break;
          case 'drop-ack': d.dropAck = !d.dropAck; break;
          case 'resend': d.resend(); break;
          case 'delete':
            if (d.joining) throw Error('Đợi kết nối hoàn tất trước khi xóa.');
            d.stop(); devices.delete(d.config.id); registry.devices = registry.devices.filter(c => c.id !== d.config.id); save(); break;
          default: throw Error('Thao tác không hợp lệ.');
        }
        json(200, { ok: true }); return;
      }
      const assets = { '/': ['index.html', 'text/html'], '/app.js': ['app.js', 'text/javascript'], '/style.css': ['style.css', 'text/css'] };
      if (req.method === 'GET' && assets[pathname]) {
        const [name, type] = assets[pathname]; res.writeHead(200, { 'Content-Type': `${type}; charset=utf-8` }); res.end(readFileSync(join(publicDir, name))); return;
      }
      json(404, { message: 'Không tìm thấy đường dẫn.' });
    } catch (error) { json(400, { message: error.message || 'Không hoàn tất thao tác.' }); }
  });
  return {
    server, devices,
    async listen(port = 3210) {
      await new Promise((done, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', () => { server.removeListener('error', reject); done(); }); });
      for (const d of devices.values()) if (d.config.deviceId) d.connect();
      return `http://localhost:${server.address().port}`;
    },
    async close() { for (const d of devices.values()) d.stop(); await new Promise(done => server.close(done)); },
  };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const app = createSimulator();
  const url = await app.listen(Number(process.env.SIMULATOR_PORT || 3210));
  console.log(`ESP32 Simulator: ${url}\nKhông cần đăng nhập giáo viên. Nhập URL web và ROOM ID để kết nối.\nCtrl+C để dừng. Cấu hình được lưu riêng trên máy.`);
  let closing = false;
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => { if (closing) return; closing = true; await app.close(); process.exit(0); });
}
