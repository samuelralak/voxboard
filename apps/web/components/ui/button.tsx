import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

type Variant = "primary" | "outline" | "ghost";
type Size = "sm" | "md" | "lg" | "icon";

const VARIANT: Record<Variant, string> = {
  // The accent fill deepens on hover (token-driven), so the white label stays full-contrast instead of
  // fading with it. No shadow: the accent already separates the one action from the canvas.
  primary: "bg-accent text-accent-foreground hover:bg-accent-hover",
  outline: "border border-border text-ink hover:bg-surface-2 active:bg-surface",
  ghost: "text-muted hover:bg-surface-2 hover:text-ink",
};

const SIZE: Record<Size, string> = {
  sm: "h-8 gap-1.5 px-3 text-sm",
  md: "h-9 gap-2 px-4 text-sm",
  lg: "h-10 gap-2 px-4 text-sm",
  icon: "size-9",
};

/** The shared button styling, also usable on links (`<a className={buttonClasses({ ... })}>`) so a
 *  link-as-button never drifts from the real Button (one height scale, one focus ring, one accent). */
export function buttonClasses({
  variant = "primary",
  size = "md",
  className,
}: { variant?: Variant; size?: Size; className?: string } = {}): string {
  return cn(
    "inline-flex items-center justify-center rounded-md font-medium transition-colors active:translate-y-px",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas",
    "disabled:cursor-not-allowed disabled:opacity-50 disabled:active:translate-y-0",
    VARIANT[variant],
    SIZE[size],
    className,
  );
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "md", className, type = "button", children, ...props },
  ref,
) {
  // A busy button (aria-busy) shows a calm spinner so an in-flight relay publish reads as working, not
  // dead. The disabled greying stays; the spinner just adds the ~150ms motion the squint test can read.
  const busy = props["aria-busy"] === true || props["aria-busy"] === "true";
  return (
    <button ref={ref} type={type} className={buttonClasses({ variant, size, className })} {...props}>
      {busy ? (
        <span
          className="size-4 shrink-0 animate-spin rounded-full border-2 border-current border-r-transparent motion-reduce:animate-none"
          aria-hidden
        />
      ) : null}
      {children}
    </button>
  );
});
