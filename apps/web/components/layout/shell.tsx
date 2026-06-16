import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * The app's two-level page shell (Tailwind UI pattern): an outer `max-w-7xl` with responsive gutters,
 * and an inner content column. The header, footer, and every page render through this, so their
 * content edges align exactly. Default inner width is the readable `max-w-3xl`; pass `width="wide"`
 * for full-width surfaces (e.g. a roadmap kanban). Extra layout classes for the inner column (flex,
 * vertical padding, etc.) go on `className`.
 */
export function Shell({
  children,
  width = "default",
  className,
}: {
  children: ReactNode;
  width?: "default" | "wide";
  className?: string;
}) {
  return (
    <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
      <div className={cn("mx-auto", width === "wide" ? "max-w-7xl" : "max-w-3xl", className)}>
        {children}
      </div>
    </div>
  );
}
