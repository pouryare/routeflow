"use client";

import { useEffect } from "react";
import { setRecentsUser } from "@/lib/recentsUser";

/** Tells the pickers on this page whose "usual" to show (see lib/recentsUser.ts). Renders nothing. */
export default function RecentsUser({ id }: { id: number }) {
  useEffect(() => {
    setRecentsUser(id);
  }, [id]);
  return null;
}
