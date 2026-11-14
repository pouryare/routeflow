/* FB19 (UIB-D): the steps a new company walks through, each with a rough time, and the % done. A step ticks itself from real data. */
export interface SetupStep { id: string; label: string; minutes: number; href: string; done: boolean }
export const SETUP_STEPS: readonly Omit<SetupStep, "done">[] = [
  { id: "products", label: "کالاها و قیمت‌ها را وارد کنید", minutes: 10, href: "/sales/products" },
  { id: "customers", label: "مشتری‌ها را وارد کنید", minutes: 10, href: "/crm" },
  { id: "team", label: "کاربران را اضافه کنید", minutes: 5, href: "/sales/admin/users" },
  { id: "vehicle", label: "یک خودرو ثبت کنید", minutes: 2, href: "/sales/routing" },
  { id: "order", label: "اولین سفارش را بزنید", minutes: 3, href: "/sales/orders/new" },
];

/** The checklist with each step's state, the percent done (rounded), and the minutes still to go. */
export function setupProgress(done: Record<string, boolean>): { steps: SetupStep[]; percent: number; minutesLeft: number } {
  const steps = SETUP_STEPS.map((s) => ({ ...s, done: done[s.id] === true }));
  const finished = steps.filter((s) => s.done).length;
  return { steps, percent: Math.round((finished / steps.length) * 100), minutesLeft: steps.filter((s) => !s.done).reduce((n, s) => n + s.minutes, 0) };
}
