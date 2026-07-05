import * as React from 'react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { Check, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface SelectOption {
	label: string
	value: string
	style?: React.CSSProperties
	className?: string
}

interface CustomSelectProps {
	value: string
	onValueChange: (value: string) => void
	options: SelectOption[]
	placeholder?: string
	className?: string
	triggerClassName?: string
	contentClassName?: string
	align?: 'start' | 'center' | 'end'
}

export function CustomSelect({
	value,
	onValueChange,
	options,
	placeholder = 'Select an option',
	className,
	triggerClassName,
	contentClassName,
	align = 'start',
}: CustomSelectProps) {
	const selectedOption = options.find((opt) => opt.value === value)

	return (
		<div className={className}>
			<DropdownMenu.Root modal={false}>
				<DropdownMenu.Trigger asChild>
					<button
						className={cn(
							'flex h-10 w-full items-center justify-between rounded-md border border-black/10 dark:border-white/10 bg-black/5 dark:bg-white/5 px-3 py-2 text-sm text-on-surface ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary-container focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 transition-colors',
							triggerClassName
						)}
					>
						<span className="truncate">
							{selectedOption ? selectedOption.label : placeholder}
						</span>
						<ChevronDown className='h-4 w-4 opacity-50' />
					</button>
				</DropdownMenu.Trigger>

				<DropdownMenu.Portal>
					<DropdownMenu.Content
						align={align}
						className={cn(
							'z-[9999] min-w-[8rem] overflow-hidden rounded-xl border border-black/10 dark:border-white/10 bg-surface-container p-1 text-on-surface shadow-xl shadow-black/20 animate-in fade-in-80 zoom-in-95 backdrop-blur-xl',
							contentClassName
						)}
						style={{ minWidth: 'var(--radix-dropdown-menu-trigger-width)' }}
					>
						{options.map((option) => (
							<DropdownMenu.Item
								key={option.value}
								onClick={() => onValueChange(option.value)}
								className={cn(
									'relative flex w-full cursor-pointer select-none items-center rounded-lg py-2 pl-8 pr-4 text-sm outline-none transition-colors hover:bg-black/10 focus:bg-black/10 dark:hover:bg-white/10 dark:focus:bg-white/10 data-[disabled]:pointer-events-none data-[disabled]:opacity-50 whitespace-nowrap',
									option.className
								)}
								style={option.style}
							>
								<span className='absolute left-2 flex h-3.5 w-3.5 items-center justify-center'>
									{value === option.value && <Check className='h-4 w-4 text-primary-container font-bold' />}
								</span>
								{option.label}
							</DropdownMenu.Item>
						))}
					</DropdownMenu.Content>
				</DropdownMenu.Portal>
			</DropdownMenu.Root>
		</div>
	)
}
