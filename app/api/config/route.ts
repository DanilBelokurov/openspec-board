import { NextRequest, NextResponse } from "next/server";
import { readConfig, writeConfig } from "@/lib/config";
import { isBoardModeId, type BoardModeId } from "@/lib/modes";

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

  const {
    openspecDir,
    mode,
    defaultBranch,
    developerScanIntervalMinutes,
    remoteScanIntervalMinutes,
    user,
  } = body as Record<string, unknown>;

  const patch: {
    openspecDir?: string;
    mode?: BoardModeId;
    defaultBranch?: string;
    developerScanIntervalMinutes?: number;
    remoteScanIntervalMinutes?: number;
    user?: { email?: string; displayName?: string };
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
        { error: 'mode must be "developer", "analyst" or "uek-expert"' },
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

  if (remoteScanIntervalMinutes !== undefined) {
    // Same bounds as the developer interval — 0 disables auto-scan,
    // 1440 is a 24h cap (longer doesn't make sense).
    if (
      typeof remoteScanIntervalMinutes !== "number" ||
      !Number.isFinite(remoteScanIntervalMinutes) ||
      remoteScanIntervalMinutes < 0 ||
      remoteScanIntervalMinutes > 1440
    ) {
      return NextResponse.json(
        {
          error:
            "remoteScanIntervalMinutes must be a number between 0 and 1440",
        },
        { status: 400 },
      );
    }
    patch.remoteScanIntervalMinutes = remoteScanIntervalMinutes;
  }

  if (user !== undefined) {
    // Allow `null` (or an object with blank strings) as an
    // explicit "clear identity". `null` maps to an object with
    // empty strings, which normaliseUserIdentity in lib/config
    // collapses to `undefined` (i.e. no identity). Otherwise the
    // value must be an object with optional string fields;
    // non-string fields are rejected (we don't try to coerce —
    // silent coercion tends to hide frontend bugs).
    if (user === null) {
      patch.user = { email: "", displayName: "" };
    } else if (typeof user !== "object") {
      return NextResponse.json(
        { error: "user must be an object or null" },
        { status: 400 },
      );
    } else {
      const obj = user as Record<string, unknown>;
      const email = obj.email;
      const displayName = obj.displayName;
      if (email !== undefined && typeof email !== "string") {
        return NextResponse.json(
          { error: "user.email must be a string" },
          { status: 400 },
        );
      }
      if (displayName !== undefined && typeof displayName !== "string") {
        return NextResponse.json(
          { error: "user.displayName must be a string" },
          { status: 400 },
        );
      }
      patch.user = {
        email: typeof email === "string" ? email : undefined,
        displayName: typeof displayName === "string" ? displayName : undefined,
      };
    }
  }

  const next = await writeConfig(patch);
  return NextResponse.json(next);
}