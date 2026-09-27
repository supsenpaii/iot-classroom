import { z } from "zod";
z.config(z.locales.vi());
export const choice = z.enum(["A", "B", "C", "D"]);
export const questionSchema = z.object({
  question: z.string().trim().min(1).max(2000),
  option_a: z.string().trim().min(1).max(500),
  option_b: z.string().trim().min(1).max(500),
  option_c: z.string().trim().min(1).max(500),
  option_d: z.string().trim().min(1).max(500),
  correct_answer: z.string().trim().toUpperCase().pipe(choice),
  explanation: z.string().trim().max(4000).default(""),
  topic: z.string().trim().max(100).default(""),
  difficulty: z.enum(["easy", "medium", "hard"]).default("medium"),
});
export type Question = z.infer<typeof questionSchema>;
export const configSchema = z.object({
  count: z.number().int().min(1).max(100),
  seconds: z.number().int().min(5).max(300),
  random: z.boolean().default(true),
  auto_next: z.boolean().default(false),
  allow_change: z.boolean().default(true),
  pass_mark: z.number().min(0).max(10).default(5),
});
export type Config = z.infer<typeof configSchema>;
export const answerSchema = z
  .object({
    v: z.literal(1),
    type: z.literal("answer.submit"),
    request_id: z.string().min(1).max(100),
    session_id: z.string().max(80),
    question_instance_id: z.string().max(80),
    binding_id: z.string().max(80),
    seq: z.number().int().positive().max(2147483647),
    choice,
  })
  .strict();
export type AnswerPacket = z.infer<typeof answerSchema>;
export type PublicQuestion = {
  id: string;
  question: string;
  option_a: string;
  option_b: string;
  option_c: string;
  option_d: string;
  status: string;
  question_order: number;
  deadline_at: number | null;
  remaining_ms: number | null;
};
export type Snapshot = {
  id: string;
  name: string;
  class_name: string;
  room_code: string;
  state: string;
  state_version: number;
  server_time: number;
  config: Config;
  question: PublicQuestion | null;
  answered: number;
  participants: number;
  binding_id?: string;
  current_answer?: { choice: string; seq: number } | null;
};
