import type { Metadata } from "next";
import { HugeiconsIcon } from "@hugeicons/react";
import { FlashIcon, Bitcoin01Icon, Github01Icon, ArrowUpRight01Icon } from "@hugeicons/core-free-icons";
import { Shell } from "@/components/layout/shell";
import { DonateMethod } from "@/components/donate/donate-method";

export const metadata: Metadata = {
  title: "Support Voxboard",
  description:
    "Voxboard is free, open source, and non-custodial. If it is useful to you, a few sats help keep it running.",
};

// Donation destinations. Lightning is preferred for sats-sized tips. Leave ONCHAIN_ADDRESS empty to hide
// the on-chain card.
const LIGHTNING_ADDRESS = "afraidstorm87@walletofsatoshi.com";
const ONCHAIN_ADDRESS = "bc1q2kkvcqkn9s5alhcr8uw0t80kga994eukzmxsa3";
const REPO_URL = "https://github.com/samuelralak/voxboard";

export default function DonatePage() {
  return (
    <Shell className="py-10">
      <header className="max-w-xl">
        <h1 className="font-display font-display-lg text-3xl font-semibold leading-tight tracking-tight text-ink">
          Support Voxboard
        </h1>
        <p className="mt-3 text-base leading-relaxed text-muted">
          Voxboard is free, open source, and non-custodial. If it is useful to you, a few sats help keep
          it running and independent.
        </p>
      </header>

      <div className="mt-8 max-w-xl space-y-3">
        <DonateMethod
          kind="Lightning"
          note="Instant, lowest fees. Pay to this Lightning address."
          icon={FlashIcon}
          value={LIGHTNING_ADDRESS}
          tint="zap"
        />
        {ONCHAIN_ADDRESS ? (
          <DonateMethod
            kind="On-chain Bitcoin"
            note="For larger amounts. Send to this address."
            icon={Bitcoin01Icon}
            value={ONCHAIN_ADDRESS}
          />
        ) : null}

        <p className="pt-1 text-xs leading-relaxed text-muted">
          Donations are voluntary and go toward keeping Voxboard independent and free to use. They are not
          payment for any service.
        </p>
      </div>

      <div className="mt-10 max-w-xl border-t border-border pt-6">
        <a
          href={REPO_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 text-sm text-muted transition-colors hover:text-ink"
        >
          <HugeiconsIcon icon={Github01Icon} size={16} strokeWidth={2} />
          Voxboard is open source on GitHub
          <HugeiconsIcon icon={ArrowUpRight01Icon} size={13} strokeWidth={2} />
        </a>
      </div>
    </Shell>
  );
}
