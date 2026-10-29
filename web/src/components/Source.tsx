/**
 * §4.11 · Source cues that never depend on colour: the source tag (shape and
 * word), the row overflow menu and the segmented source filter.
 */
import { useEffect, useId, useRef, useState, type ReactNode } from "react";

import type { Study } from "@/types/study";
import { Icon, type IconName } from "~/components/Icon";

/** `UPLOADED` (solid, upload icon) or `SAMPLE` (dashed outline). */
export function SourceTag({ study }: { study: Pick<Study, "source"> }) {
  return study.source === "sample" ? (
    <span className="src src-sample">Sample</span>
  ) : (
    <span className="src src-up">
      <Icon name="upload" size={10} strokeWidth={2} />
      Uploaded
    </span>
  );
}

export interface MenuItem {
  label: string;
  icon?: IconName;
  onSelect: () => void;
  disabled?: boolean;
  hint?: string;
}

/** A 36 px three-dot button with a small menu; Esc or a click outside closes it. */
export function RowMenu({ label, items }: { label: string; items: MenuItem[] }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);
  return (
    <div className="rmenu" ref={box}>
      <button type="button" className="ib rmenu__btn" aria-label={label} aria-haspopup="menu" aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)}>
        <Icon name="more" />
      </button>
      {open ? (
        <div className="rmenu__list" role="menu" id={id}>
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              className="rmenu__item"
              disabled={item.disabled}
              title={item.disabled ? item.hint : undefined}
              onClick={() => {
                setOpen(false);
                item.onSelect();
              }}
            >
              {item.icon ? <Icon name={item.icon} /> : null}
              <span>
                {item.label}
                {item.disabled && item.hint ? <span className="muted rmenu__hint">{item.hint}</span> : null}
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** Segmented control: one current option, black with white text. */
export function Segmented<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { value: T; label: ReactNode }[]; onChange: (v: T) => void }) {
  return (
    <nav className="seg" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" className={o.value === value ? "cur" : ""} aria-pressed={o.value === value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </nav>
  );
}
