import { z } from "zod";

export const STUDENT_CODE_ERROR =
  "MSSV cần từ 1 đến 10 chữ số (0–9), không có khoảng trắng bên trong.";

// Never coerce a number or remove characters: leading zeros identify the student.
export const studentCodeSchema = z.string().trim().regex(/^[0-9]{1,10}$/, STUDENT_CODE_ERROR);
