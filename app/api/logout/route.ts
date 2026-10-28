import { NextResponse } from "next/server";
import { COOKIE_NAME } from "@/lib/auth";
import { TRUST_COOKIE } from "@/lib/stepUp";

export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE_NAME, "", { path: "/", maxAge: 0 });
  // Signing out ends the ten-minute trust of step-up codes on this device.
  res.cookies.set(TRUST_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}
