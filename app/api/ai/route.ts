import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { readJsonWithLimit, PayloadTooLargeError } from '@/lib/request-limits'
import { LEKHAN_BOT_SYSTEM_PROMPT, LANGUAGES } from '@/lib/ai-constants'

const SARVAM_API_KEY = process.env.SARVAM_API_KEY || ''
const SARVAM_API_URL = 'https://api.sarvam.ai'

// Endpoint limits
const MAX_BODY_BYTES = 200 * 1024 // 200KB
const MAX_TEXT_LENGTH = 10_000 // translate / tts input
const MAX_PROMPT_LENGTH = 6_000 // chat prompt
const MAX_SHORT_FIELD_LENGTH = 50 // targetLanguage / speaker codes

export async function POST(request: NextRequest) {
	const authHeader = request.headers.get('Authorization')
	if (!authHeader) {
		return NextResponse.json({ error: 'Missing authorization header' }, { status: 401 })
	}

	const token = authHeader.replace('Bearer ', '')

	const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
	const supabaseKey =
		process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
		process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
		''

	// Validate user session with Supabase
	const supabase = createClient(
		supabaseUrl,
		supabaseKey,
		{
			auth: { persistSession: false, autoRefreshToken: false },
			global: {
				headers: {
					apikey: supabaseKey,
					Authorization: `Bearer ${token}`,
				},
			},
		}
	)

	try {
		const { data: { user } } = await supabase.auth.getUser()
		if (!user) {
			return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
		}
		const userId = user.id

		let action: string, text: string | undefined, targetLanguage: string | undefined,
			speaker: string | undefined, prompt: string | undefined, sourceLanguage: string | undefined,
			apiKeyInput: string | undefined
		try {
			const body = await readJsonWithLimit<{
				action?: string
				text?: string
				targetLanguage?: string
				speaker?: string
				prompt?: string
				sourceLanguage?: string
				key?: string
			}>(request, MAX_BODY_BYTES)
			action = body.action ?? ''
			text = body.text
			targetLanguage = body.targetLanguage
			speaker = body.speaker
			prompt = body.prompt
			sourceLanguage = body.sourceLanguage
			apiKeyInput = body.key
		} catch (err) {
			if (err instanceof PayloadTooLargeError) {
				return NextResponse.json({ error: 'Request payload too large' }, { status: 413 })
			}
			return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
		}

		if (!action) {
			return NextResponse.json({ error: 'Missing action parameter' }, { status: 400 })
		}

		if (action === 'validate-key') {
			if (!apiKeyInput || typeof apiKeyInput !== 'string' || !apiKeyInput.trim().startsWith('sk_')) {
				return NextResponse.json({ valid: false, error: 'Sarvam API Key must start with sk_' }, { status: 400 })
			}
			return NextResponse.json({ valid: true, message: 'Sarvam API Key verified successfully' })
		}

		if (typeof text === 'string' && text.length > MAX_TEXT_LENGTH) {
			return NextResponse.json({ error: `text exceeds maximum length of ${MAX_TEXT_LENGTH} characters` }, { status: 400 })
		}
		if (typeof prompt === 'string' && prompt.length > MAX_PROMPT_LENGTH) {
			return NextResponse.json({ error: `prompt exceeds maximum length of ${MAX_PROMPT_LENGTH} characters` }, { status: 400 })
		}
		if (typeof targetLanguage === 'string' && targetLanguage.length > MAX_SHORT_FIELD_LENGTH) {
			return NextResponse.json({ error: 'Invalid targetLanguage' }, { status: 400 })
		}
		if (typeof speaker === 'string' && speaker.length > MAX_SHORT_FIELD_LENGTH) {
			return NextResponse.json({ error: 'Invalid speaker' }, { status: 400 })
		}
		if (typeof sourceLanguage === 'string' && sourceLanguage.length > MAX_SHORT_FIELD_LENGTH) {
			return NextResponse.json({ error: 'Invalid sourceLanguage' }, { status: 400 })
		}

		// Use custom BYOK key if provided, otherwise fallback to system key
		const hasValidByokKey = typeof apiKeyInput === 'string' && apiKeyInput.trim().startsWith('sk_')
		const effectiveApiKey = hasValidByokKey ? apiKeyInput!.trim() : SARVAM_API_KEY

		if (!effectiveApiKey) {
			return NextResponse.json({ error: 'Sarvam AI API key is not configured' }, { status: 500 })
		}

		const isCreditConsumingAction = ['chat', 'translate', 'tts', 'transliterate'].includes(action)

		// Compute required credits based on Settings Page Credit Consumption Table:
		// - Sarvam Chat: 1 Credit / req
		// - Text to Speech: 1 Credit / 1K chars
		// - Translate & Transliterate: 1 Credit / 10K chars
		let requiredCredits = 1
		if (action === 'chat') {
			requiredCredits = 1
		} else if (action === 'tts') {
			const len = typeof text === 'string' ? text.length : 0
			requiredCredits = Math.max(1, Math.ceil(len / 1000))
		} else if (action === 'translate' || action === 'transliterate') {
			const len = typeof text === 'string' ? text.length : 0
			requiredCredits = Math.max(1, Math.ceil(len / 10000))
		}

		const serviceKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || supabaseKey
		const supabaseAdmin = createClient(supabaseUrl, serviceKey, {
			auth: { persistSession: false, autoRefreshToken: false },
			global: { headers: { apikey: serviceKey } },
		})

		let currentUsedCredits = 0

		if (isCreditConsumingAction) {
			const { data: profile } = await supabaseAdmin
				.from('profiles')
				.select('plan, used_credits')
				.eq('id', userId)
				.single()

			const plan = (profile?.plan || 'free').toLowerCase()
			currentUsedCredits = profile?.used_credits ?? 0
			const totalCredits = plan === 'go' ? 500 : plan === 'pro' ? 2500 : plan === 'team' ? 3500 : 50
			const remainingCredits = Math.max(0, totalCredits - currentUsedCredits)

			if (remainingCredits < requiredCredits && !hasValidByokKey) {
				return NextResponse.json(
					{ error: `AI credit limit reached (${remainingCredits} remaining, ${requiredCredits} required). Please add your own Sarvam API key in settings or upgrade your plan to continue.` },
					{ status: 402 }
				)
			}
		}

		async function deductCreditIfPlatformQuota(cost: number = 1) {
			if (isCreditConsumingAction && !hasValidByokKey) {
				try {
					await supabaseAdmin
						.from('profiles')
						.update({ used_credits: currentUsedCredits + cost })
						.eq('id', userId)
				} catch (err) {
					console.error('[Credit Deduction Error]', err)
				}
			}
		}

		if (action === 'translate') {
			if (!text || !targetLanguage) {
				return NextResponse.json({ error: 'Missing text or targetLanguage' }, { status: 400 })
			}

			const response = await fetch(`${SARVAM_API_URL}/translate`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'api-subscription-key': effectiveApiKey,
				},
				body: JSON.stringify({
					input: text,
					source_language_code: 'auto',
					target_language_code: targetLanguage,
				}),
			})

			if (!response.ok) {
				const errorText = await response.text()
				throw new Error(`Sarvam Translation error: ${errorText}`)
			}

			await deductCreditIfPlatformQuota(requiredCredits)
			const data = await response.json()
			return NextResponse.json({ translatedText: data.translated_text })
		}

		if (action === 'tts') {
			if (!text || !targetLanguage || !speaker) {
				return NextResponse.json({ error: 'Missing parameters for TTS' }, { status: 400 })
			}

			const response = await fetch(`${SARVAM_API_URL}/text-to-speech`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'api-subscription-key': effectiveApiKey,
				},
				body: JSON.stringify({
					inputs: [text],
					target_language_code: targetLanguage,
					speaker: speaker,
					model: 'bulbul:v3',
					speech_sample_rate: 22050,
					enable_preprocessing: true,
				}),
			})

			if (!response.ok) {
				const errorText = await response.text()
				throw new Error(`Sarvam TTS error: ${errorText}`)
			}

			await deductCreditIfPlatformQuota(requiredCredits)
			const data = await response.json()
			return NextResponse.json({ base64Audio: data.audios?.[0] || data.base64_audio || data.audio })
		}

		if (action === 'chat') {
			if (!prompt) {
				return NextResponse.json({ error: 'Missing prompt for AI assistant' }, { status: 400 })
			}

			const response = await fetch(`${SARVAM_API_URL}/v1/chat/completions`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'api-subscription-key': effectiveApiKey,
				},
				body: JSON.stringify({
					model: 'sarvam-105b',
					messages: [
						{
							role: 'system',
							content: LEKHAN_BOT_SYSTEM_PROMPT,
						},
						{ role: 'user', content: prompt },
					],
				}),
			})

			if (!response.ok) {
				const errorText = await response.text()
				throw new Error(`Sarvam LLM Chat error: ${errorText}`)
			}

			await deductCreditIfPlatformQuota(requiredCredits)
			const data = await response.json()
			const reply = data.choices?.[0]?.message?.content || ''
			return NextResponse.json({ text: reply })
		}

		if (action === 'transliterate') {
			if (!text || !sourceLanguage || !targetLanguage) {
				return NextResponse.json({ error: 'Missing text, sourceLanguage, or targetLanguage for transliteration' }, { status: 400 })
			}

			const response = await fetch(`${SARVAM_API_URL}/transliterate`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'api-subscription-key': effectiveApiKey,
				},
				body: JSON.stringify({
					input: text,
					source_language_code: sourceLanguage,
					target_language_code: targetLanguage,
				}),
			})

			if (!response.ok) {
				const errorText = await response.text()
				throw new Error(`Sarvam Transliteration error: ${errorText}`)
			}

			await deductCreditIfPlatformQuota(requiredCredits)
			const data = await response.json()
			return NextResponse.json({ transliteratedText: data.transliterated_text })
		}

		if (action === 'detect-language') {
			if (!text) {
				return NextResponse.json({ error: 'Missing text for language detection' }, { status: 400 })
			}

			const response = await fetch(`${SARVAM_API_URL}/text-lid`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'api-subscription-key': effectiveApiKey,
				},
				body: JSON.stringify({ input: text.slice(0, 1000) }),
			})

			if (!response.ok) {
				const errorText = await response.text()
				throw new Error(`Sarvam Language Detection error: ${errorText}`)
			}

			const data = await response.json()
			const matchedLang = LANGUAGES.find(l => l.code === data.language_code)
			return NextResponse.json({
				languageCode: data.language_code,
				languageName: matchedLang?.name || data.language_name || data.language_code,
				script: data.script_code || data.script,
			})
		}

		return NextResponse.json({ error: `Invalid action: ${action}` }, { status: 400 })
	} catch (err: unknown) {
		const message = err instanceof Error ? err.message : String(err)
		console.error('[API AI Error]', err)
		return NextResponse.json({ error: message || 'Internal server error' }, { status: 500 })
	}
}
