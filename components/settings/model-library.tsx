import React, { useState, useMemo } from 'react'
import { Search, CheckCircle2, Cpu, Zap, DollarSign } from 'lucide-react'
import { providerRegistry, formatModelDescription } from '../../lib/ai/provider-registry'
import { ModelCategory, CostTier } from '../../lib/ai/types'
import { HardwareProfile, getHardwareRecommendation } from '../../lib/ai/hardware'
import { Button } from '../ui/button'

interface ModelLibraryProps {
	activeModelId: string
	onSelectModel: (modelId: string, providerId: string) => void
	hardwareProfile?: HardwareProfile
}

export function ModelLibrary({ activeModelId, onSelectModel, hardwareProfile }: ModelLibraryProps) {
	const [searchQuery, setSearchQuery] = useState('')
	const [categoryFilter, setCategoryFilter] = useState<ModelCategory | 'all'>('all')
	const [costFilter, setCostFilter] = useState<CostTier | 'all'>('all')

	const filteredModels = useMemo(() => {
		return providerRegistry.listModels({ costTier: costFilter === 'all' ? undefined : costFilter, category: categoryFilter === 'all' ? undefined : categoryFilter, searchQuery: searchQuery || undefined })
	}, [searchQuery, categoryFilter, costFilter])

	return (
		<div className="flex flex-col space-y-6 w-full">
			<div className="flex flex-col md:flex-row gap-4 items-center justify-between">
				<div className="relative w-full md:w-96">
					<Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-black/50 dark:text-white/50" />
					<input 
						type="text" 
						placeholder="Search models..." 
						value={searchQuery}
						onChange={(e) => setSearchQuery(e.target.value)}
						className="w-full pl-10 pr-4 py-2 bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all text-on-surface"
					/>
				</div>
				<div className="flex flex-wrap gap-2">
					<div className="flex bg-black/5 dark:bg-white/5 p-1 rounded-lg">
						{(['all', 'general', 'reasoning', 'coding', 'indic'] as const).map(cat => (
							<button
								key={cat}
								onClick={() => setCategoryFilter(cat)}
								className={`px-3 py-1.5 text-xs font-medium rounded-md capitalize transition-colors ${
									categoryFilter === cat ? 'bg-white dark:bg-surface-dim shadow-sm text-on-surface font-bold' : 'text-on-surface-variant hover:text-on-surface'
								}`}
								aria-pressed={categoryFilter === cat}
							>
								{cat}
							</button>
						))}
					</div>
					<div className="flex bg-black/5 dark:bg-white/5 p-1 rounded-lg">
						{(['all', 'free', 'local', 'paid'] as const).map(cost => (
							<button
								key={cost}
								onClick={() => setCostFilter(cost)}
								className={`px-3 py-1.5 text-xs font-medium rounded-md capitalize transition-colors ${
									costFilter === cost ? 'bg-white dark:bg-surface-dim shadow-sm text-on-surface font-bold' : 'text-on-surface-variant hover:text-on-surface'
								}`}
								aria-pressed={costFilter === cost}
							>
								{cost}
							</button>
						))}
					</div>
				</div>
			</div>

			<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
				{filteredModels.map((model) => {
					const isActive = activeModelId === model.id
					const hwRec = hardwareProfile && model.hardwareTier 
						? getHardwareRecommendation(hardwareProfile)
						: null

					return (
						<div 
							key={model.id}
							className={`relative flex flex-col p-5 rounded-2xl border bg-white/5 dark:bg-surface-container-low backdrop-blur-md transition-all hover:shadow-md ${
								isActive ? 'border-primary shadow-sm ring-1 ring-primary/30' : 'border-black/10 dark:border-white/10'
							}`}
						>
							<div className="flex justify-between items-start mb-3">
								<div>
									<h3 className="font-semibold text-base leading-none tracking-tight flex items-center gap-2 text-on-surface">
										{model.name}
										{isActive && <CheckCircle2 className="w-4 h-4 text-primary" />}
									</h3>
									<p className="text-xs text-on-surface-variant mt-2 line-clamp-2 leading-relaxed">
										{formatModelDescription(model)}
									</p>
								</div>
								<span className="px-2 py-1 rounded-md bg-black/5 dark:bg-white/5 text-[10px] font-bold uppercase tracking-wider text-on-surface-variant shrink-0">
									{model.provider}
								</span>
							</div>

							<div className="flex flex-wrap gap-2 mt-auto pt-4 mb-5">
								<span className="px-2 py-1 rounded-md bg-black/5 dark:bg-white/5 text-[11px] font-medium flex items-center gap-1 text-on-surface-variant">
									<Cpu className="w-3 h-3" />
									{(model.contextWindow / 1000)}k ctx
								</span>
								<span className="px-2 py-1 rounded-md bg-black/5 dark:bg-white/5 text-[11px] font-medium flex items-center gap-1 text-on-surface-variant">
									<Zap className="w-3 h-3" />
									{model.speedTokPerSec} t/s
								</span>
								<span className={`px-2 py-1 rounded-md text-[11px] font-medium flex items-center gap-1 ${model.costTier === 'free' ? 'bg-primary/10 text-primary' : 'bg-black/5 dark:bg-white/5 text-on-surface-variant'}`}>
									<DollarSign className="w-3 h-3" />
									{model.costTier === 'free' ? 'Free' : model.costTier === 'local' ? 'Local' : 'Paid'}
								</span>
								
								{hwRec && model.costTier === 'local' && (
									<span className={`px-2 py-1 rounded-md text-[11px] font-medium flex items-center justify-center gap-1 w-full mt-1 ${
										hwRec.badgeVariant === 'destructive' ? 'bg-error/10 text-error' : 
										hwRec.badgeVariant === 'secondary' ? 'bg-amber-500/10 text-amber-500' : 
										'bg-primary/10 text-primary'
									}`}>
										{hwRec.badgeText}
									</span>
								)}
							</div>

							<Button 
								variant={isActive ? 'secondary' : 'default'}
								className="w-full text-sm font-bold"
								onClick={() => onSelectModel(model.id, model.provider)}
								disabled={isActive}
							>
								{isActive ? 'Active Model' : 'Select as Active'}
							</Button>
						</div>
					)
				})}
				
				{filteredModels.length === 0 && (
					<div className="col-span-full py-12 text-center border border-dashed border-black/10 dark:border-white/10 rounded-2xl">
						<p className="text-on-surface-variant text-sm">No models found matching your filters.</p>
					</div>
				)}
			</div>
		</div>
	)
}
