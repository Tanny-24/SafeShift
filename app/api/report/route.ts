// Turns a finished SafetyReport into a downloadable file: a self-contained HTML
// report (prints to PDF), or a complete plain-text / Markdown log of every run.

import { NextRequest } from "next/server";
import { renderReportHTML, renderReportText } from "@/lib/report";
import type { SafetyReport } from "@/lib/suite";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const { report, format } = (await req.json()) as {
    report: SafetyReport;
    format?: "html" | "text";
  };
  const safe = (report.name || "agent").replace(/[^a-z0-9-_]+/gi, "-");

  if (format === "text") {
    return new Response(renderReportText(report), {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Content-Disposition": `attachment; filename="safeshift-${safe}.txt"`,
      },
    });
  }

  return new Response(renderReportHTML(report), {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Disposition": `attachment; filename="safeshift-${safe}.html"`,
    },
  });
}
