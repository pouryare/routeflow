import { NextResponse } from "next/server";
import { undoLastImport } from "@/lib/importExcel";

export async function POST() {
  const result = await undoLastImport();
  if (!result.ok) {
    return NextResponse.json(result, { status: 422 });
  }
  return NextResponse.json(result);
}
