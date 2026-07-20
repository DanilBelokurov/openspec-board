import { NextResponse } from "next/server";
import { readConfig } from "@/lib/config";
import { scanChanges } from "@/lib/openspec";

export async function GET() {
  const config = await readConfig();
  if (!config.openspecDir) {
    return NextResponse.json([]);
  }
  try {
    const items = await scanChanges(config.openspecDir);
    return NextResponse.json(items);
  } catch (e) {
    return NextResponse.json(
      { error: `Failed to scan ${config.openspecDir}: ${String(e)}` },
      { status: 500 },
    );
  }
}