import type { Metadata } from "next";
import { Inter, Noto_Nastaliq_Urdu } from "next/font/google";
import { Toaster } from "@/components/ui/toaster";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const nastaliq = Noto_Nastaliq_Urdu({ subsets: ["arabic"], weight: ["400", "700"], variable: "--font-nastaliq", display: "swap" });

export const metadata: Metadata = {
  title: { default: "Prospector", template: "%s · Prospector" },
  description: "Lead engine and outreach for Classwell, Vetlin and Postwala.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${nastaliq.variable}`}>
      <body>
        {children}
        <Toaster />
      </body>
    </html>
  );
}
