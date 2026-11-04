import type { ReactNode } from "react";

export interface Field {
  label: string;
  value: ReactNode;
}

// A catalogue-style metadata list. Empty fields are dropped.
export function FieldList({ fields }: { fields: Field[] }) {
  const present = fields.filter(
    (field) =>
      field.value !== null && field.value !== undefined && field.value !== "",
  );

  return (
    <dl className="border-b border-line">
      {present.map((field) => (
        <div
          key={field.label}
          className="flex flex-col gap-1 border-t border-line py-3.5 sm:grid sm:grid-cols-[6.5rem_1fr] sm:gap-5 md:grid-cols-[9rem_1fr]"
        >
          <dt className="pt-1 font-mono text-[10px] uppercase tracking-[0.12em] text-muted">
            {field.label}
          </dt>
          <dd className="font-display text-[15px] leading-relaxed text-ink">
            {field.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
