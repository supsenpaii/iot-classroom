import type { Config } from "../../shared/protocol";
import { Field } from "./components";

export function ConfigFields({ config }: { config?: Partial<Config> }) {
  const c = config || {
    count: 20,
    seconds: 30,
    random: true,
    auto_next: true,
    allow_change: true,
    pass_mark: 5,
    leaderboard: true,
  };
  return (
    <>
      <div className="form-grid">
        <Field label="Số câu">
          <input
            name="count"
            type="number"
            min={1}
            max={100}
            required
            defaultValue={c.count}
          />
        </Field>
        <Field label="Thời gian / câu (giây)">
          <input
            name="seconds"
            type="number"
            min={5}
            max={300}
            required
            defaultValue={c.seconds}
          />
        </Field>
        <Field label="Ngưỡng đạt / 10">
          <input
            name="pass_mark"
            type="number"
            min={0}
            max={10}
            step="0.1"
            required
            defaultValue={c.pass_mark}
          />
        </Field>
      </div>
      <label className="check">
        <input name="random" type="checkbox" defaultChecked={c.random} /> Chọn
        câu ngẫu nhiên, không lặp
      </label>
      <fieldset className="choice-field">
        <legend>Chuyển câu sau khi hết giờ</legend>
        <label><input name="auto_next" type="radio" value="true" defaultChecked={!!c.auto_next} /> Tự chuyển sau 3 giây</label>
        <label><input name="auto_next" type="radio" value="false" defaultChecked={!c.auto_next} /> Giáo viên bấm chuyển câu</label>
      </fieldset>
      <label className="check">
        <input
          name="allow_change"
          type="checkbox"
          defaultChecked={c.allow_change}
        />{" "}
        Cho đổi đáp án đến hết giờ
      </label>
      <label className="check">
        <input
          name="leaderboard"
          type="checkbox"
          defaultChecked={c.leaderboard !== false}
        />{" "}
        Thi đua: tính điểm theo đúng + nhanh, hiện bảng xếp hạng khi công bố kết
        quả và bục vinh danh cuối buổi
      </label>
    </>
  );
}
export function readConfig(f: Record<string, FormDataEntryValue>): Config {
  return {
    count: Number(f.count),
    seconds: Number(f.seconds),
    pass_mark: Number(f.pass_mark),
    random: f.random === "on",
    auto_next: f.auto_next === "true",
    allow_change: f.allow_change === "on",
    leaderboard: f.leaderboard === "on",
  };
}
