import { forwardRef, useEffect, useId, useRef } from "react";
import type { ButtonHTMLAttributes, HTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";

const join = (...names: Array<string | false | null | undefined>) => names.filter(Boolean).join(" ");

type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";

export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: "sm" | "md" | "lg"; full?: boolean; busy?: boolean; busyLabel?: ReactNode }>(function Button({ variant = "secondary", size = "md", full = false, busy = false, busyLabel, className, type = "button", children, disabled, ...props }, ref) {
  return <button ref={ref} type={type} disabled={disabled || busy} aria-busy={busy || undefined} className={join("ui-button", `ui-button--${variant}`, `ui-button--${size}`, full && "ui-button--full", className)} {...props}>
    {busy && <span className="ui-button__spinner" aria-hidden="true" />}
    <span className="ui-button__label">{busy ? busyLabel || children : children}</span>
  </button>;
});

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...props }, ref) {
  return <input ref={ref} className={join("ui-input", className)} {...props} />;
});

export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={join("ui-input", "ui-select", className)} {...props} />;
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={join("ui-input", "ui-textarea", className)} {...props} />;
}

export function Card({ tone = "default", className, ...props }: HTMLAttributes<HTMLElement> & { tone?: "default" | "dark" | "accent" | "danger" | "selected" | "warning" | "success" }) {
  return <section className={join("ui-card", `ui-card--${tone}`, className)} {...props} />;
}

export function Badge({ tone = "neutral", children, className }: { tone?: "neutral" | "good" | "warn" | "danger" | "live"; children: ReactNode; className?: string }) {
  return <span className={join("ui-badge", `ui-badge--${tone}`, className)}>{children}</span>;
}

export function Alert({ tone = "info", title, children, className }: { tone?: "info" | "good" | "warn" | "danger"; title?: string; children: ReactNode; className?: string }) {
  return <div className={join("ui-alert", `ui-alert--${tone}`, className)} role={tone === "danger" ? "alert" : undefined} aria-live={tone === "danger" ? "assertive" : "polite"}>{title && <strong>{title}</strong>}<span>{children}</span></div>;
}

export function Toast({ tone = "good", children, onDismiss, dismissLabel = "Close" }: { tone?: "good" | "danger"; children: ReactNode; onDismiss: () => void; dismissLabel?: string }) {
  return <div className={join("ui-toast", `ui-toast--${tone}`)} role={tone === "danger" ? "alert" : "status"}><span aria-hidden="true">{tone === "danger" ? "!" : <Icon name="check" size={15} />}</span><p>{children}</p><button type="button" onClick={onDismiss} aria-label={dismissLabel}><Icon name="close" size={16} /></button></div>;
}

export function Modal({ title, eyebrow, children, actions, onClose, closeLabel = "Close", size = "md", className }: { title: string; eyebrow?: string; children: ReactNode; actions?: ReactNode; onClose?: () => void; closeLabel?: string; size?: "sm" | "md" | "lg"; className?: string }) {
  const titleId = useId();
  const scrimRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const scrim = scrimRef.current;
    const dialog = dialogRef.current;
    if (!scrim || !dialog) return;

    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const inertState = new Map<HTMLElement, boolean>();
    let branch: HTMLElement = scrim;
    while (branch.parentElement) {
      const parent = branch.parentElement;
      for (const sibling of Array.from(parent.children)) {
        if (sibling === branch || !(sibling instanceof HTMLElement)) continue;
        inertState.set(sibling, sibling.inert);
        sibling.inert = true;
      }
      if (parent === document.body) break;
      branch = parent;
    }

    const selector = "button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex='-1'])";
    const focusable = () => Array.from(dialog.querySelectorAll<HTMLElement>(selector)).filter((element) => !element.hidden && element.getClientRects().length > 0);
    const bodyTarget = Array.from(dialog.querySelectorAll<HTMLElement>(`.ui-modal__body ${selector}`)).find((element) => element.getClientRects().length > 0 && (element.offsetWidth > 4 || element.offsetHeight > 4));
    const focusFrame = window.requestAnimationFrame(() => {
      // Do not steal focus from a field the operator has already selected.
      if (!dialog.contains(document.activeElement)) (bodyTarget || focusable()[0] || dialog).focus();
    });

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && onCloseRef.current) {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const controls = focusable();
      if (!controls.length) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown, true);

    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("keydown", handleKeyDown, true);
      inertState.forEach((wasInert, element) => { element.inert = wasInert; });
      window.requestAnimationFrame(() => previouslyFocused?.isConnected && previouslyFocused.focus());
    };
  }, []);

  return <div className="ui-modal-scrim" ref={scrimRef}><section ref={dialogRef} className={join("ui-modal", `ui-modal--${size}`, className)} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}><header className="ui-modal__header"><div>{eyebrow && <span className="ui-eyebrow">{eyebrow}</span>}<h2 id={titleId}>{title}</h2></div>{onClose && <Button size="sm" onClick={onClose}>{closeLabel}</Button>}</header><div className="ui-modal__body">{children}</div>{actions && <footer className="ui-modal__footer">{actions}</footer>}</section></div>;
}

export function Tabs({ items, active, onChange, className, ariaLabel = "View options" }: { items: Array<{ id: string; label: string; count?: number }>; active: string; onChange: (id: string) => void; className?: string; ariaLabel?: string }) {
  return <div className={join("ui-tabs", className)} role="group" aria-label={ariaLabel}>{items.map((item) => <button type="button" key={item.id} className={item.id === active ? "active" : ""} aria-pressed={item.id === active} onClick={() => onChange(item.id)}>{item.label}{item.count !== undefined && <b>{item.count}</b>}</button>)}</div>;
}

export function SegmentedControl({ items, value, onChange, ariaLabel, className }: { items: Array<{ id: string; label: string }>; value: string; onChange: (id: string) => void; ariaLabel: string; className?: string }) {
  return <div className={join("ui-segmented", className)} role="group" aria-label={ariaLabel}>{items.map((item) => <button type="button" key={item.id} className={item.id === value ? "active" : ""} aria-pressed={item.id === value} onClick={() => onChange(item.id)}>{item.label}</button>)}</div>;
}

export function Table({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={join("ui-table", className)}>{children}</div>;
}

export function SelectableRow({ selected = false, className, children, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { selected?: boolean }) {
  return <button type="button" aria-pressed={selected} className={join("ui-row", selected && "ui-row--selected", className)} {...props}>{children}</button>;
}

export function NavItem({ active, icon, label, onClick, className }: { active?: boolean; icon?: string; label: string; onClick: () => void; className?: string }) {
  return <button type="button" className={join("ui-nav__item", !icon && "ui-nav__item--text", active && "active", className)} aria-current={active ? "page" : undefined} onClick={onClick}>{icon && <i aria-hidden="true">{icon}</i>}<span>{label}</span></button>;
}

type IconName = "search" | "plus" | "refresh" | "close" | "check" | "clock" | "arrowRight" | "arrowUpRight" | "download";

export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  const common = { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
  if (name === "search") return <svg {...common}><circle cx="11" cy="11" r="6" /><path d="m16 16 4 4" /></svg>;
  if (name === "plus") return <svg {...common}><path d="M12 5v14M5 12h14" /></svg>;
  if (name === "refresh") return <svg {...common}><path d="M20 11a8 8 0 1 0 2 5" /><path d="M20 4v7h-7" /></svg>;
  if (name === "close") return <svg {...common}><path d="m6 6 12 12M18 6 6 18" /></svg>;
  if (name === "check") return <svg {...common}><path d="m5 12 4 4L19 6" /></svg>;
  if (name === "arrowRight") return <svg {...common}><path d="M5 12h14M13 6l6 6-6 6" /></svg>;
  if (name === "arrowUpRight") return <svg {...common}><path d="M7 17 17 7M8 7h9v9" /></svg>;
  if (name === "download") return <svg {...common}><path d="M12 4v11M7 10l5 5 5-5M5 20h14" /></svg>;
  return <svg {...common}><circle cx="12" cy="12" r="8" /><path d="M12 8v4l3 2" /></svg>;
}
