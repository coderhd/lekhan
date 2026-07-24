export interface Language {
	code: string
	name: string
	script: string
}

export interface Speaker {
	id: string
	name: string
	tone: string
}

export interface LekhanBotAction {
	id: string
	label: string
	icon: string
	requiresSelection: boolean
	defaultInsert: 'accept' | 'below' | 'both'
	buildPrompt: (text: string) => string
}

export interface AIPreferences {
	targetLanguage: string
	ttsLanguage: string
	ttsVoice: string
}

export const LANGUAGES: Language[] = [
	{ code: 'en-IN', name: 'English (India)', script: 'Latin' },
	{ code: 'hi-IN', name: 'Hindi', script: 'Devanagari' },
	{ code: 'bn-IN', name: 'Bengali', script: 'Bengali' },
	{ code: 'ta-IN', name: 'Tamil', script: 'Tamil' },
	{ code: 'te-IN', name: 'Telugu', script: 'Telugu' },
	{ code: 'gu-IN', name: 'Gujarati', script: 'Gujarati' },
	{ code: 'kn-IN', name: 'Kannada', script: 'Kannada' },
	{ code: 'ml-IN', name: 'Malayalam', script: 'Malayalam' },
	{ code: 'mr-IN', name: 'Marathi', script: 'Devanagari' },
	{ code: 'pa-IN', name: 'Punjabi', script: 'Gurmukhi' },
	{ code: 'od-IN', name: 'Odia', script: 'Odia' },
	{ code: 'as-IN', name: 'Assamese', script: 'Bengali' },
	{ code: 'ur-IN', name: 'Urdu', script: 'Perso-Arabic' },
	{ code: 'ne-IN', name: 'Nepali', script: 'Devanagari' },
	{ code: 'kok-IN', name: 'Konkani', script: 'Devanagari' },
	{ code: 'ks-IN', name: 'Kashmiri', script: 'Perso-Arabic' },
	{ code: 'sd-IN', name: 'Sindhi', script: 'Perso-Arabic' },
	{ code: 'sa-IN', name: 'Sanskrit', script: 'Devanagari' },
	{ code: 'sat-IN', name: 'Santali', script: 'Ol Chiki' },
	{ code: 'mni-IN', name: 'Manipuri', script: 'Meitei' },
	{ code: 'brx-IN', name: 'Bodo', script: 'Devanagari' },
	{ code: 'mai-IN', name: 'Maithili', script: 'Devanagari' },
	{ code: 'doi-IN', name: 'Dogri', script: 'Devanagari' },
]

export const TTS_LANGUAGES: Language[] = LANGUAGES.filter(l =>
	['en-IN', 'hi-IN', 'bn-IN', 'ta-IN', 'te-IN', 'gu-IN', 'kn-IN', 'ml-IN', 'mr-IN', 'pa-IN', 'od-IN'].includes(l.code)
)

export const SPEAKERS: Speaker[] = [
	{ id: 'priya', name: 'Priya', tone: 'Warm, friendly (default)' },
	{ id: 'aditya', name: 'Aditya', tone: 'Professional, news-anchor' },
	{ id: 'ritu', name: 'Ritu', tone: 'Calm, professional' },
	{ id: 'neha', name: 'Neha', tone: 'Warm, conversational' },
	{ id: 'rahul', name: 'Rahul', tone: 'Professional, conversational' },
	{ id: 'pooja', name: 'Pooja', tone: 'Warm, friendly' },
	{ id: 'kavya', name: 'Kavya', tone: 'Calm, professional' },
	{ id: 'kabir', name: 'Kabir', tone: 'Professional, warm' },
	{ id: 'anand', name: 'Anand', tone: 'Mature, professional' },
	{ id: 'vijay', name: 'Vijay', tone: 'Mature, authoritative' },
	{ id: 'shreya', name: 'Shreya', tone: 'Calm, narration' },
	{ id: 'gokul', name: 'Gokul', tone: 'Mature, narration' },
	{ id: 'tanya', name: 'Tanya', tone: 'Young, energetic' },
	{ id: 'suhani', name: 'Suhani', tone: 'Young, energetic' },
	{ id: 'niharika', name: 'Niharika', tone: 'Young, energetic' },
	{ id: 'ashutosh', name: 'Ashutosh', tone: '' },
	{ id: 'rohan', name: 'Rohan', tone: '' },
	{ id: 'simran', name: 'Simran', tone: '' },
	{ id: 'amit', name: 'Amit', tone: '' },
	{ id: 'dev', name: 'Dev', tone: '' },
	{ id: 'ishita', name: 'Ishita', tone: '' },
	{ id: 'ratan', name: 'Ratan', tone: '' },
	{ id: 'varun', name: 'Varun', tone: '' },
	{ id: 'manan', name: 'Manan', tone: '' },
	{ id: 'sumit', name: 'Sumit', tone: '' },
	{ id: 'roopa', name: 'Roopa', tone: '' },
	{ id: 'aayan', name: 'Aayan', tone: '' },
	{ id: 'shubh', name: 'Shubh', tone: '' },
	{ id: 'advait', name: 'Advait', tone: '' },
	{ id: 'tarun', name: 'Tarun', tone: '' },
	{ id: 'sunny', name: 'Sunny', tone: '' },
	{ id: 'mani', name: 'Mani', tone: '' },
	{ id: 'mohit', name: 'Mohit', tone: '' },
	{ id: 'kavitha', name: 'Kavitha', tone: '' },
	{ id: 'rehan', name: 'Rehan', tone: '' },
	{ id: 'soham', name: 'Soham', tone: '' },
	{ id: 'rupali', name: 'Rupali', tone: '' },
]

/** Quick-action presets shown above the prompt bar */
export const LEKHAN_BOT_ACTIONS: LekhanBotAction[] = [
	{
		id: 'fix-grammar',
		label: 'Fix Grammar',
		icon: 'spellcheck',
		requiresSelection: true,
		defaultInsert: 'accept',
		buildPrompt: (text) => `Fix spelling and grammar in this text. Return only the corrected text:\n\n"${text}"`,
	},
	{
		id: 'improve-flow',
		label: 'Rewrite',
		icon: 'edit_note',
		requiresSelection: true,
		defaultInsert: 'accept',
		buildPrompt: (text) => `Improve the writing style and flow of this text. Return only the improved text:\n\n"${text}"`,
	},
	{
		id: 'summarize',
		label: 'Summarize',
		icon: 'summarize',
		requiresSelection: true,
		defaultInsert: 'below',
		buildPrompt: (text) => `Summarize the following text concisely:\n\n"${text}"`,
	},
	{
		id: 'expand',
		label: 'Expand',
		icon: 'expand',
		requiresSelection: true,
		defaultInsert: 'below',
		buildPrompt: (text) => `Expand this text with more details and depth:\n\n"${text}"`,
	},
	{
		id: 'make-shorter',
		label: 'Make Shorter',
		icon: 'compress',
		requiresSelection: true,
		defaultInsert: 'accept',
		buildPrompt: (text) => `Make this text shorter and more concise while preserving the meaning:\n\n"${text}"`,
	},
]

export const LEKHAN_BOT_SYSTEM_PROMPT =
	'You are Lekhan Bot, a helpful Indian writing assistant built into Lekhan, a document editor for Indian languages. ' +
	'You support 23 Indian languages and scripts. Respond concisely. ' +
	'When asked to fix, rewrite, or transform text, return only the result — no explanations unless asked.'

const AI_PREFS_KEY = 'lekhan-ai-preferences'

const DEFAULT_PREFS: AIPreferences = {
	targetLanguage: 'hi-IN',
	ttsLanguage: 'hi-IN',
	ttsVoice: 'priya',
}

export function loadAIPreferences(): AIPreferences {
	if (typeof window === 'undefined') return DEFAULT_PREFS
	try {
		const stored = localStorage.getItem(AI_PREFS_KEY)
		if (stored) return { ...DEFAULT_PREFS, ...JSON.parse(stored) }
	} catch { /* ignore */ }
	return DEFAULT_PREFS
}

export function saveAIPreferences(prefs: Partial<AIPreferences>): void {
	if (typeof window === 'undefined') return
	const current = loadAIPreferences()
	localStorage.setItem(AI_PREFS_KEY, JSON.stringify({ ...current, ...prefs }))
}
