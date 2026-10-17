import { forwardRef, useId, type ButtonHTMLAttributes, type ReactNode } from 'react';

type Variant = 'primary' | 'secondary' | 'quiet' | 'danger';

const variants: Record<Variant, string> = {
  primary: 'bg-vardar text-vardar-ink border-vardar hover:brightness-110',
  secondary: 'bg-surface text-ink border-line hover:bg-surface-2',
  quiet: 'bg-transparent text-ink border-transparent hover:bg-surface-2',
  danger: 'bg-surface text-issue border-issue hover:bg-surface-2',
};

export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; icon?: ReactNode }>(
  function Button({ variant = 'secondary', icon, className = '', children, type = 'button', ...rest }, ref) {
    return (
      <button
        ref={ref}
        type={type}
        className={`inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-lg border-2 px-4 py-2 font-medium disabled:cursor-not-allowed disabled:opacity-60 ${variants[variant]} ${className}`}
        {...rest}
      >
        {icon}
        {children}
      </button>
    );
  },
);

export function Checkbox({ label, hint, checked, onChange, id }: {
  label: ReactNode; hint?: ReactNode; checked: boolean; onChange: (v: boolean) => void; id?: string;
}) {
  const auto = useId();
  const cid = id ?? auto;
  return (
    <div className="flex items-start gap-3 py-1.5">
      <input
        id={cid}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        aria-describedby={hint ? `${cid}-hint` : undefined}
        className="mt-0.5 size-6 shrink-0 accent-[var(--c-vardar)]"
      />
      <div>
        <label htmlFor={cid} className="cursor-pointer">{label}</label>
        {hint && <p id={`${cid}-hint`} className="text-sm text-ink-soft">{hint}</p>}
      </div>
    </div>
  );
}

export function RadioGroup<T extends string>({ legend, name, value, options, onChange, hint, className = '' }: {
  legend: ReactNode; name: string; value: T | undefined; hint?: ReactNode; className?: string;
  options: { value: T; label: ReactNode; description?: ReactNode }[]; onChange: (v: T) => void;
}) {
  const hid = useId();
  return (
    <fieldset className={className} aria-describedby={hint ? hid : undefined}>
      <legend className="mb-1 font-display text-lg font-semibold">{legend}</legend>
      {hint && <p id={hid} className="mb-2 text-sm text-ink-soft">{hint}</p>}
      <div className="flex flex-col gap-1">
        {options.map((o) => {
          const id = `${name}-${o.value}`;
          return (
            <div key={o.value} className="flex items-start gap-3 py-1.5">
              <input
                type="radio" id={id} name={name} value={o.value} checked={value === o.value}
                onChange={() => onChange(o.value)}
                aria-describedby={o.description ? `${id}-d` : undefined}
                className="mt-0.5 size-6 shrink-0 accent-[var(--c-vardar)]"
              />
              <div>
                <label htmlFor={id} className="cursor-pointer font-medium">{o.label}</label>
                {o.description && <p id={`${id}-d`} className="text-sm text-ink-soft">{o.description}</p>}
              </div>
            </div>
          );
        })}
      </div>
    </fieldset>
  );
}

export function Select({ label, value, onChange, options, hint }: {
  label: ReactNode; value: string; onChange: (v: string) => void; hint?: ReactNode;
  options: { value: string; label: string }[];
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1 py-1.5">
      <label htmlFor={id} className="font-medium">{label}</label>
      {hint && <p id={`${id}-h`} className="text-sm text-ink-soft">{hint}</p>}
      <select
        id={id} value={value} onChange={(e) => onChange(e.target.value)}
        aria-describedby={hint ? `${id}-h` : undefined}
        className="min-h-11 rounded-lg border-2 border-line bg-surface px-3 text-ink"
      >
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}

/** Status shape + colour so meaning never relies on colour alone. */
export function StatusMark({ status }: { status: 'OK' | 'PROBLEM' | 'UNKNOWN' }) {
  const shape = status === 'OK' ? '✓' : status === 'PROBLEM' ? '!' : '?';
  const color = status === 'OK' ? 'bg-ok' : status === 'PROBLEM' ? 'bg-issue' : 'bg-unknown';
  return (
    <span aria-hidden="true" className={`inline-grid size-6 shrink-0 place-items-center rounded-full text-sm font-bold text-[var(--c-surface)] ${color}`}>
      {shape}
    </span>
  );
}

export function ErrorBox({ children, onRetry, retryLabel }: { children: ReactNode; onRetry?: () => void; retryLabel?: string }) {
  return (
    <div role="alert" className="rounded-lg border-2 border-issue bg-surface p-4">
      <p className="font-medium">{children}</p>
      {onRetry && <Button className="mt-3" onClick={onRetry}>{retryLabel}</Button>}
    </div>
  );
}
