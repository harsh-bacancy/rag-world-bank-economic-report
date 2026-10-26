import type { Metadata } from "next";
import { Public_Sans, Source_Serif_4 } from "next/font/google";
import { SiteHeader } from "@/components/site-header";
import "./globals.css";

const ui = Public_Sans({ variable: "--font-public-sans", subsets: ["latin"], weight: ["400", "500", "600", "700"], style: ["normal", "italic"] });
const record = Source_Serif_4({ variable: "--font-source-serif", subsets: ["latin"], weight: ["400", "600", "700"], style: ["normal", "italic"] });

export const metadata: Metadata = {
  title: { default: "GEP Navigator", template: "%s · GEP Navigator" },
  description: "Ask the World Bank's Global Economic Prospects (June 2026) and get answers pinned to the chapter, section and page they came from.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${ui.variable} ${record.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        <SiteHeader />
        {children}
      </body>
    </html>
  );
}
