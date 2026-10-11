import Link from "next/link";
import type { ButtonHTMLAttributes, ComponentProps } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "soft";
type Size = "sm" | "md" | "lg" | "xl";

const base =
  "inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40 select-none text-center";

const variants: Record<Variant, string> = {
  primary: "bg-primary text-primary-ink hover:bg-primary-hover shadow-sm",
  secondary: "border border-line-strong bg-surface text-ink hover:bg-surface-2",
  soft: "bg-primary-soft text-primary hover:brightness-95",
  ghost: "text-muted hover:bg-surface-2 hover:text-ink",
  danger: "border border-danger/50 bg-surface text-danger hover:bg-danger-soft",
};

const sizes: Record<Size, string> = {
  // min-height (not height): if a label wraps on a narrow screen, the button grows instead of crowding.
  sm: "min-h-9 px-3 py-1 text-sm",
  md: "min-h-11 px-4 py-1.5 text-[15px]",
  lg: "min-h-12 px-5 py-2 text-base sm:px-6",
  xl: "min-h-14 px-5 py-2 text-base sm:px-7 sm:text-lg",
};

export function buttonClass(variant: Variant = "primary", size: Size = "md", className = "") {
  return `${base} ${variants[variant]} ${sizes[size]} ${className}`;
}

export function Button({
  variant = "primary",
  size = "md",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size }) {
  return <button type="button" className={buttonClass(variant, size, className)} {...props} />;
}

export function ButtonLink({
  variant = "primary",
  size = "md",
  className = "",
  ...props
}: ComponentProps<typeof Link> & { variant?: Variant; size?: Size }) {
  return <Link className={buttonClass(variant, size, className)} {...props} />;
}

export function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="hidden rounded-md border border-current/30 px-1.5 py-0.5 font-mono text-xs font-medium opacity-80 [@media(hover:hover)_and_(pointer:fine)]:inline-block">
      {children}
    </kbd>
  );
}
