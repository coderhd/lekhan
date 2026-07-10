import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
	title: 'Terms of Service | Lekhan',
	description: 'Read the terms and conditions for using Lekhan, the collaborative local-first editor. Covers usage, accounts, content ownership, and more.',
	openGraph: {
		title: 'Terms of Service — Lekhan',
		description: 'Terms and conditions for using the Lekhan collaborative editor.',
	},
}

import { GlobalHeader } from '@/components/layout/global-header'

export default function TermsOfServicePage () {
	return (
		<div className="bg-background text-on-surface min-h-screen flex flex-col">
			<GlobalHeader />
			<div className="max-w-[800px] mx-auto px-6 md:px-10 pt-16 pb-24 flex-1">
				{/* Header */}
				<div className="mb-12">
					<h1 className="font-display-lg text-4xl md:text-5xl font-bold text-on-surface mb-4">
						Terms of Service
					</h1>
					<p className="text-muted-foreground">
						Last updated: July 2025
					</p>
				</div>

				{/* Content */}
				<div className="prose-custom space-y-10">
					<section>
						<h2 className="font-headline-md text-xl font-bold text-on-surface mb-3">
							Acceptance of Terms
						</h2>
						<p className="text-muted-foreground leading-relaxed">
							By accessing or using Lekhan (&ldquo;the Service&rdquo;), you agree to be bound by these Terms of Service. If you do not agree with any part of these terms, please do not use the Service.
						</p>
					</section>

					<section>
						<h2 className="font-headline-md text-xl font-bold text-on-surface mb-3">
							Description of Service
						</h2>
						<p className="text-muted-foreground leading-relaxed">
							Lekhan is a collaborative, local-first document editor that enables real-time writing, editing, and sharing of documents. The Service includes web-based editing, document sync, collaboration features, and AI-assisted writing tools.
						</p>
					</section>

					<section>
						<h2 className="font-headline-md text-xl font-bold text-on-surface mb-3">
							User Accounts
						</h2>
						<div className="space-y-3 text-muted-foreground leading-relaxed">
							<p>
								To use Lekhan, you must create an account with a valid email address. You are responsible for:
							</p>
							<ul className="space-y-2 list-disc list-inside">
								<li>Maintaining the confidentiality of your account credentials</li>
								<li>All activity that occurs under your account</li>
								<li>Notifying us immediately of any unauthorized use</li>
							</ul>
							<p>
								You must be at least 13 years old to create an account and use the Service.
							</p>
						</div>
					</section>

					<section>
						<h2 className="font-headline-md text-xl font-bold text-on-surface mb-3">
							Content Ownership
						</h2>
						<p className="text-muted-foreground leading-relaxed">
							<span className="font-semibold text-on-surface">You own your content.</span> Any documents, text, or other materials you create using Lekhan remain entirely yours. We do not claim ownership or intellectual property rights over your content.
						</p>
						<p className="text-muted-foreground leading-relaxed mt-3">
							By using the Service, you grant us a limited license to store, sync, and transmit your content solely for the purpose of providing the Service to you and your collaborators.
						</p>
					</section>

					<section>
						<h2 className="font-headline-md text-xl font-bold text-on-surface mb-3">
							Acceptable Use
						</h2>
						<p className="text-muted-foreground leading-relaxed">
							You agree not to use Lekhan to:
						</p>
						<ul className="space-y-2 text-muted-foreground leading-relaxed list-disc list-inside mt-3">
							<li>Violate any applicable laws or regulations</li>
							<li>Distribute malware, spam, or harmful content</li>
							<li>Attempt to gain unauthorized access to other users&apos; accounts or documents</li>
							<li>Interfere with or disrupt the Service&apos;s infrastructure</li>
							<li>Use automated tools to scrape or extract data from the Service</li>
						</ul>
					</section>

					<section>
						<h2 className="font-headline-md text-xl font-bold text-on-surface mb-3">
							Collaboration & Sharing
						</h2>
						<p className="text-muted-foreground leading-relaxed">
							When you share a document, you grant other users access according to the role you assign (Owner, Editor, or Viewer). You are responsible for managing access to your documents. We are not liable for content shared by collaborators you have invited.
						</p>
					</section>

					<section>
						<h2 className="font-headline-md text-xl font-bold text-on-surface mb-3">
							AI Features
						</h2>
						<p className="text-muted-foreground leading-relaxed">
							Lekhan includes optional AI-assisted writing features. When you use these features, relevant portions of your document may be processed by third-party AI services to generate suggestions. We do not store or use AI-processed content beyond the immediate request.
						</p>
					</section>

					<section>
						<h2 className="font-headline-md text-xl font-bold text-on-surface mb-3">
							Service Availability
						</h2>
						<p className="text-muted-foreground leading-relaxed">
							We strive to keep Lekhan available at all times, but we do not guarantee uninterrupted service. Because Lekhan is local-first, your documents remain accessible on your device even during server downtime. We may perform maintenance, updates, or modifications that temporarily affect availability.
						</p>
					</section>

					<section>
						<h2 className="font-headline-md text-xl font-bold text-on-surface mb-3">
							Termination
						</h2>
						<p className="text-muted-foreground leading-relaxed">
							You may delete your account at any time. We reserve the right to suspend or terminate accounts that violate these terms. Upon termination, your cloud-synced data will be deleted. Local copies of your documents on your devices will remain accessible to you.
						</p>
					</section>

					<section>
						<h2 className="font-headline-md text-xl font-bold text-on-surface mb-3">
							Limitation of Liability
						</h2>
						<p className="text-muted-foreground leading-relaxed">
							Lekhan is provided &ldquo;as is&rdquo; without warranties of any kind, either express or implied. To the maximum extent permitted by law, we shall not be liable for any indirect, incidental, special, consequential, or punitive damages arising out of your use of the Service.
						</p>
					</section>

					<section>
						<h2 className="font-headline-md text-xl font-bold text-on-surface mb-3">
							Changes to These Terms
						</h2>
						<p className="text-muted-foreground leading-relaxed">
							We may update these Terms of Service from time to time. If we make material changes, we will notify you through the application or via email. Your continued use of Lekhan after the changes take effect constitutes acceptance of the updated terms.
						</p>
					</section>

					<section>
						<h2 className="font-headline-md text-xl font-bold text-on-surface mb-3">
							Contact
						</h2>
						<p className="text-muted-foreground leading-relaxed">
							If you have questions about these terms, contact us at <a href="mailto:harshdave1094@gmail.com" className="text-primary hover:underline">harshdave1094@gmail.com</a> or visit our <Link href="/contact" className="text-primary hover:underline">contact page</Link>.
						</p>
					</section>
				</div>
			</div>
		</div>
	)
}
