import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const SARVAM_API_KEY = process.env.SARVAM_API_KEY || ''
const SARVAM_API_URL = 'https://api.sarvam.ai'

export async function POST (request: NextRequest) {
	const authHeader = request.headers.get('Authorization')
	if (!authHeader) {
		return NextResponse.json({ error: 'Missing authorization header' }, { status: 401 })
	}

	const token = authHeader.replace('Bearer ', '')

	// Validate user session with Supabase
	const supabase = createClient(
		process.env.NEXT_PUBLIC_SUPABASE_URL || '',
		process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '',
		{
			auth: {
				persistSession: false,
				autoRefreshToken: false,
			},
			global: {
				headers: {
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

		const { action, text, targetLanguage, speaker, prompt } = await request.json()

		if (!action) {
			return NextResponse.json({ error: 'Missing action parameter' }, { status: 400 })
		}

		if (!SARVAM_API_KEY) {
			return NextResponse.json({ error: 'Sarvam AI API key is not configured' }, { status: 500 })
		}

		if (action === 'translate') {
			if (!text || !targetLanguage) {
				return NextResponse.json({ error: 'Missing text or targetLanguage' }, { status: 400 })
			}

			const response = await fetch(`${SARVAM_API_URL}/translate`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'api-subscription-key': SARVAM_API_KEY,
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
					'api-subscription-key': SARVAM_API_KEY,
				},
				body: JSON.stringify({
					input: text,
					target_language_code: targetLanguage,
					speaker: speaker,
					speech_sample_rate: 24000,
					enable_preprocessing: true,
				}),
			})

			if (!response.ok) {
				const errorText = await response.text()
				throw new Error(`Sarvam TTS error: ${errorText}`)
			}

			const data = await response.json()
			// Sarvam returns JSON containing base64 audio
			return NextResponse.json({ base64Audio: data.base64_audio || data.audio })
		}

		if (action === 'chat') {
			if (!prompt) {
				return NextResponse.json({ error: 'Missing prompt for AI assistant' }, { status: 400 })
			}

			const response = await fetch(`${SARVAM_API_URL}/v1/chat/completions`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'api-subscription-key': SARVAM_API_KEY,
				},
				body: JSON.stringify({
					model: 'sarvam-30b',
					messages: [
						{
							role: 'system',
							content: 'You are a helpful writing assistant. Respond in English or Indian languages as requested.',
						},
						{ role: 'user', content: prompt },
					],
				}),
			})

			if (!response.ok) {
				const errorText = await response.text()
				throw new Error(`Sarvam LLM Chat error: ${errorText}`)
			}

			const data = await response.json()
			const reply = data.choices?.[0]?.message?.content || ''
			return NextResponse.json({ text: reply })
		}

		return NextResponse.json({ error: `Invalid action: ${action}` }, { status: 400 })
	} catch (err: any) {
		console.error('[API AI Error]', err)
		return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 })
	}
}
