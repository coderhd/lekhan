import React from 'react'

interface GlobalLoaderProps {
	fullScreen?: boolean
	text?: string
	size?: 'sm' | 'md'
}

export default function GlobalLoader({ fullScreen = true, text = 'Loading...', size = 'md' }: GlobalLoaderProps) {
	const content = (
		<div className={`flex flex-col items-center gap-8 ${size === 'sm' ? 'scale-50 origin-center' : ''}`}>
			<div className="relative w-24 h-24 flex items-center justify-center">
				<svg width="80" height="80" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg" className="overflow-visible">
					{/* The 'L' */}
					<path 
						d="M 30 20 L 30 80 L 70 80" 
						stroke="currentColor" 
						strokeWidth="14" 
						strokeLinecap="square" 
						strokeLinejoin="miter" 
						className="text-primary-container"
					/>
					{/* The Animated Box next to L */}
					<rect 
						x="68" 
						y="18" 
						width="18" 
						height="18" 
						fill="currentColor" 
						className="text-primary animate-spin origin-[77px_27px]"
					/>
				</svg>
			</div>
			{text && (
				<p className="text-sm text-on-surface-variant font-bold tracking-widest uppercase animate-pulse">
					{text}
				</p>
			)}
		</div>
	)

	if (fullScreen) {
		return (
			<div className="flex min-h-screen items-center justify-center bg-background text-on-surface">
				{content}
			</div>
		)
	}

	return content
}
