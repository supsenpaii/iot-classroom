import {
  createContext,
  useContext,
  useEffect,
  useState,
  useId,
  cloneElement,
  type ReactElement,
  type ReactNode,
} from "react";
import { api, type Data } from "./api";
export const Context = createContext<{
  user: Data;
  run: (fn: () => Promise<unknown>, success?: string) => Promise<void>;
}>({ user: {}, run: async () => {} });
export const useApp = () => useContext(Context);
export function useResource<T = Data>(path: string) {
  const [data, setData] = useState<T | null>(null),
    [error, setError] = useState(""),
    [version, setVersion] = useState(0);
  useEffect(() => {
    let live = true;
    api<T>(path)
      .then((d) => {
        if (live) {
          setData(d);
          setError("");
        }
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [path, version]);
  return { data, error, reload: () => setVersion((v) => v + 1), setData };
}
export function Status({
  error,
  loading,
}: {
  error?: string;
  loading?: boolean;
}) {
  if (error)
    return (
      <p role="alert" className="alert">
        {error}
      </p>
    );
  if (loading)
    return (
      <p role="status" className="empty">
        Đang tải dữ liệu…
      </p>
    );
  return null;
}
export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}
export function Head({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string;
  title: string;
  description?: string;
  children?: ReactNode;
}) {
  return (
    <header className="page-head">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        {description && <p className="subtitle">{description}</p>}
      </div>
      <div className="actions">{children}</div>
    </header>
  );
}
export function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {cloneElement(children as ReactElement<{ id: string }>, { id })}
    </div>
  );
}
export function Icon({ name }: { name: string }) {
  const paths: Record<string, ReactNode> = {
    home: (
      <>
        <path d="m3 10 9-7 9 7v11h-6v-8H9v8H3z" />
      </>
    ),
    book: (
      <>
        <path d="M12 5C7 2 3 3 2 4v16c4-2 7-1 10 1 3-2 6-3 10-1V4c-4-2-7-1-10 1Z" />
        <path d="M12 5v16" />
      </>
    ),
    file: (
      <>
        <path d="M5 2h9l5 5v15H5zM14 2v6h5M8 12h8M8 16h8" />
      </>
    ),
    poll: (
      <>
        <path d="M4 5h9M4 12h16M4 19h6" />
        <circle cx="17" cy="5" r="1.5" />
        <circle cx="13" cy="19" r="1.5" />
      </>
    ),
    check: (
      <>
        <path d="m9 11 3 3 8-8" />
        <path d="M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9" />
      </>
    ),
    cards: (
      <>
        <rect x="7" y="3" width="14" height="15" rx="2" />
        <path d="M17 21H5a2 2 0 0 1-2-2V7M11 9h6M11 13h4" />
      </>
    ),
    users: (
      <>
        <circle cx="9" cy="7" r="3" />
        <path d="M2 21v-4a7 7 0 0 1 14 0v4M16 4a3 3 0 0 1 0 6M18 14a5 5 0 0 1 4 5v2" />
      </>
    ),
    device: (
      <>
        <rect x="2" y="3" width="20" height="14" rx="2" />
        <path d="M8 22h8M12 17v5" />
      </>
    ),
    chart: (
      <>
        <path d="M4 21V10M12 21V3M20 21V7" />
      </>
    ),
    clock: (
      <>
        <circle cx="12" cy="12" r="10" />
        <path d="M12 5v8l5 3" />
      </>
    ),
    arrow: (
      <>
        <path d="M5 19 19 5M5 5h14v14" />
      </>
    ),
    settings: (
      <>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 1v3M12 20v3M1 12h3M20 12h3M4 4l3 3M17 17l3 3M4 20l3-3M17 7l3-3" />
      </>
    ),
  };
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name] || paths.file}
    </svg>
  );
}
// Each answer gets its own shape so it stays distinguishable without relying on color.
export function ChoiceShape({ choice }: { choice: string }) {
  const shapes: Record<string, ReactNode> = {
    A: <path d="M12 3 22 20H2z" />,
    B: <path d="M12 2 22 12 12 22 2 12z" />,
    C: <circle cx="12" cy="12" r="9.5" />,
    D: <rect x="3" y="3" width="18" height="18" rx="1.5" />,
  };
  return (
    <svg className="choice-shape" viewBox="0 0 24 24" aria-hidden="true">
      {shapes[choice]}
    </svg>
  );
}
