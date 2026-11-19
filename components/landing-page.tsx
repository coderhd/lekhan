'use client'

import Image from 'next/image'
import Link from 'next/link'
import { Button } from '@astryxdesign/core/Button'
import { ArrowRight } from 'lucide-react'
import ThemeToggle from './theme-toggle'
import { GlobalHeaderSlot } from './layout/global-header-context'

const workflow = [
	{
		title: 'Bring your Obsidian vault.',
		body: 'Choose a vault folder or ZIP, or start with a single Markdown file. After import, open Browse to find the nested pages and check the report for anything that needed conversion.',
		src: '/early/shot-astryx-import.png',
		width: 672,
		height: 628,
		alt: 'The Lekhan import picker with vault and Markdown options',
	},
	{
		title: 'Follow an idea across pages.',
		body: 'Link pages as you write, follow backlinks to see where an idea came from, and search when you remember a phrase but have forgotten the page title.',
		src: '/early/shot-editor.png',
		width: 1280,
		height: 800,
		alt: 'A linked note open in the Lekhan web editor',
	},
	{
		title: 'Give collaborators the right access.',
		body: 'Share a page with someone who needs to read it or invite an editor to write alongside you. Keep the rest of your workspace private.',
		src: '/early/shot-share.png',
		width: 1280,
		height: 800,
		alt: 'The sharing controls on a Lekhan page',
	},
]

export default function LandingPage() {
	return (
		<div className="ax-landing">
			<GlobalHeaderSlot slot="main">
				<Link href="/#features">How it works</Link>
				<Link href="/about">About</Link>
				<Link href="/faq">FAQ</Link>
			</GlobalHeaderSlot>
			<GlobalHeaderSlot slot="right">
				<div className="ax-header-actions">
					<ThemeToggle />
					<Button href="/login" label="Log In" variant="primary" className="ax-action ax-login" />
				</div>
			</GlobalHeaderSlot>
			<div className="ax-band ax-hero">
				<div className="ax-wrap ax-hero-grid">
					<div>
						<h1>A workspace for the notes you want to build on.</h1>
						<p>Bring your Markdown notes into Lekhan, connect what you know, and write alongside someone else in the browser.</p>
						<div className="ax-hero-actions">
							<Button href="/early?ref=hero" label="Join early access" className="ax-action" variant="primary" size="lg" endContent={<ArrowRight size={18} aria-hidden />} />
							<a href="#features">Explore the workflow</a>
						</div>
					</div>
					<figure className="ax-product">
						<Image src="/early/shot-astryx-workbench.png" alt="Lekhan Workbench showing a vault and its nested pages" width={1440} height={900} sizes="(min-width: 960px) 55vw, 100vw" priority />
						<figcaption>Lekhan web workspace</figcaption>
					</figure>
				</div>
			</div>

			<section className="ax-wrap ax-workflow" id="features" aria-labelledby="workflow-title">
				<h2 id="workflow-title">From scattered notes to shared work</h2>
				<div id="how-it-works">
					{workflow.map(item => (
						<article className="ax-workflow-item" key={item.title}>
							<div><h3>{item.title}</h3><p>{item.body}</p></div>
							<Image src={item.src} alt={item.alt} width={item.width} height={item.height} sizes="(min-width: 960px) 50vw, 100vw" />
						</article>
					))}
				</div>
			</section>

			<section className="ax-band">
				<div className="ax-wrap ax-answers">
					<h2>Make the workspace yours</h2>
					<dl>
						<div><dt>Can I take my notes with me?</dt><dd>Export your workspace as Markdown. Open the files in a text editor or bring them into another Markdown tool.</dd></div>
						<div><dt>Can I keep writing if I lose my connection?</dt><dd>Keep editing an already opened page using the browser’s local copy. Check sync status when you reconnect.</dd></div>
						<div><dt>How does AI work?</dt><dd>Choose a supported provider and model, then connect your own API key or a supported local runtime. Your provider’s terms and usage charges apply.</dd></div>
						<div><dt>Where do I see earlier versions?</dt><dd>Open version history to review saved changes and restore an earlier version. Retention depends on your workspace tier.</dd></div>
					</dl>
				</div>
			</section>
			<section className="ax-wrap ax-invite">
				<h2>Bring your next project to Lekhan.</h2>
				<p>Join the web beta waitlist, then confirm your email so we can send your invite.</p>
				<Button href="/early?ref=cta" label="Join early access" className="ax-action" variant="primary" size="lg" endContent={<ArrowRight size={18} aria-hidden />} />
			</section>
		</div>
	)
}
