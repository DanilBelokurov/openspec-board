import { NextRequest, NextResponse } from "next/server";
import { readConfig, writeConfig } from "@/lib/config";
import { isBoardModeId } from "@/lib/modes";

export async function GET() {
  const config = await readConfig();
  return NextResponse.json(config);
}

export async function PUT(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Body must be valid JSON" },
      { status: 400 },
    );
  }

  if (typeof body !== "object" || body === null) {
    return NextResponse.json(
      { error: "Body must be a JSON object" },
      { status: 400 },
    );
  }

  const { openspecDir, mode } = body as Record<string, unknown>;

  const patch: { openspecDir?: string; mode?: "developer" | "analyst" } = {};

  if (openspecDir !== undefined) {
    if (typeof openspecDir !== "string") {
      return NextResponse.json(
        { error: "openspecDir must be a string" },
        { status: 400 },
      );
    }
    patch.openspecDir = openspecDir;
  }

  if (mode !== undefined) {
    if (!isBoardModeId(mode)) {
      return NextResponse.json(
        { error: 'mode must be "developer" or "analyst"' },
        { status: 400 },
      );
    }
    patch.mode = mode;
  }

  const next = await writeConfig(patch);
  return NextResponse.json(next);
}