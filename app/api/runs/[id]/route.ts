import { getRun } from "@/lib/store";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const run = await getRun(params.id);
    if (!run) return Response.json({ error: "Run not found" }, { status: 404 });
    return Response.json({ run });
  } catch (error) {
    return Response.json(
      { error: (error as Error).message },
      { status: 400 }
    );
  }
}
