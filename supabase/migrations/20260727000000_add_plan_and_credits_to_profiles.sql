-- Migration: Add plan and used_credits columns to public.profiles table
-- Run this migration in your Supabase Dashboard SQL Editor or via Supabase CLI

ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS plan TEXT DEFAULT 'free' NOT NULL,
ADD COLUMN IF NOT EXISTS used_credits INTEGER DEFAULT 0 NOT NULL;

-- Update handle_new_user trigger function to include plan and used_credits defaults
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
	INSERT INTO public.profiles (id, email, full_name, avatar_url, plan, used_credits)
	VALUES (
		new.id,
		new.email,
		new.raw_user_meta_data->>'full_name',
		new.raw_user_meta_data->>'avatar_url',
		'free',
		0
	)
	ON CONFLICT (id) DO UPDATE
	SET email = EXCLUDED.email,
	    full_name = COALESCE(EXCLUDED.full_name, profiles.full_name),
	    avatar_url = COALESCE(EXCLUDED.avatar_url, profiles.avatar_url);
	RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
