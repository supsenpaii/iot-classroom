import { parentPort, workerData } from "node:worker_threads";
import ExcelJS from "exceljs";
import { parse } from "csv-parse/sync";
import yauzl from "yauzl";
const questionHeaders = [
  "question",
  "option_a",
  "option_b",
  "option_c",
  "option_d",
  "correct_answer",
  "explanation",
  "topic",
  "difficulty",
];
async function inspectZip(buffer) {
  await new Promise((resolve, reject) =>
    yauzl.fromBuffer(buffer, { lazyEntries: true }, (err, zip) => {
      if (err) return reject(err);
      let total = 0,
        count = 0;
      zip.on("error", reject);
      zip.on("entry", (entry) => {
        total += entry.uncompressedSize;
        if (
          total > 20 * 1024 * 1024 ||
          ++count > 2000 ||
          /vbaProject|externalLinks/i.test(entry.fileName)
        ) {
          zip.close();
          reject(
            new Error(
              "XLSX chứa macro/liên kết ngoài hoặc vượt 20 MB giải nén / 2.000 mục",
            ),
          );
        } else if (entry.fileName.endsWith("/")) zip.readEntry();
        else
          zip.openReadStream(entry, (streamError, stream) => {
            if (streamError) {
              zip.close();
              reject(streamError);
              return;
            }
            let actual = 0;
            stream.on("error", (error) => {
              zip.close();
              reject(error);
            });
            stream.on("data", (chunk) => {
              actual += chunk.length;
              if (
                actual > entry.uncompressedSize ||
                actual > 20 * 1024 * 1024
              ) {
                stream.destroy();
                zip.close();
                reject(new Error("Dữ liệu giải nén vượt giới hạn"));
              }
            });
            stream.on("end", () => zip.readEntry());
          });
      });
      zip.on("end", resolve);
      zip.readEntry();
    }),
  );
}
try {
  const buffer = Buffer.from(workerData.bytes),
    kind = workerData.kind,
    headers =
      kind === "students" ? ["student_code", "full_name"] : questionHeaders;
  let rows;
  if (workerData.name.toLowerCase().endsWith(".csv")) {
    if (buffer.includes(0)) throw new Error("CSV phải là văn bản UTF-8");
    const text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
    rows = parse(text, {
      bom: true,
      skip_empty_lines: true,
      relax_column_count: true,
      max_record_size: 15000,
    });
  } else if (workerData.name.toLowerCase().endsWith(".xlsx")) {
    if (buffer[0] !== 0x50 || buffer[1] !== 0x4b)
      throw new Error("Nội dung không phải XLSX");
    await inspectZip(buffer);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
    const sheet = wb.getWorksheet(
      kind === "students" ? "Students" : "Questions",
    );
    if (!sheet)
      throw new Error(
        `Thiếu sheet ${kind === "students" ? "Students" : "Questions"}`,
      );
    if (sheet.rowCount > 501 || sheet.columnCount > 20)
      throw new Error("Tối đa 500 dòng và 20 cột");
    rows = [];
    sheet.eachRow({ includeEmpty: true }, (r) => {
      const values = [];
      for (let c = 1; c <= sheet.columnCount; c++) {
        const cell = r.getCell(c);
        if (cell.type === ExcelJS.ValueType.Formula)
          values.push({ formula: true });
        else if (
          cell.value &&
          typeof cell.value === "object" &&
          "richText" in cell.value
        )
          values.push(cell.value.richText.map((x) => x.text).join(""));
        else values.push(cell.text);
      }
      rows.push(values);
    });
  } else throw new Error("Chỉ nhận .xlsx hoặc .csv");
  if (rows.length > 501 || rows.some((r) => r.length > 20))
    throw new Error("Tối đa 500 dòng và 20 cột");
  const head = (rows.shift() || []).map((v) => String(v).trim());
  const required = kind === "students" ? headers : headers.slice(0, 6);
  if (required.some((h) => !head.includes(h)))
    throw new Error(
      `Thiếu cột: ${required.filter((h) => !head.includes(h)).join(", ")}`,
    );
  if (new Set(head).size !== head.length) throw new Error("Tên cột bị trùng");
  const errors = [];
  const data = rows.map((r, index) => {
    const out = {};
    for (const h of headers) {
      const value = r[head.indexOf(h)] ?? "";
      if (typeof value === "object") {
        errors.push({
          row: index + 2,
          column: h,
          message: "Ô chứa công thức; hãy chuyển sang văn bản",
        });
        out[h] = "";
      } else out[h] = String(value).trim();
    }
    if (kind !== "students" && !out.difficulty) out.difficulty = "medium";
    return out;
  });
  parentPort.postMessage({ rows: data, errors });
} catch (e) {
  parentPort.postMessage({ error: e.message });
}
