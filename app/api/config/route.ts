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

  const { openspecDir, mode, defaultBranch, developerScanIntervalMinutes } =
    body as Record<string, unknown>;

  const patch: {
    openspecDir?: string;
    mode?: "developer" | "analyst";
    defaultBranch?: string;
    developerScanIntervalMinutes?: number;
  } = {};

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

  if (defaultBranch !== undefined) {
    if (typeof defaultBranch !== "string") {
      return NextResponse.json(
        { error: "defaultBranch must be a string" },
        { status: 400 },
      );
    }
    // Empty/whitespace strings fall back to the existing value inside
    // writeConfig — we accept any non-empty trimmed string here and
    // let the writer decide what to do. We still reject values that
    // contain characters git can never accept in a ref name to give
    // the user an immediate error rather than a confusing git error.
    const trimmed = defaultBranch.trim();
    if (trimmed.length > 0) {
      patch.defaultBranch = trimmed;
    }
  }

  if (developerScanIntervalMinutes !== undefined) {
    if (
      typeof developerScanIntervalMinutes !== "number" ||
      !Number.isFinite(developerScanIntervalMinutes) ||
      developerScanIntervalMinutes < 0 ||
      developerScanIntervalMinutes > 1440
    ) {
      return NextResponse.json(
        {
          error:
            "developerScanIntervalMinutes must be a number between 0 and 1440",
        },
        { status: 400 },
      );
    }
    patch.developerScanIntervalMinutes = developerScanIntervalMinutes;
  }

  const next = await writeConfig(patch);
  return NextResponse.json(next);
}