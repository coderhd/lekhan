'use client'

import Image from 'next/image'
import Link from 'next/link'
import { ArrowDown, ArrowRight } from 'lucide-react'
import ThemeToggle from './theme-toggle'
import { GlobalHeaderSlot } from './layout/global-header-context'

export default function LandingPage() {
	return (
		<div className="public-edition">
			<GlobalHeaderSlot slot="main">
				<Link href="/#features">How it works</Link>
				<Link href="/about">About</Link>
				<Link href="/faq">FAQ</Link>
			</GlobalHeaderSlot>
			<GlobalHeaderSlot slot="right">
				<ThemeToggle />
				<Link className="public-secondary" href="/login">Sign in</Link>
			</GlobalHeaderSlot>
			<main className="public-wrap">
				<section className="public-hero">
					<div>
						<h1>Make room for connected thinking.</h1>
						<p>Bring your Markdown notes into one workspace. Follow links between ideas, write together, and export your work when you need it.</p>
						<div className="public-actions">
							<Link className="public-primary" href="/early?ref=site">Join early access <ArrowRight aria-hidden size={18} /></Link>
							<a className="public-secondary" href="#features">See how it works <ArrowDown aria-hidden size={16} /></a>
						</div>
					</div>
					<figure>
						<Image src="/early/shot-editor.png" alt="A page open in the Lekhan editor" width={1280} height={800} sizes="(min-width: 960px) 55vw, 100vw" priority />
						<figcaption>The Lekhan web editor</figcaption>
					</figure>
				</section>

				<section className="public-work" id="features" aria-labelledby="work-title">
					<h2 id="work-title">From a vault to a shared workspace</h2>
					<article>
						<Image src="/early/shot-import.png" alt="The Lekhan import dialog with vault and Markdown choices" width={1280} height={800} sizes="(min-width: 960px) 50vw, 100vw" />
						<div>
							<h3>Bring your notes with you.</h3>
							<p>Import an Obsidian vault or a Markdown file. Read the import report to see what came across and what needs attention.</p>
						</div>
					</article>
					<article>
						<Image src="/early/shot-share.png" alt="Sharing controls in a Lekhan page" width={1280} height={800} sizes="(min-width: 960px) 50vw, 100vw" />
						<div>
							<h3>Write together, page by page.</h3>
							<p>Choose who can view or edit a page. Find related ideas through search and backlinks, then export your workspace as Markdown.</p>
						</div>
					</article>
				</section>
				<section className="public-invitation">
					<h2>Try Lekhan in your browser.</h2>
					<Link className="public-primary" href="/early?ref=site">Join early access <ArrowRight aria-hidden size={18} /></Link>
				</section>
			</main>
		</div>
	)
}
