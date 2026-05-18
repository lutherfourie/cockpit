import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { CockpitCopilotProvider } from "@/components/cockpit/copilot-provider";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Cockpit",
  description: "A focused ADHD development assistant.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <CockpitCopilotProvider runtimeEnabled={Boolean(process.env.OPENAI_API_KEY)}>
          {children}
        </CockpitCopilotProvider>
      </body>
    </html>
  );
}
