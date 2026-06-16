import type { Metadata, Viewport } from "next";
import { Providers } from "@/components/providers/providers";
import { SiteHeader } from "@/components/layout/site-header";
import { SiteFooter } from "@/components/layout/site-footer";
import { fontVariables } from "@/lib/fonts";
import { themeScript } from "@/lib/theme-script";
import { BRAND } from "@/lib/tokens";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Voxboard",
    template: "%s | Voxboard",
  },
  description: "Open feedback boards on Nostr. Post ideas, vote, and watch them ship.",
  applicationName: "Voxboard",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: BRAND.light.canvas },
    { media: "(prefers-color-scheme: dark)", color: BRAND.dark.canvas },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={fontVariables} suppressHydrationWarning>
      <head>
        {/* Set the theme before first paint to avoid a flash of the wrong mode. */}
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-dvh">
        <Providers>
          <div className="flex min-h-dvh flex-col">
            <SiteHeader />
            {/* Pages render their content through <Shell> for consistent width + aligned edges. */}
            <main className="flex-1">{children}</main>
            <SiteFooter />
          </div>
        </Providers>
      </body>
    </html>
  );
}
