"use client";

import { useCallback, useEffect, useState } from "react";

interface MePayload {
  ok: boolean;
  role?: string;
  isManager?: boolean;
  userId?: number;
  username?: string;
  organizationId?: number | null;
}

interface SessionState {
  role: string | null;
  isManager: boolean;
  loading: boolean;
  error: string | null;
}

export function useSession(): SessionState {
  const [state, setState] = useState<SessionState>({
    role: null,
    isManager: false,
    loading: true,
    error: null,
  });

  const fetchMe = useCallback(async () => {
    try {
      const res = await fetch("/api/me");
      if (!res.ok) {
        setState({ role: null, isManager: false, loading: false, error: "Unauthorized" });
        return;
      }
      const data: MePayload = await res.json();
      if (!data.ok) {
        setState({ role: null, isManager: false, loading: false, error: "No session" });
        return;
      }
      setState({
        role: data.role ?? null,
        isManager: data.isManager ?? false,
        loading: false,
        error: null,
      });
    } catch {
      setState({ role: null, isManager: false, loading: false, error: "Network error" });
    }
  }, []);

  useEffect(() => {
    void fetchMe();
  }, [fetchMe]);

  return state;
}
