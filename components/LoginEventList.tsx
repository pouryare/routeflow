import type { LoginEventRow, LoginResult } from "@/lib/repo/loginEvents";
import { deviceLabel } from "@/lib/deviceLabel";
import { faJalaliDateTime } from "@/lib/jalali";

const RESULT: Record<LoginResult, { label: string; tone: string }> = {
  success: { label: "ورود موفق", tone: "var(--good)" },
  bad_password: { label: "رمز نادرست", tone: "var(--warn)" },
  inactive: { label: "حساب غیرفعال", tone: "var(--crit)" },
  bad_code: { label: "کد مرحلهٔ دوم نادرست", tone: "var(--warn)" },
};

/** Sign-in attempts, newest first (F110). `showName` for the owner's list of everyone. */
export default function LoginEventList({ rows, showName = false }: { rows: LoginEventRow[]; showName?: boolean }) {
  if (rows.length === 0) {
    return <p className="m-0 text-[length:var(--text-sm)] text-[var(--text-muted)]">هنوز ورودی ثبت نشده.</p>;
  }
  return (
    <ul className="m-0 flex list-none flex-col gap-[var(--space-2)] p-0 text-[length:var(--text-sm)]">
      {rows.map((r) => (
        <li
          key={r.id}
          className="flex flex-wrap items-baseline justify-between gap-[var(--space-2)] border-b border-[var(--border)] pb-[var(--space-2)]"
        >
          <span className="text-[var(--text)]">
            {showName && <span className="font-medium">{r.display_name} · </span>}
            <span style={{ color: RESULT[r.result].tone }}>{RESULT[r.result].label}</span>
            <span className="text-[var(--text-muted)]"> · {deviceLabel(r.user_agent)}</span>
          </span>
          <span className="tabular-nums text-[var(--text-muted)]">
            {faJalaliDateTime(r.created_at)}
            {r.ip && <span dir="ltr"> · {r.ip}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}
