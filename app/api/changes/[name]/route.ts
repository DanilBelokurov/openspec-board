import { NextRequest, NextResponse } from "next/server";
import { readConfig } from "@/lib/config";
import { readChange } from "@/lib/openspec";

export async function GET(
  _req: NextRequest,
  { params }: { params: { name: string } },
) {
  const config = await readConfig();
  if (!config.openspecDir) {
    return NextResponse.json(
      { error: "openspecDir not configured" },
      { status: 400 },
    );
  }
  try {
    const change = await readChange(config.openspecDir, params.name);
    return NextResponse.json(change);
  } catch (e) {
    return NextResponse.json(
      { error: `Failed to read ${params.name}: ${String(e)}` },
      { status: 500 },
    );
  }
}