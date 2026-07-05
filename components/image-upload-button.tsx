import React, { useRef } from 'react'

export function ImageUploadButton({ onUpload }: { onUpload: (url: string) => void }) {
	const fileInputRef = useRef<HTMLInputElement>(null)

	const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		const file = e.target.files?.[0]
		if (file) {
			const reader = new FileReader()
			reader.onload = (event) => {
				if (event.target?.result) {
					onUpload(event.target.result.toString())
				}
			}
			reader.readAsDataURL(file)
		}
		// Reset input
		if (fileInputRef.current) {
			fileInputRef.current.value = ''
		}
	}

	return (
		<>
			<input
				type="file"
				accept="image/*"
				ref={fileInputRef}
				onChange={handleFileChange}
				className="hidden"
			/>
			<button
				onClick={() => fileInputRef.current?.click()}
				className="p-1 rounded transition-colors flex items-center justify-center text-on-surface hover:bg-black/5 dark:hover:bg-white/10"
				title="Upload Image"
			>
				<span className="material-symbols-outlined text-[18px]">image</span>
			</button>
		</>
	)
}
