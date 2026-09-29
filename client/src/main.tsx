import { useEffect, useState, type FormEvent } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource/be-vietnam-pro/vietnamese-400.css";
import "@fontsource/be-vietnam-pro/vietnamese-600.css";
import "@fontsource/be-vietnam-pro/vietnamese-700.css";
import "@fontsource/be-vietnam-pro/latin-400.css";
import "@fontsource/be-vietnam-pro/latin-600.css";
import "@fontsource/be-vietnam-pro/latin-700.css";
import { api, fields, setCsrf, signedOut, type Data } from "./api";
import { Context, Head, Field, Icon, Status } from "./components";
import { Dashboard, Classes, Banks, Devices, Setup } from "./pages/manage";
import { SessionPage, Presentation } from "./pages/session";
import { Reports } from "./pages/reports";
import { Simulator } from "./pages/simulator";
import "./styles.css";
const nav = [
  ["/dashboard", "home", "Tổng quan"],
  ["/question-banks", "file", "Ngân hàng câu hỏi"],
  ["/classes", "users", "Lớp học"],
  ["/devices", "device", "Thiết bị"],
  ["/reports", "chart", "Báo cáo"],
];
function App() {
  const [user, setUser] = useState<Data | null>(null),
    [loading, setLoading] = useState(true),
    [message, setMessage] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(0);
  const path = window.location.pathname;
  useEffect(() => {
    if (path.startsWith("/present/")) {
      setLoading(false);
      return;
    }
    api("/auth/me")
      .then((u) => {
        setCsrf(u.csrf);
        setUser(u);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [path]);
  useEffect(() => {
    if (!user || path.startsWith("/present/")) return;
    const verify = () => {
      if (document.visibilityState === "visible")
        void fetch("/api/auth/me").then((r) => {
          if (r.status === 401) signedOut();
        }).catch(() => {});
    };
    document.addEventListener("visibilitychange", verify);
    return () => document.removeEventListener("visibilitychange", verify);
  }, [user, path]);
  async function run(fn: () => Promise<unknown>, success = "") {
    setBusy((n) => n + 1);
    setError("");
    setMessage("");
    try {
      await fn();
      setMessage(success);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy((n) => n - 1);
    }
  }
  if (path.startsWith("/present/"))
    return <Presentation id={path.split("/")[2]} />;
  if (loading)
    return (
      <div className="login">
        <Status loading />
      </div>
    );
  async function login(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const input = fields(e.currentTarget);
    await run(async () => {
      const u = await api("/auth/login", "POST", input);
      setCsrf(u.csrf);
      setUser(u);
      if (path === "/login") window.location.href = "/dashboard";
    });
  }
  if (!user)
    return (
      <main className="login">
        <div className="login-brand">
          <Icon name="book" />
          <h1>
            Lớp học
            <br />
            tương tác<span>.</span>
          </h1>
          <p>Mỗi câu trả lời đều được lắng nghe.</p>
          <div className="login-art">
            <span>A</span>
            <span>B</span>
            <span>C</span>
            <span>D</span>
          </div>
        </div>
        <form onSubmit={login} className="login-form">
          <p className="eyebrow">KHÔNG GIAN DẠY HỌC</p>
          <h2>Chào mừng thầy cô.</h2>
          <p className="muted">Đăng nhập để bắt đầu giờ học.</p>
          <Field label="Email">
            <input name="email" type="email" autoComplete="username" required />
          </Field>
          <Field label="Mật khẩu">
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              required
            />
          </Field>
          <Status error={error} />
          <button className="primary" disabled={!!busy}>
            {busy ? "Đang đăng nhập…" : "Đăng nhập →"}
          </button>
          <small>Tài khoản do người vận hành cấp.</small>
        </form>
      </main>
    );
  const id = path.split("/")[2];
  let content;
  if (path === "/sessions/new") content = <Setup />;
  else if (path.startsWith("/sessions/")) content = <SessionPage id={id} />;
  else if (path.startsWith("/classes")) content = <Classes id={id} />;
  else if (path.startsWith("/question-banks")) content = <Banks id={id} />;
  else if (path.startsWith("/devices")) content = <Devices />;
  else if (path.startsWith("/reports")) content = <Reports id={id} />;
  else if (path === "/simulator") content = <Simulator />;
  else if (path === "/account")
    content = (
      <>
        <Head eyebrow="TÀI KHOẢN" title="Đổi mật khẩu" />
        <form
          className="card form narrow"
          onSubmit={(e) => {
            e.preventDefault();
            const body = fields(e.currentTarget);
            void run(async () => {
              await api("/auth/change-password", "POST", body);
              signedOut();
            });
          }}
        >
          <Field label="Mật khẩu hiện tại">
            <input
              name="current"
              type="password"
              autoComplete="current-password"
              required
            />
          </Field>
          <Field label="Mật khẩu mới (ít nhất 12 ký tự)">
            <input
              name="password"
              type="password"
              minLength={12}
              maxLength={200}
              autoComplete="new-password"
              required
            />
          </Field>
          <button className="primary">Lưu và đăng nhập lại</button>
        </form>
      </>
    );
  else content = <Dashboard />;
  return (
    <Context.Provider value={{ user, run }}>
      <div className="shell">
        <aside className="sidebar">
          <a href="/dashboard" className="brand">
            <Icon name="book" />
            <span>
              Lớp học<small>TƯƠNG TÁC</small>
            </span>
          </a>
          <p className="nav-caption">KHÔNG GIAN DẠY HỌC</p>
          <nav>
            {nav.map(([href, icon, label]) => (
              <a
                key={href}
                href={href}
                className={
                  path.startsWith(href) ||
                  (href === "/devices" && path === "/simulator") ||
                  (href === "/classes" && path.startsWith("/sessions"))
                    ? "active"
                    : ""
                }
              >
                <Icon name={icon} />
                <span>{label}</span>
              </a>
            ))}
          </nav>
          <div className="sidebar-bottom">
            <a href="/account">
              <span className="avatar">GV</span>
              <span className="account-email">
                {user.email}
                <small>Giáo viên</small>
              </span>
            </a>
            <button
              onClick={() =>
                void run(async () => {
                  await api("/auth/logout", "POST");
                  signedOut();
                })
              }
            >
              Đăng xuất
            </button>
          </div>
        </aside>
        <div className="workspace">
          <div className="topbar">
            <span>
              Lớp học <span className="muted">/</span> Không gian giáo viên
            </span>
            <a href="/account" className="avatar" aria-label="Tài khoản">
              GV
            </a>
          </div>
          <main className="main">
            {(error || message || busy > 0) && (
              <div
                className={`notice ${error ? "error" : ""}`}
                role={error ? "alert" : "status"}
              >
                {error || message || (busy ? "Đang xử lý…" : "")}
                <button
                  onClick={() => {
                    setError("");
                    setMessage("");
                  }}
                  aria-label="Đóng thông báo"
                >
                  ×
                </button>
              </div>
            )}
            {content}
          </main>
          <footer>Lớp học tương tác · Cùng nhau tiến xa hơn</footer>
        </div>
      </div>
    </Context.Provider>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
