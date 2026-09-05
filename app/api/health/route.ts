import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    status: "ok",
    service: "sdd-sessions-board",
    time: new Date().toISOString(),
  });
}