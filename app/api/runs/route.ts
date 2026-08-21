import { NextRequest } from "next/server";
import { listRuns } from "@/lib/store";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const requested = Number(req.nextUrl.searchParams.get("limit") ?? "25");
  const limit = Number.isFinite(requested) ? requested : 25;

  try {
    const runs = await listRuns(limit);
    return Response.json({ runs });
  } catch (error) {
    return Response.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}
