import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import "@turnkey/react-wallet-kit/styles.css";
import { Providers } from "@/providers";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
    title: "Suwappu Dashboard | Premium DEX Bot",
    description: "Advanced cross-chain swap management",
    other: {
        "agent-manifest": "/.well-known/ai-plugin.json",
        "a2a-card": "/agent-card.json"
    }
};

export default function RootLayout({
    children,
}: Readonly<{
    children: React.ReactNode;
}>) {
    return (
        <html lang="en">
            <body className={`${inter.className} premium-gradient min-h-screen`}>
                <Providers>{children}</Providers>
            </body>
        </html>
    );
}
