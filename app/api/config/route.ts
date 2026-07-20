import { NextRequest, NextResponse } from "next/server";
import { readConfig, writeConfig } from "@/lib/config";

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

  const { openspecDir } = body as Record<string, unknown>;
  if (typeof openspecDir !== "string") {
    return NextResponse.json(
      { error: "openspecDir must be a string" },
      { status: 400 },
    );
  }

  const next = await writeConfig({ openspecDir });
  return NextResponse.json(next);
}