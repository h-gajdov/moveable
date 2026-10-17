import { Check, CircleAlert } from 'lucide-react';
import { forwardRef, useId, type ButtonHTMLAttributes, type ReactNode } from 'react';

type Variant = 'primary' | 'secondary' | 'tinted' | 'quiet' | 'danger';
type Size = 'md' | 'lg';

/* Capsule geometry for every action (Apple's 980px pill). */
const variants: Record<Variant, string> = {
  primary: 'bg-accent text-accent-ink hover:bg-accent-hover',
  secondary: 'bg-fill text-ink hover:bg-fill-strong',
  tinted: 'bg-tint text-link hover:bg-fill',
  quiet: 'bg-transparent text-link hover:bg-fill',
  danger: 'bg-fill text-issue hover:bg-fill-strong',
};

const sizes: Record<Size, string> = {
  md: 'min-h-11 px-4 py-2 text-[0.9375rem]',
  lg: 'min-h-13 px-6 py-3 text-[1.0625rem]',
};

export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant; size?: Size; icon?: ReactNode;
}>(
  function Button({ variant = 'secondary', size = 'md', icon, className = '', children, type = 'button', ...rest }, ref) {
    return (
      <button
        ref={ref}
        type={type}
        className={`inline-flex min-w-11 items-center justify-center gap-2 rounded-pill font-medium leading-tight transition-colors duration-150 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100 ${variants[variant]} ${sizes[size]} ${className}`}
        {...rest}
      >
        {icon}
        {children}
      </button>
    );
  },
);

/** Inset grouped container; children become hairline-separated rows. */
export function Group({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`card rows px-4 ${className}`}>{children}</div>;
}

/** Small heading above a grouped container, plus optional footnote below. */
export function GroupHeading({ id, children, as: Tag = 'h2' }: { id?: string; children: ReactNode; as?: 'h2' | 'h3' | 'h4' }) {
  return <Tag id={id} className="mb-2 px-1 text-[1.25rem]">{children}</Tag>;
}

export function Footnote({ id, children, className = '' }: { id?: string; children: ReactNode; className?: string }) {
  return <p id={id} className={`px-1 text-[0.875rem] text-muted ${className}`}>{children}</p>;
}

/**
 * On/off setting shown as a switch (HIG). It stays a native checkbox, so it is
 * announced and operated like one.
 */
export function Checkbox({ label, hint, checked, onChange, id }: {
  label: ReactNode; hint?: ReactNode; checked: boolean; onChange: (v: boolean) => void; id?: string;
}) {
  const auto = useId();
  const cid = id ?? auto;
  return (
    <div className="flex min-h-11 items-center justify-between gap-4 py-2.5">
      <div className="min-w-0">
        <label htmlFor={cid} className="cursor-pointer">{label}</label>
        {hint && <p id={`${cid}-hint`} className="text-[0.875rem] text-muted">{hint}</p>}
      </div>
      <input
        id={cid}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        aria-describedby={hint ? `${cid}-hint` : undefined}
        className="switch"
      />
    </div>
  );
}

export interface RadioOption<T extends string> {
  value: T;
  label: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
}

/**
 * Single choice. `list` is an inset grouped list with a checkmark on the
 * chosen row; `segmented` is a segmented control for a few short options.
 * Both are native radios inside a fieldset.
 */
export function RadioGroup<T extends string>({ legend, name, value, options, onChange, hint, className = '', variant = 'list' }: {
  legend: ReactNode; name: string; value: T | undefined; hint?: ReactNode; className?: string;
  options: RadioOption<T>[]; onChange: (v: T) => void; variant?: 'list' | 'segmented';
}) {
  const hid = useId();
  return (
    <fieldset className={className} aria-describedby={hint ? hid : undefined}>
      <legend className="mb-1 px-1 font-display text-[1.0625rem] font-semibold">{legend}</legend>
      {hint && <p id={hid} className="mb-2 px-1 text-[0.875rem] text-muted">{hint}</p>}
      {variant === 'segmented' ? (
        <div className="mt-1 grid grid-cols-[repeat(auto-fit,minmax(min(4.5rem,100%),1fr))] gap-1 rounded-[12px] bg-fill p-1">
          {options.map((o) => {
            const id = `${name}-${o.value}`;
            const on = value === o.value;
            return (
              <label
                key={o.value}
                htmlFor={id}
                className={`relative flex min-h-11 cursor-pointer items-center justify-center gap-1 rounded-[9px] px-2 py-1.5 text-center text-[0.9375rem] transition-colors has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-offset-1 has-[:focus-visible]:outline-[var(--c-focus)] ${
                  on ? 'bg-card font-semibold shadow-[0_1px_4px_rgb(0_0_0/0.12)] ring-[length:var(--hair)] ring-hairline' : 'text-ink-2 hover:bg-fill-strong'}`}
              >
                <input type="radio" id={id} name={name} value={o.value} checked={on}
                  onChange={() => onChange(o.value)} className="sr-only" />
                {on && <Check aria-hidden="true" className="size-3.5 shrink-0" strokeWidth={3} />}
                {o.label}
              </label>
            );
          })}
        </div>
      ) : (
        <div className="card rows mt-1 px-4">
          {options.map((o) => {
            const id = `${name}-${o.value}`;
            return (
              <div key={o.value} className="relative flex min-h-11 items-center gap-3 py-3">
                {o.icon && (
                  <span aria-hidden="true" className={`grid size-9 shrink-0 place-items-center rounded-[10px] ${
                    value === o.value ? 'bg-accent text-accent-ink' : 'bg-fill text-ink'}`}>
                    {o.icon}
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  {/* The label covers the row, so the whole row is the target. */}
                  <label htmlFor={id} className="cursor-pointer font-medium after:absolute after:inset-0">{o.label}</label>
                  {o.description && <p id={`${id}-d`} className="text-[0.875rem] text-muted">{o.description}</p>}
                </div>
                <input
                  type="radio" id={id} name={name} value={o.value} checked={value === o.value}
                  onChange={() => onChange(o.value)}
                  aria-describedby={o.description ? `${id}-d` : undefined}
                  className="check-radio relative"
                />
              </div>
            );
          })}
        </div>
      )}
    </fieldset>
  );
}

/** A labelled pop-up menu (native select) laid out as a grouped-list row. */
export function Select({ label, value, onChange, options, hint }: {
  label: ReactNode; value: string; onChange: (v: string) => void; hint?: ReactNode;
  options: { value: string; label: string }[];
}) {
  const id = useId();
  return (
    <div className="flex min-h-11 flex-wrap items-center justify-between gap-x-4 gap-y-1.5 py-2.5">
      <div className="min-w-0">
        <label htmlFor={id}>{label}</label>
        {hint && <p id={`${id}-h`} className="text-[0.875rem] text-muted">{hint}</p>}
      </div>
      <select
        id={id} value={value} onChange={(e) => onChange(e.target.value)}
        aria-describedby={hint ? `${id}-h` : undefined}
        className="select min-h-11 max-w-full rounded-[10px] px-3 text-[0.9375rem] text-ink"
      >
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}

/** Status shape + colour so meaning never relies on colour alone. */
export function StatusMark({ status, size = 'md' }: { status: 'OK' | 'PROBLEM' | 'UNKNOWN'; size?: 'md' | 'lg' }) {
  const shape = status === 'OK' ? '✓' : status === 'PROBLEM' ? '!' : '?';
  const color = status === 'OK' ? 'bg-ok' : status === 'PROBLEM' ? 'bg-issue' : 'bg-unknown';
  const dims = size === 'lg' ? 'size-7 text-[0.9375rem]' : 'size-5.5 text-[0.75rem]';
  return (
    <span aria-hidden="true" className={`inline-grid shrink-0 place-items-center rounded-full font-bold text-card ${dims} ${color}`}>
      {shape}
    </span>
  );
}

export function ErrorBox({ children, onRetry, retryLabel }: { children: ReactNode; onRetry?: () => void; retryLabel?: string }) {
  return (
    <div role="alert" className="card flex gap-3 p-4 ring-[length:var(--hair)] ring-issue">
      <CircleAlert aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-issue" />
      <div>
        <p className="font-medium">{children}</p>
        {onRetry && <Button className="mt-3" variant="tinted" onClick={onRetry}>{retryLabel}</Button>}
      </div>
    </div>
  );
}

/** Quiet informational note on a filled background. */
export function Notice({ children, icon, className = '' }: { children: ReactNode; icon?: ReactNode; className?: string }) {
  return (
    <div className={`flex gap-3 rounded-[14px] bg-fill p-3.5 text-[0.9375rem] text-ink-2 ${className}`}>
      {icon}
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/** Large title (HIG) for the page's single h1. */
export function PageTitle({ children, subtitle }: { children: ReactNode; subtitle?: ReactNode }) {
  return (
    <div className="mb-6">
      <h1 className="large-title">{children}</h1>
      {subtitle && <p className="mt-1.5 text-[0.9375rem] text-muted">{subtitle}</p>}
    </div>
  );
}
