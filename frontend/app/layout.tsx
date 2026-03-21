import type { Metadata } from "next";
import { Inter, Plus_Jakarta_Sans, Geist_Mono, Bitcount_Prop_Double_Ink } from "next/font/google";
import "./globals.css";
import WalletProvider from "@/components/wallet-provider";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

const plusJakarta = Plus_Jakarta_Sans({
  variable: "--font-plus-jakarta",
  subsets: ["latin"],
  weight: ["700", "800"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const bitcountPropDoubleInk = Bitcount_Prop_Double_Ink({
  variable: "--font-bitcount",
  subsets: ["latin"],
  weight: ["400"],
  display: "swap",
  adjustFontFallback: false,
});

export const metadata: Metadata = {
  title: "ALGOFLOW - Web3 Vercel",
  description:
    "A censorship-resistant deployment platform where sites live on IPFS. Deploy directly via MCP connection to algoflow. No servers. No censorship. Unstoppable.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${inter.variable} ${plusJakarta.variable} ${geistMono.variable} ${bitcountPropDoubleInk.variable} antialiased bg-tg-black text-white font-sans`}
      >
        <WalletProvider>{children}</WalletProvider>
      </body>
    </html>
  );
}
