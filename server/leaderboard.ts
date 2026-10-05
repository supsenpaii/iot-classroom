import { type DB, all } from "./db.js";
// Competition points are separate from the official /10 score: a correct answer earns 500–1000
// depending on speed, and each extra answer in a correct streak adds 100 (capped at +500).
export const answerPoints = (responseMs: number | null, limitMs: number) => {
  const t = Math.min(Math.max(responseMs ?? limitMs, 0), limitMs) / limitMs;
  return Math.round(500 + 500 * (1 - t));
};
export const streakBonus = (streak: number) =>
  streak >= 2 ? 100 * Math.min(streak - 1, 5) : 0;
// Given name only ("Nguyễn Minh Anh" -> "Anh"); clashes add the family initial, then the student code.
export function displayNames(
  students: { id: string; full_name: string; student_code: string }[],
) {
  const tally = (names: string[]) =>
    names.reduce((m, n) => m.set(n, (m.get(n) ?? 0) + 1), new Map<string, number>());
  const given = students.map((s) => s.full_name.trim().split(/\s+/).at(-1) || s.full_name);
  const firstPass = tally(given);
  const second = students.map((s, i) =>
    firstPass.get(given[i])! > 1
      ? `${given[i]} ${s.full_name.trim().charAt(0).toUpperCase()}.`
      : given[i],
  );
  const secondPass = tally(second);
  return new Map(
    students.map((s, i) => [
      s.id,
      secondPass.get(second[i])! > 1 ? `${given[i]} (${s.student_code})` : second[i],
    ]),
  );
}
export function standings(db: DB, sessionId: string, seconds: number) {
  const questions = all(
    db,
    "SELECT id,data FROM session_questions WHERE session_id=? AND status='CLOSED' AND voided=0 ORDER BY question_order",
    sessionId,
  ).map((q) => ({ id: q.id as string, correct: JSON.parse(q.data).correct_answer }));
  const students = all(
    db,
    "SELECT id,full_name,student_code FROM session_students WHERE session_id=? AND absent=0",
    sessionId,
  ) as { id: string; full_name: string; student_code: string }[];
  const answers = new Map(
    all(
      db,
      "SELECT a.session_question_id q,a.session_student_id s,a.choice,a.response_ms FROM answers a JOIN session_questions sq ON sq.id=a.session_question_id WHERE sq.session_id=?",
      sessionId,
    ).map((a) => [`${a.q}:${a.s}`, a]),
  );
  const names = displayNames(students),
    limit = seconds * 1000;
  const rows = students.map((st) => {
    let points = 0,
      correct = 0,
      streak = 0,
      best_streak = 0,
      last_gain = 0,
      total_ms = 0;
    for (const q of questions) {
      const a = answers.get(`${q.id}:${st.id}`);
      if (a && a.choice === q.correct) {
        streak++;
        correct++;
        last_gain = answerPoints(a.response_ms, limit) + streakBonus(streak);
        points += last_gain;
        total_ms += a.response_ms ?? limit;
        best_streak = Math.max(best_streak, streak);
      } else {
        streak = 0;
        last_gain = 0;
      }
    }
    return {
      student_id: st.id,
      full_name: st.full_name,
      student_code: st.student_code,
      name: names.get(st.id)!,
      points,
      correct,
      streak,
      best_streak,
      last_gain,
      total_ms,
      rank: 0,
    };
  });
  rows.sort(
    (a, b) =>
      b.points - a.points ||
      b.correct - a.correct ||
      a.total_ms - b.total_ms ||
      a.name.localeCompare(b.name, "vi"),
  );
  rows.forEach((r, i) => {
    const prev = rows[i - 1];
    r.rank = prev && prev.points === r.points && prev.correct === r.correct ? prev.rank : i + 1;
  });
  return rows;
}
