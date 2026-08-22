"use client";

export default function PrintButton() {
  return (
    <button
      onClick={() => window.print()}
      className="no-print rounded-[var(--radius-md)] border border-accent bg-accent px-3 py-2 text-[length:var(--text-sm)] font-medium text-[#04191c] transition-[filter,transform] duration-[var(--dur-base)] ease-[var(--ease-out)] hover:scale-[1.03] hover:brightness-110 active:scale-[0.98]"
    >
      چاپ / ذخیره PDF
    </button>
  );
}
