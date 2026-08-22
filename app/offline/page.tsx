import Link from "next/link";

export default function OfflinePage() {
  return (
    <div dir="rtl" className="flex min-h-screen flex-col items-center justify-center gap-3 bg-bg p-6 text-center">
      <div className="font-mono text-[length:var(--text-xs)] uppercase tracking-[0.12em] text-accent">Offline</div>
      <h1 className="text-[length:var(--text-xl)] font-bold text-text">این صفحه در حالت آفلاین در دسترس نیست</h1>
      <p className="max-w-sm text-[length:var(--text-sm)] text-text-muted">
        نقشه و اطلاعات ذخیره‌شده قبلی ممکن است همچنان قابل مشاهده باشند. وقتی اتصال اینترنت برقرار شد دوباره تلاش کنید.
      </p>
      <Link
        href="/"
        className="mt-2 rounded-[var(--radius-md)] border border-accent bg-accent px-4 py-2 text-[length:var(--text-sm)] font-medium text-[#04191c] transition-[filter,transform] duration-[var(--dur-base)] ease-[var(--ease-out)] hover:scale-[1.03] hover:brightness-110 active:scale-[0.98]"
      >
        بازگشت به نقشه
      </Link>
    </div>
  );
}
