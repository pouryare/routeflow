import CardTable from "@/components/CardTable";
import { Icon } from "@/components/meridian/Icon";
import { roleLabel } from "@/lib/roles";
import type { AcademyModule, TrainingPerson } from "@/lib/repo/academy";

/** F133: the manager's table of people against required lessons. A row per person, a column
 *  per required lesson; a lesson their roles do not require is a dash. No reminders yet. */
export default function TrainingTable({ lessons, people }: { lessons: AcademyModule[]; people: TrainingPerson[] }) {
  if (lessons.length === 0) return <p className="acad__muted">هنوز درسی اجباری نشده است.</p>;
  if (people.length === 0) return <p className="acad__muted">کسی در این گروه درس اجباری ندارد.</p>;
  return (
    <div style={{ overflowX: "auto" }}>
      <CardTable className="w-full border-collapse text-[length:var(--text-sm)]">
        <thead>
          <tr className="border-b border-border text-right text-text-muted">
            <th className="py-1 font-normal">نام</th>
            {lessons.map((m) => (
              <th key={m.slug} className="py-1 font-normal">{m.title_fa}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {people.map((p) => (
            <tr key={p.id} className="border-b border-border">
              <td className="py-1">
                {p.name}
                <span className="block text-[length:var(--text-xs)] text-text-muted">{roleLabel(p.role)}</span>
              </td>
              {lessons.map((m) => {
                const v = p.lessons[m.slug];
                return (
                  <td key={m.slug} className={`py-1 ${v === "todo" ? "text-warn" : "text-text-muted"}`}>
                    {v === "done" ? (
                      <><Icon name="check" size="sm" /> انجام شد</>
                    ) : v === "todo" ? (
                      <><Icon name="warn" size="sm" /> مانده</>
                    ) : (
                      "—"
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </CardTable>
    </div>
  );
}
