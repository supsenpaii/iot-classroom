export type RequestScope = {
  isCurrent: () => boolean;
  cancelled: Promise<void>;
};
type Kind = "ai" | "deck" | "copy" | "practice";
export type StudyRequest = RequestScope & {
  sessionId: string;
  studentId: string;
  generation: number;
  cancel: () => void;
};

// Each operation has its own latest request; changing selection invalidates all of them.
export function createStudyRequests(sessionId: string, studentId: string) {
  let context = { sessionId, studentId }, mounted = false, generation = 0;
  const active = new Map<Kind, StudyRequest>();
  const invalidate = () => {
    for (const request of active.values()) request.cancel();
  };
  return {
    mount() { mounted = true; },
    unmount() { mounted = false; invalidate(); },
    select(sessionId: string, studentId: string) {
      invalidate();
      context = { sessionId, studentId };
    },
    begin(kind: Kind): StudyRequest {
      active.get(kind)?.cancel();
      let cancel!: () => void;
      const cancelled = new Promise<void>(resolve => { cancel = resolve; });
      const request: StudyRequest = {
        ...context,
        generation: ++generation,
        cancelled,
        isCurrent: () => mounted && active.get(kind) === request &&
          context.sessionId === request.sessionId && context.studentId === request.studentId,
        cancel: () => {
          if (active.get(kind) === request) active.delete(kind);
          cancel();
        },
      };
      active.set(kind, request);
      return request;
    },
  };
}
