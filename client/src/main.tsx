import { lazy, Suspense, useEffect, useRef, useState, type FormEvent } from "react";
import { createRoot } from "react-dom/client";
// Weight stylesheets include unicode-range so Vietnamese and Latin use the same family.
import "@fontsource/plus-jakarta-sans/400.css";
import "@fontsource/plus-jakarta-sans/500.css";
import "@fontsource/plus-jakarta-sans/600.css";
import "@fontsource/plus-jakarta-sans/700.css";
import { api, fields, setCsrf, signedOut, type Data } from "./api";
import { Context, Head, Field, Icon, Status } from "./components";
import type { RequestScope } from "./pages/study-plan-requests";
// Preserve stylesheet order so asynchronously loaded pages keep the theme overrides.
import "./pages/class-management.css";
import "./pages/student.css";
import "./styles.css";
import { ThemeToggle } from "./theme";
import "./theme.css";
const Dashboard = lazy(() => import("./pages/manage").then(m => ({ default: m.Dashboard })));
const Classes = lazy(() => import("./pages/manage").then(m => ({ default: m.Classes })));
const Devices = lazy(() => import("./pages/manage").then(m => ({ default: m.Devices })));
const Setup = lazy(() => import("./pages/manage").then(m => ({ default: m.Setup })));
const Banks = lazy(() => import("./pages/banks").then(m => ({ default: m.Banks })));
const SessionPage = lazy(() => import("./pages/session").then(m => ({ default: m.SessionPage })));
const Presentation = lazy(() => import("./pages/session").then(m => ({ default: m.Presentation })));
const ImportReportPage = lazy(() => import("./pages/reports").then(m => ({ default: m.ImportReportPage })));
const Reports = lazy(() => import("./pages/reports").then(m => ({ default: m.Reports })));
const Simulator = lazy(() => import("./pages/simulator").then(m => ({ default: m.Simulator })));
const Decks = lazy(() => import("./pages/flashcards").then(m => ({ default: m.Decks })));
const FlashcardReview = lazy(() => import("./pages/flashcards").then(m => ({ default: m.FlashcardReview })));
const Study = lazy(() => import("./pages/flashcards").then(m => ({ default: m.Study })));
const Polls = lazy(() => import("./pages/polls").then(m => ({ default: m.Polls })));
const AttendancePage = lazy(() => import("./pages/attendance").then(m => ({ default: m.AttendancePage })));
const StudentPage = lazy(() => import("./pages/student").then(m => ({ default: m.StudentPage })));
const nav = [
  ["/dashboard", "home", "Tổng quan"],
  ["/question-banks", "file", "Ngân hàng câu hỏi"],
  ["/flashcards", "cards", "Flashcard"],
  ["/polls", "poll", "Khảo sát nhanh"],
  ["/attendance", "check", "Điểm danh"],
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
  const noticeOwners = useRef<{ error?: RequestScope; message?: RequestScope }>({});
  const path = window.location.pathname;
  const studentPage = path === "/student" || path === "/student/";
  useEffect(() => {
    if (studentPage || path.startsWith("/present/") || path.startsWith("/study/")) {
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
    if (!user || studentPage || path.startsWith("/present/") || path.startsWith("/study/"))
      return;
    const verify = () => {
      if (document.visibilityState === "visible")
        void fetch("/api/auth/me").then((r) => {
          if (r.status === 401) signedOut();
        }).catch(() => {});
    };
    document.addEventListener("visibilitychange", verify);
    return () => document.removeEventListener("visibilitychange", verify);
  }, [user, path]);
  async function run(fn: () => Promise<unknown>, success = "", scope?: RequestScope) {
    if (scope && !scope.isCurrent()) return;
    setBusy((n) => n + 1);
    noticeOwners.current = {};
    setError("");
    setMessage("");
    if (scope) void scope.cancelled.then(() => {
      if (noticeOwners.current.error === scope) {
        delete noticeOwners.current.error;
        setError("");
      }
      if (noticeOwners.current.message === scope) {
        delete noticeOwners.current.message;
        setMessage("");
      }
    });
    try {
      const task = fn();
      await (scope ? Promise.race([task, scope.cancelled]) : task);
      if (!scope || scope.isCurrent()) {
        noticeOwners.current.message = scope;
        setMessage(success);
      }
    } catch (e) {
      if (!scope || scope.isCurrent()) {
        noticeOwners.current.error = scope;
        setError((e as Error).message);
      }
    } finally {
      setBusy((n) => n - 1);
    }
  }
  if (studentPage) return <StudentPage />;
  if (path.startsWith("/present/"))
    return <><Presentation id={path.split("/")[2]} /><ThemeToggle floating /></>;
  if (path.startsWith("/study/")) return <><Study token={path.split("/")[2]} /><ThemeToggle floating /></>;
  if (loading)
    return (
      <div className="login">
        <ThemeToggle floating />
        <Status loading />
      </div>
    );
  const registering = path === "/register";
  async function submitAuth(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const input = fields(e.currentTarget);
    if (registering && input.password !== input.confirm) {
      setError("Hai mật khẩu chưa trùng nhau.");
      return;
    }
    await run(async () => {
      const u = await api(
        registering ? "/auth/register" : "/auth/login",
        "POST",
        registering
          ? { email: input.email, password: input.password }
          : input,
      );
      setCsrf(u.csrf);
      setUser(u);
      if (path === "/login" || registering)
        window.location.href = "/dashboard";
    });
  }
  if (!user)
    return (
      <main className="login">
        <ThemeToggle floating />
        <div className="login-brand">
          <Icon name="book" />
          <h1>
            Smart
            <br />
            Class<span>.</span>
          </h1>
          <p>Mỗi câu trả lời đều được lắng nghe.</p>
          <div className="login-art">
            <span className="choice-a">A</span>
            <span className="choice-b">B</span>
            <span className="choice-c">C</span>
            <span className="choice-d">D</span>
          </div>
        </div>
        <form onSubmit={submitAuth} className="login-form">
          <p className="eyebrow">KHÔNG GIAN DẠY HỌC</p>
          <h2>{registering ? "Tạo tài khoản giáo viên." : "Chào mừng thầy cô."}</h2>
          <p className="muted">
            {registering
              ? "Đăng ký để tạo lớp học và bắt đầu kiểm tra."
              : "Đăng nhập để bắt đầu giờ học."}
          </p>
          <Field label="Email">
            <input name="email" type="email" autoComplete="username" required />
          </Field>
          <Field label="Mật khẩu">
            <input
              name="password"
              type="password"
              maxLength={200}
              autoComplete={registering ? "new-password" : "current-password"}
              required
            />
          </Field>
          {registering && (
            <Field label="Nhập lại mật khẩu">
              <input
                name="confirm"
                type="password"
                maxLength={200}
                autoComplete="new-password"
                required
              />
            </Field>
          )}
          <Status error={error} />
          <button className="primary" disabled={!!busy}>
            {busy
              ? registering
                ? "Đang tạo tài khoản…"
                : "Đang đăng nhập…"
              : registering
                ? "Tạo tài khoản →"
                : "Đăng nhập →"}
          </button>
          <small>
            {registering ? "Đã có tài khoản? " : "Chưa có tài khoản? "}
            <a href={registering ? "/login" : "/register"}>
              {registering ? "Đăng nhập" : "Đăng ký ngay"}
            </a>
          </small>
          <a href="/student">Học sinh: vào phòng làm bài</a>
        </form>
      </main>
    );
  const id = path.split("/")[2];
  let content;
  if (path === "/sessions/new") content = <Setup />;
  else if (path.startsWith("/sessions/")) content = <SessionPage id={id} />;
  else if (path.startsWith("/classes")) content = <Classes id={id} />;
  else if (path.startsWith("/question-banks"))
    content = <Banks id={id} worksheet={path.endsWith("/worksheet")} />;
  else if (path.startsWith("/flashcards/review/"))
    content = <FlashcardReview id={path.split("/")[3]} />;
  else if (path.startsWith("/flashcards")) content = <Decks id={id} />;
  else if (path.startsWith("/polls")) content = <Polls id={id} />;
  else if (path.startsWith("/attendance")) content = <AttendancePage id={id} />;
  else if (path.startsWith("/devices")) content = <Devices />;
  else if (path === "/reports/import" || path === "/reports/import/")
    content = <ImportReportPage />;
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
          <Field label="Mật khẩu mới">
            <input
              name="password"
              type="password"
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
              SmartClass<small>LỚP HỌC TƯƠNG TÁC</small>
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
              SmartClass <span className="muted">/</span> Không gian giáo viên
            </span>
            <div className="topbar-actions">
              <ThemeToggle />
              <a href="/account" className="avatar" aria-label="Tài khoản">
                GV
              </a>
            </div>
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
          <footer>SmartClass · Cùng nhau tiến xa hơn</footer>
        </div>
      </div>
    </Context.Provider>
  );
}
createRoot(document.getElementById("root")!).render(
  <Suspense fallback={<div className="login"><Status loading /></div>}>
    <App />
  </Suspense>,
);
