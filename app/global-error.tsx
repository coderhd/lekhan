'use client'
 
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  console.error(error)
  return (
    <html>
      <body>
        <div className="min-h-screen bg-background text-on-surface flex flex-col items-center justify-center p-4">
			<div className="max-w-md w-full bg-surface-container rounded-3xl p-8 border border-white/10 text-center shadow-xl">
				<h2 className="text-2xl font-display-md font-bold mb-3 text-on-surface">Critical Application Error</h2>
				<button
					onClick={reset}
					className="px-6 py-3 bg-primary text-on-primary rounded-xl font-bold hover:bg-primary/90 transition-colors mt-6"
				>
					Try again
				</button>
			</div>
		</div>
      </body>
    </html>
  )
}
