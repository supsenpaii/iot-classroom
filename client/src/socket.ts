import { useEffect, useRef, useState } from "react";
import type { Data } from "./api";
import { signedOut } from "./api";
export const socketUrl = () =>
  `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/ws`;
export function useSessionSocket(id: string, projectionToken?: string) {
  const [data, setData] = useState<Data | null>(null),
    [status, setStatus] = useState("Đang kết nối…"),
    [offset, setOffset] = useState(0),
    [syncedAt, setSyncedAt] = useState<number | null>(null),
    [controlResult, setControlResult] = useState<Data | null>(null),
    [epoch, setEpoch] = useState(0);
  const socket = useRef<WebSocket | null>(null);
  useEffect(() => {
    let stopped = false,
      retry = 0,
      timer: ReturnType<typeof setTimeout>;
    function connect() {
      setStatus(retry ? "Mất kết nối · đang nối lại…" : "Đang kết nối…");
      const ws = new WebSocket(socketUrl());
      socket.current = ws;
      ws.onopen = () => {
        retry = 0;
        ws.send(
          JSON.stringify({
            v: 1,
            type: "hello",
            ...(projectionToken
              ? { ticket: projectionToken }
              : { session_id: id }),
          }),
        );
      };
      ws.onmessage = (e) => {
        const m = JSON.parse(e.data);
        if (m.type === "session.snapshot") {
          setData((old) =>
            !old || m.data.state_version >= old.state_version ? m.data : old,
          );
          setOffset(m.data.server_time - Date.now());
          setSyncedAt(Date.now());
          setStatus("Đã kết nối");
        } else if (m.type === "error")
          setStatus("Không thể đồng bộ. Kiểm tra quyền truy cập.");
        else if (m.type === "projection.command.result")
          setControlResult(m);
      };
      ws.onclose = (e) => {
        if (stopped) return;
        if (e.code === 4001) {
          setData(null);
          if (projectionToken)
            setStatus("Quyền trình chiếu đã hết hạn. Mở lại từ bảng điều khiển.");
          else signedOut();
          return;
        }
        setStatus("Mất kết nối · đang nối lại…");
        timer = setTimeout(
          connect,
          Math.min(10000, 1000 * 2 ** retry++) + Math.random() * 300,
        );
      };
      ws.onerror = () => ws.close();
    }
    connect();
    return () => {
      stopped = true;
      clearTimeout(timer);
      socket.current?.close();
    };
  }, [id, projectionToken, epoch]);
  return {
    data,
    status,
    offset,
    syncedAt,
    controlResult,
    sendProjectionNext: (command_id: string, expected_version: number) => {
      if (socket.current?.readyState !== WebSocket.OPEN) return false;
      socket.current.send(
        JSON.stringify({
          v: 1,
          type: "projection.next",
          command_id,
          expected_version,
        }),
      );
      return true;
    },
    reconnect: () => setEpoch((n) => n + 1),
  };
}
export function useClock(data: Data | null, offset: number) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(t);
  }, []);
  const q = data?.question;
  if (!q || q.status !== "OPEN") return 0;
  return Math.max(
    0,
    Math.ceil(
      (data?.state === "PAUSED"
        ? q.remaining_ms
        : q.deadline_at - now - offset) / 1000,
    ),
  );
}
