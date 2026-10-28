import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
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
	metadataBase: new URL(process.env.NEXT_PUBLIC_DOCS_URL ?? "https://docs.lekhan.app"),
	title: {
		default: "Lekhan Docs",
		template: "%s · Lekhan Docs",
	},
	description:
		"Guides for Lekhan, the AI-native knowledge workspace: pages, workspaces, links, tags, imports, and AI on your own keys or machine.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
	return (
		<html
			lang="en"
			className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
			suppressHydrationWarning
		>
			<body className="flex min-h-full flex-col">{children}</body>
		</html>
	);
}
