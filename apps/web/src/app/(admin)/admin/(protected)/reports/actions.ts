"use server";

import { askAboutReport, ForbiddenError, reportPeriod } from "@ecom/core";
import { forbidden } from "next/navigation";
import { aiGateway } from "@/server/ai";
import { requirePermission, tenantDb } from "@/server/access";

// Questions about the reports (Milestone 7.4). The action checks reports.read;
// the service also requires ai.use. The answer uses only the report's figures
// and is shown to the staff member who asked; nothing is sent to anyone.

export interface AskState {
  question?: string;
  error?: string;
  result?: { answered: boolean; answer: string; citations: { id: string; text: string }[] };
}

export async function askReportsAction(_previous: AskState, formData: FormData): Promise<AskState> {
  const { context } = await requirePermission("reports.read");
  const raw = formData.get("question");
  const question = (typeof raw === "string" ? raw : "").slice(0, 500);
  const days = reportPeriod(formData.get("days"));
  try {
    const { result, facts } = await askAboutReport(
      tenantDb(context),
      context,
      aiGateway(context.userId),
      {
        question,
        days,
      },
    );
    if (!result.ok) return { question, error: result.message };
    const text = new Map(facts.map((f) => [f.id, f.text]));
    return {
      question,
      result: {
        answered: result.output.answered,
        answer: result.output.answer,
        citations: result.output.citations.map((id) => ({ id, text: text.get(id) ?? "" })),
      },
    };
  } catch (error) {
    if (error instanceof ForbiddenError) forbidden();
    throw error;
  }
}
