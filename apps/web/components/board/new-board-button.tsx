"use client";

import { useId } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { PlusSignIcon } from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import { useLoginGate } from "@/components/auth/login-gate";
import { openDialog } from "@/lib/dialog";
import { ClientOnly } from "@/components/util/client-only";
import { BoardDialog } from "./board-dialog";

/** "New board" CTA: opens the create-board dialog (login-gated). Mounts its own BoardDialog. */
export function NewBoardButton({
  variant = "primary",
  size = "md",
  label = "New board",
}: {
  variant?: "primary" | "outline";
  size?: "md" | "lg";
  label?: string;
} = {}) {
  const dialogId = useId();
  const { requireLogin } = useLoginGate();
  return (
    <>
      <Button variant={variant} size={size} onClick={() => requireLogin(() => openDialog(dialogId))}>
        <HugeiconsIcon icon={PlusSignIcon} size={16} strokeWidth={2} />
        {label}
      </Button>
      <ClientOnly>
        <BoardDialog dialogId={dialogId} />
      </ClientOnly>
    </>
  );
}
