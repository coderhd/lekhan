import Link from 'next/link'
import Image from 'next/image'

export default function NotFound() {
	return (
		<div className="min-h-screen bg-background text-on-surface flex flex-col items-center justify-center p-4">
			<div className="max-w-lg w-full p-8 text-center">
				<Image alt="Page not found" className="w-full max-w-[240px] h-auto mx-auto mb-6" src="/page-not-found.svg" width={240} height={160} />
				<h2 className="text-2xl font-display-md font-bold mb-3 text-on-surface">Seems you are lost!</h2>
				<p className="text-on-surface-variant mb-8 text-sm">The page you are looking for might have been moved or deleted.</p>
				<Link
					href="/"
					className="px-6 py-3 bg-primary text-on-primary rounded-md font-bold hover:bg-primary/90 transition-colors inline-block"
				>
					Take Me Home
				</Link>
			</div>
		</div>
	)
}
