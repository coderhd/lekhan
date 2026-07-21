import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
	title: 'Privacy Policy | Lekhan',
	description: 'Learn how Lekhan handles your data. Our privacy policy covers data collection, storage, security, and your rights as a user.',
	openGraph: {
		title: 'Privacy Policy — Lekhan',
		description: 'How we collect, use, and protect your data.',
	},
}

export default function PrivacyPolicyPage () {
	return (
		<div className="bg-background text-on-surface min-h-screen flex flex-col">
			<div className="max-w-[800px] mx-auto px-6 md:px-10 pt-8 pb-24 flex-1">
				{/* Header */}
				<div className="mb-12">
					<h1 className="font-display-lg text-4xl md:text-5xl font-bold text-on-surface mb-4">
						Privacy Policy
					</h1>
					<p className="text-muted-foreground">
						Last updated: July 2025
					</p>
				</div>

				{/* Content */}
				<div className="prose-custom space-y-10">
					<section>
						<h2 className="font-headline-md text-xl font-bold text-on-surface mb-3">
							Overview
						</h2>
						<p className="text-muted-foreground leading-relaxed">
							Lekhan (&ldquo;we,&rdquo; &ldquo;our,&rdquo; or &ldquo;us&rdquo;) is committed to protecting your privacy. This policy explains what information we collect, how we use it, and what choices you have. We believe your data belongs to you — and our local-first architecture reflects that principle.
						</p>
					</section>

					<section>
						<h2 className="font-headline-md text-xl font-bold text-on-surface mb-3">
							Information We Collect
						</h2>
						<div className="space-y-4 text-muted-foreground leading-relaxed">
							<div>
								<h3 className="font-semibold text-on-surface mb-1">Account Information</h3>
								<p>When you create an account, we collect your email address and name. This information is used solely for authentication and identifying you within shared documents.</p>
							</div>
							<div>
								<h3 className="font-semibold text-on-surface mb-1">Document Content</h3>
								<p>Your documents are stored locally on your device first, then synced to our cloud database for backup and collaboration. We do not read, analyze, or use your document content for any purpose other than providing the service.</p>
							</div>
							<div>
								<h3 className="font-semibold text-on-surface mb-1">Usage Data</h3>
								<p>We collect basic usage analytics (page views, feature usage) to improve the product. This data is aggregated and does not include your document content.</p>
							</div>
						</div>
					</section>

					<section>
						<h2 className="font-headline-md text-xl font-bold text-on-surface mb-3">
							How We Use Your Information
						</h2>
						<ul className="space-y-2 text-muted-foreground leading-relaxed list-disc list-inside">
							<li>To provide, maintain, and improve the Lekhan editor</li>
							<li>To authenticate your identity and manage document access</li>
							<li>To enable real-time collaboration and sync between devices</li>
							<li>To send important service notifications (outages, security alerts)</li>
							<li>To respond to your support requests</li>
						</ul>
						<p className="text-muted-foreground leading-relaxed mt-3">
							We do <span className="font-semibold text-on-surface">not</span> sell your data, train AI models on your content, or share your information with advertisers.
						</p>
					</section>

					<section>
						<h2 className="font-headline-md text-xl font-bold text-on-surface mb-3">
							Data Storage & Security
						</h2>
						<p className="text-muted-foreground leading-relaxed">
							Your data is stored using <a href="https://supabase.com" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">Supabase</a>, which provides secure PostgreSQL database hosting with encryption in transit. We enforce row-level security (RLS) policies to ensure only authorized users can access your documents.
						</p>
						<p className="text-muted-foreground leading-relaxed mt-3">
							Because Lekhan uses a local-first architecture, a copy of your data always lives on your device. Even if our servers experience downtime, your work remains accessible.
						</p>
					</section>

					<section>
						<h2 className="font-headline-md text-xl font-bold text-on-surface mb-3">
							Third-Party Services
						</h2>
						<p className="text-muted-foreground leading-relaxed">
							We use the following third-party services:
						</p>
						<ul className="space-y-2 text-muted-foreground leading-relaxed list-disc list-inside mt-3">
							<li><span className="font-semibold text-on-surface">Supabase</span> — Database, authentication, and real-time sync</li>
							<li><span className="font-semibold text-on-surface">Vercel</span> — Application hosting and deployment</li>
						</ul>
						<p className="text-muted-foreground leading-relaxed mt-3">
							Each of these services has their own privacy policies that govern their handling of your data.
						</p>
					</section>

					<section>
						<h2 className="font-headline-md text-xl font-bold text-on-surface mb-3">
							Cookies
						</h2>
						<p className="text-muted-foreground leading-relaxed">
							Lekhan uses essential cookies only — for authentication sessions and theme preferences. We do not use tracking cookies, advertising cookies, or third-party analytics cookies.
						</p>
					</section>

					<section>
						<h2 className="font-headline-md text-xl font-bold text-on-surface mb-3">
							Your Rights
						</h2>
						<p className="text-muted-foreground leading-relaxed">
							You have the right to:
						</p>
						<ul className="space-y-2 text-muted-foreground leading-relaxed list-disc list-inside mt-3">
							<li>Access the personal data we hold about you</li>
							<li>Request correction of inaccurate data</li>
							<li>Request deletion of your account and all associated data</li>
							<li>Export your documents at any time</li>
						</ul>
						<p className="text-muted-foreground leading-relaxed mt-3">
							To exercise any of these rights, contact us at <a href="mailto:harshdave1094@gmail.com" className="text-primary hover:underline">harshdave1094@gmail.com</a>.
						</p>
					</section>

					<section>
						<h2 className="font-headline-md text-xl font-bold text-on-surface mb-3">
							Changes to This Policy
						</h2>
						<p className="text-muted-foreground leading-relaxed">
							We may update this privacy policy from time to time. If we make significant changes, we&apos;ll notify you through the application or via email. Your continued use of Lekhan after changes constitutes acceptance of the updated policy.
						</p>
					</section>

					<section>
						<h2 className="font-headline-md text-xl font-bold text-on-surface mb-3">
							Contact
						</h2>
						<p className="text-muted-foreground leading-relaxed">
							If you have questions about this privacy policy, reach out at <a href="mailto:harshdave1094@gmail.com" className="text-primary hover:underline">harshdave1094@gmail.com</a> or visit our <Link href="/contact" className="text-primary hover:underline">contact page</Link>.
						</p>
					</section>
				</div>
			</div>
		</div>
	)
}
