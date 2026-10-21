"use client";

import { useMemo, useState } from "react";
import TapFlow from "@/components/tapflow/TapFlow";
import FlowDone from "@/components/tapflow/FlowDone";
import { useFlowHost } from "@/components/tapflow/useFlowHost";
import { Icon } from "@/components/meridian/Icon";
import { useToast } from "@/components/ToastProvider";
import { EMPTY_CONTEXT, type FlowContext } from "@/lib/crm/flows/types";
import { generatePassword, generateUsername } from "@/lib/credentials";
import { ROLES } from "@/lib/roles";
import { credentialsMessage, userAddChips, userAddFlow, userAddRequest } from "@/lib/flows/userAdd";

const FAILURE = "حساب ساخته نشد. اینترنت را بررسی کنید و دوباره تلاش کنید.";
const flow = userAddFlow(ROLES);

/** A new account as a tap flow (owner only). The username and a one-time password are made when
 *  the flow opens and shown once on the done screen, with «ارسال» (the phone's share sheet) or a
 *  copy button. Sharing sends the held write first, so the details work the moment they arrive.
 *  Mount with a fresh `key` per opening. */
export default function UserAddFlow({
  open,
  groups,
  onClose,
  onReopen,
  onCreated,
}: {
  open: boolean;
  groups: { id: number; name: string }[];
  onClose: () => void;
  onReopen?: () => void;
  onCreated: () => void;
}) {
  const toast = useToast();
  const [creds] = useState(() => ({ username: generateUsername(), password: generatePassword() }));
  const ctx = useMemo<FlowContext>(
    () => ({
      ...EMPTY_CONTEXT,
      entry: "user_add",
      lists: { group: groups.map((g) => ({ id: g.id, label: g.name })) },
      vars: { username: creds.username, password: creds.password },
    }),
    [groups, creds],
  );

  const { state, setState, onSaved, flush } = useFlowHost(flow, ctx, {
    send: async (st) => {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(userAddRequest(ctx, st)),
      });
      if (res.ok) return { ok: true };
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      return { ok: false, error: json.error };
    },
    summary: (st) => `حساب ثبت شد · ${userAddChips(ctx, st).join(" · ")}`,
    failure: FAILURE,
    onFinished: onCreated,
    onReopen,
  });

  const name = (state.values.display_name ?? "").trim();
  const message = credentialsMessage(name, creds.username, creds.password);

  async function share() {
    await flush();
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ text: message });
        return;
      } catch {
        /* cancelled: fall through to copy */
      }
    }
    try {
      await navigator.clipboard.writeText(message);
      toast("مشخصات ورود کپی شد", "success");
    } catch {
      toast("کپی نشد؛ مشخصات را از صفحه بخوانید", "error");
    }
  }

  return (
    <TapFlow
      open={open}
      title="حساب تازه"
      config={flow}
      ctx={ctx}
      state={state}
      onState={setState}
      onSaved={onSaved}
      onClose={onClose}
      done={
        <FlowDone
          key={state.answers.length}
          chips={userAddChips(ctx, state)}
          seconds={60}
          onReturn={onClose}
          actions={
            <>
              <p className="tf-sub" dir="ltr">
                {creds.username} · {creds.password}
              </p>
              <button type="button" className="inline-flex items-center justify-center gap-[var(--space-2)] tf-go" onClick={() => void share()}>
                <Icon name="external-link" size="md" />
                ارسال مشخصات ورود
              </button>
              <p className="tf-note">این رمز فقط یک بار نشان داده می‌شود؛ کاربر می‌تواند بعداً آن را عوض کند.</p>
            </>
          }
        />
      }
    />
  );
}
