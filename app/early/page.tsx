import Image from 'next/image'
import { EarlyAccessForm } from '@/components/early/early-access-form'
import { supabase } from '@/lib/supabase'

/**
 * /early — founding-edition landing page (#85).
 *
 * Hallmark · macrostructure: Stat-Led · genre: editorial · theme: brand-locked
 * (cream paper · teak accent · Fraunces/Geist/Geist Mono) · enrichment: real
 * screenshots, hairline figures · nav: N1a minimal · footer: statement
 *
 * Honest scarcity: the cap (500) and the live claimed count are both real.
 * No countdown timers, no fake urgency (playbook rule 3).
 */

const FOUNDING_CAP = 500

interface PageProps {
	searchParams: Promise<Record<string, string | string[] | undefined>>
}

async function getClaimedCount (): Promise<number | null> {
	try {
		const { data } = await supabase.rpc('waitlist_stats')
		const row = Array.isArray(data) ? data[0] : data
		const claimed = Number(row?.claimed)
		return Number.isFinite(claimed) && claimed >= 0 ? claimed : null
	} catch {
		// Stats unavailable: render without the counter rather than lying "0 claimed".
		return null
	}
}

function firstParam (value: string | string[] | undefined): string | undefined {
	return Array.isArray(value) ? value[0] : value
}

const SHOTS = [
	{
		src: '/early/shot-editor.png',
		alt: 'Lekhan editor showing a product roadmap page with headings, a tip callout and a task list',
		caption: 'Callouts, task lists and markdown render as you type.',
		width: 1280,
		height: 661,
	},
	{
		src: '/early/shot-import.png',
		alt: 'Obsidian vault import report showing preserved links and callouts',
		caption: 'Move an entire Obsidian vault in minutes — links, tags and callouts survive.',
		width: 1280,
		height: 800,
	},
	{
		src: '/early/shot-share.png',
		alt: 'Sharing panel inviting a collaborator to a single page',
		caption: 'Share one page or a whole workspace. Your files stay yours.',
		width: 1280,
		height: 800,
	},
] as const

export default async function EarlyPage ({ searchParams }: PageProps) {
	const params = await searchParams
	const joinedParam = firstParam(params.joined)
	const wave2 = firstParam(params.wave2) === '1'
	const ref = firstParam(params.ref)
	const utm = firstParam(params.utm_source)
	const claimed = await getClaimedCount()

	const percentFull =
		claimed == null ? null : Math.min(100, Math.round((Math.max(claimed, 1) / FOUNDING_CAP) * 100))

	return (
		<div className="ek-page">
			<style>{STYLES}</style>

			{/* Global site chrome (header/footer) wraps this page — no local nav.
			    The hero CTA anchors to #claim for in-page navigation. */}

			<main>
				{/*
				 * Edition hero: the real cap as the figure, paired with the
				 * positioning line (Stat-Led requires words beside the number).
				 */}
				<section className="ek-hero">
					<p className="ek-figure tnum" aria-label={`${FOUNDING_CAP} founding spots`}>
						500
					</p>
					<div className="ek-hero-copy">
						<h1 className="ek-headline">numbered spots. Your second brain, your files, your AI.</h1>
						<p className="ek-subhead">
							Local-first like Obsidian, collaborative like Notion — and AI runs on your own keys.
						</p>
						<p className="ek-qualifier tnum">
							{claimed == null
								? 'Founding edition · closes when full'
								: `Founding edition · ${claimed} claimed · closes when full`}
						</p>
						{percentFull != null && (
							<div
								className="ek-meter"
								role="img"
								aria-label={`${percentFull}% of founding spots claimed`}
							>
								<div className="ek-meter-fill" style={{ width: `${percentFull}%` }} />
							</div>
						)}
						<a className="ek-chip" href="#claim">
							Claim your spot ↓
						</a>
					</div>
				</section>

				<section className="ek-shots">
					<h2 className="ek-section-head">What you&apos;re joining</h2>
					<div className="ek-shot-grid">
						{SHOTS.map(shot => (
							<figure key={shot.src} className="ek-shot">
								<Image
									src={shot.src}
									alt={shot.alt}
									width={shot.width}
									height={shot.height}
									className="ek-shot-img"
								/>
								<figcaption className="ek-shot-caption">{shot.caption}</figcaption>
							</figure>
						))}
					</div>
				</section>

				<section className="ek-terms">
					<h2 className="ek-section-head">What founding members get</h2>
					<dl className="ek-term-list">
						<div className="ek-term">
							<dt>№ your spot, kept for good</dt>
							<dd>Your place in the edition is permanent — it appears inside the app.</dd>
						</div>
						<div className="ek-term">
							<dt>Founding price, locked for life</dt>
							<dd>
								Plus $4/mo ($40/yr) · Pro $8/mo ($80/yr) — founding members keep these forever;
								list prices move to $6/$12 after launch.
							</dd>
						</div>
						<div className="ek-term">
							<dt>AI on your own keys</dt>
							<dd>Bring OpenAI, Anthropic or Google keys. Requests go browser-direct — never pooled.</dd>
						</div>
						<div className="ek-term">
							<dt>Files that stay files</dt>
							<dd>Markdown export any time. Joining is not a lock-in.</dd>
						</div>
					</dl>
				</section>

				<section className="ek-claim" id="claim">
					<h2 className="ek-section-head">Claim your spot</h2>

					{joinedParam != null ? (
						// No-JS path: the route redirected back with the spot number.
						<div className="ek-plate" role="status">
							{wave2 ? (
								<>
									<p className="ek-plate-figure tnum">№ {joinedParam}</p>
									<p className="ek-plate-note">
										The founding edition of 500 is fully claimed — you&apos;re on the wave-two list.
										We&apos;ll email your invite the moment a spot opens.
									</p>
								</>
							) : (
								<>
									<p className="ek-plate-kicker">Your founding spot</p>
									<p className="ek-plate-figure tnum">
										№ {joinedParam} <span className="ek-plate-of">of 500</span>
									</p>
									<p className="ek-plate-note">
										Spot reserved. Check your inbox for the confirmation email — your invite
										follows once you confirm.
									</p>
								</>
							)}
						</div>
					) : (
						<EarlyAccessForm defaultRef={ref} defaultUtm={utm} />
					)}
				</section>

				<section className="ek-faq">
					<h2 className="ek-section-head">Fair questions</h2>
					<div className="ek-faq-list">
						<div className="ek-faq-item">
							<h3>What does “local-first” actually mean?</h3>
							<p>
								Your notes live as files you control. The app works without a network and syncs
								when you have one. Leaving is an export button, not a migration project.
							</p>
						</div>
						<div className="ek-faq-item">
							<h3>How does “AI on my own keys” work?</h3>
							<p>
								You paste in an API key from your provider of choice. Requests go straight from
								your browser to that provider — Lekhan never sees, stores or pools them.
							</p>
						</div>
						<div className="ek-faq-item">
							<h3>When do invites go out?</h3>
							<p>
								Rolling invites for the private beta start in September 2026, in spot-number
								order. Confirm your email so your spot isn&apos;t skipped.
							</p>
						</div>
						<div className="ek-faq-item">
							<h3>Can I import my Obsidian vault?</h3>
							<p>Yes — that shipped first. Links, tags, callouts and folders come across intact.</p>
						</div>
 					</div>
 				</section>
 			</main>
 		</div>
 	)
 }

const STYLES = `
/* Hallmark · macrostructure: Stat-Led · theme: brand-locked custom
 * paper: light cream · accent: warm teak · display: high-contrast serif
 * type: Fraunces display · Geist body · Geist Mono outlier (figures only)
 */
.ek-page {
	--ek-paper: #f9f8f4;
	--ek-ink: #191713;
	--ek-muted: #5d5850;
	--ek-teak: #c96a10;
	--ek-teak-bright: hsl(33 100% 46%);
	--ek-hairline: rgba(25, 23, 19, 0.16);
	--ek-paper-raised: #ffffff;

	background: var(--ek-paper);
	color: var(--ek-ink);
	font-family: var(--font-geist, Geist, ui-sans-serif, system-ui, sans-serif);
	line-height: 1.6;
	min-height: 100vh;
	overflow-x: clip;
}
.ek-page .tnum { font-variant-numeric: tabular-nums; }
.ek-page h1, .ek-page h2, .ek-page h3 { font-style: normal; overflow-wrap: anywhere; min-width: 0; }

/* Dark mode: blend with the site theme instead of forcing light paper */
.dark .ek-page {
	--ek-paper: #121413;
	--ek-ink: #f0efeb;
	--ek-muted: #a6a49d;
	--ek-teak: #e08a2e;
	--ek-teak-bright: hsl(33 100% 55%);
	--ek-hairline: rgba(240, 239, 235, 0.14);
	--ek-paper-raised: #1b1d1c;
}
.dark .ek-meter { background: rgba(240, 239, 235, 0.12); }
.dark .ek-input, .dark .ek-textarea { background: var(--ek-paper-raised); }
.dark .ek-input::placeholder, .dark .ek-textarea::placeholder { color: rgba(240, 239, 235, 0.35); }
.dark .ek-button { background: var(--ek-teak-bright); color: #1a1208; }
.dark .ek-button:hover:not(:disabled) { background: hsl(33 100% 60%); }
.dark .ek-error { color: #ff9d80; }

main { max-width: 1080px; margin: 0 auto; padding: 0 24px; }

.ek-hero {
	display: grid; grid-template-columns: minmax(0, auto) minmax(0, 1fr);
	gap: clamp(24px, 5vw, 72px); align-items: end;
	padding: clamp(64px, 12vh, 128px) 0 clamp(48px, 8vh, 88px);
	border-bottom: 1px solid var(--ek-hairline);
	animation: ek-rise 500ms ease-out both;
}
@keyframes ek-rise { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }

.ek-figure {
	font-family: var(--font-geist-mono, 'Geist Mono', ui-monospace, monospace);
	font-size: clamp(88px, 18vw, 200px);
	font-weight: 500; line-height: 0.9; letter-spacing: -0.04em;
	margin: 0; color: var(--ek-ink);
}
.ek-headline {
	font-family: Fraunces, ui-serif, Georgia, serif;
	font-size: clamp(28px, 4.5vw, 52px);
	font-weight: 600; line-height: 1.08; letter-spacing: -0.01em;
	margin: 0 0 20px;
}
.ek-subhead { font-size: clamp(17px, 2vw, 21px); color: var(--ek-muted); margin: 0 0 28px; max-width: 56ch; }
.ek-qualifier {
	font-family: var(--font-geist-mono, 'Geist Mono', ui-monospace, monospace);
	font-size: 13.5px; letter-spacing: 0.04em; color: var(--ek-teak);
	margin: 0 0 10px;
}
.ek-meter { height: 4px; background: rgba(25,23,19,0.1); border-radius: 2px; max-width: 340px; margin-bottom: 32px; overflow: hidden; }
.ek-meter-fill { height: 100%; background: var(--ek-teak-bright); transition: width 600ms ease-out; }
.ek-chip {
	display: inline-block; padding: 10px 22px;
	border: 1.5px solid var(--ek-ink); border-radius: 999px;
	color: var(--ek-ink); text-decoration: none; font-weight: 500; font-size: 15px;
	white-space: nowrap;
}
.ek-chip:hover { background: var(--ek-ink); color: var(--ek-paper); }

section { padding: clamp(48px, 9vh, 88px) 0; border-bottom: 1px solid var(--ek-hairline); }
.ek-section-head {
	font-family: Fraunces, ui-serif, Georgia, serif;
	font-size: clamp(22px, 3vw, 30px); font-weight: 600;
	margin: 0 0 36px;
}

.ek-shot-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 28px; }
.ek-shot { margin: 0; }
.ek-shot-img {
	width: 100%; height: auto; display: block;
	border: 1px solid var(--ek-hairline); border-radius: 6px;
	background: var(--ek-paper-raised);
}
.ek-shot-caption { font-size: 14px; color: var(--ek-muted); margin-top: 12px; line-height: 1.5; }

.ek-term-list { margin: 0; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0 48px; }
.ek-term { padding: 22px 0; border-top: 1px solid var(--ek-hairline); }
.ek-term dt { font-family: Fraunces, ui-serif, Georgia, serif; font-size: 19px; font-weight: 600; margin-bottom: 6px; }
.ek-term dd { margin: 0; color: var(--ek-muted); font-size: 15px; }

.ek-form-row { display: flex; gap: 12px; align-items: stretch; max-width: 520px; }
.ek-label { display: block; font-size: 14px; font-weight: 500; margin: 0 0 8px; }
.ek-label[for='ek-email'] { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
.ek-input, .ek-textarea {
	flex: 1; min-width: 0;
	padding: 12px 16px; font-size: 16px; font-family: inherit;
	border: 1.5px solid var(--ek-hairline); border-radius: 6px;
	background: var(--ek-paper-raised); color: var(--ek-ink);
}
.ek-textarea { width: 100%; max-width: 520px; margin-top: 16px; resize: vertical; }
.ek-input:focus-visible, .ek-textarea:focus-visible, .ek-button:focus-visible, .ek-chip:focus-visible {
	outline: 2px solid var(--ek-teak-bright); outline-offset: 2px;
}
.ek-input-invalid { border-color: var(--ek-teak); }
.ek-input::placeholder, .ek-textarea::placeholder { color: rgba(25,23,19,0.35); }
.ek-button {
	padding: 12px 24px; border: none; border-radius: 6px;
	background: var(--ek-ink); color: var(--ek-paper);
	font-size: 15px; font-weight: 500; white-space: nowrap;
	cursor: pointer;
}
.ek-button:hover:not(:disabled) { background: #000; }
.ek-button:active:not(:disabled) { transform: translateY(1px); }
.ek-button:disabled { opacity: 0.55; cursor: wait; }
.ek-optional { color: var(--ek-muted); font-weight: 400; }
.ek-error { color: #8a2f14; font-size: 14px; margin: 12px 0 0; }
.ek-fineprint { color: var(--ek-muted); font-size: 13px; margin: 14px 0 0; }

.ek-plate {
	max-width: 520px; padding: 40px 44px; text-align: center;
	border: 1.5px solid var(--ek-ink); border-radius: 8px;
	background: var(--ek-paper-raised);
}
.ek-plate-kicker, .ek-plate-note { margin: 0; }
.ek-plate-kicker {
	font-family: var(--font-geist-mono, 'Geist Mono', ui-monospace, monospace);
	font-size: 12.5px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--ek-teak);
	margin-bottom: 10px;
}
.ek-plate-figure {
	font-family: var(--font-geist-mono, 'Geist Mono', ui-monospace, monospace);
	font-size: clamp(44px, 8vw, 72px); font-weight: 500; line-height: 1; letter-spacing: -0.02em;
	margin: 0 0 14px;
}
.ek-plate-of { font-size: 0.38em; color: var(--ek-muted); letter-spacing: 0; }
.ek-plate-note { color: var(--ek-muted); font-size: 15px; line-height: 1.55; }

.ek-faq-item { border-top: 1px solid var(--ek-hairline); padding: 20px 0; max-width: 68ch; }
.ek-faq-item h3 { font-size: 17px; font-weight: 600; margin: 0 0 8px; }
.ek-faq-item p { margin: 0; color: var(--ek-muted); font-size: 15px; }


@media (max-width: 768px) {
	.ek-hero { grid-template-columns: 1fr; align-items: start; }
	.ek-shot-grid { grid-template-columns: 1fr; }
	.ek-term-list { grid-template-columns: 1fr; }
	.ek-form-row { flex-direction: column; }
	.ek-button { width: 100%; }
}
@media (max-width: 320px) {
	.ek-figure { font-size: 72px; }
	main { padding: 0 16px; }
}
@media (prefers-reduced-motion: reduce) {
	.ek-hero { animation: none; }
	.ek-meter-fill { transition: none; }
}
`
