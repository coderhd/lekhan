-- Create tables
CREATE TABLE public.profiles (
	id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
	email TEXT UNIQUE NOT NULL,
	full_name TEXT,
	avatar_url TEXT,
	created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE public.documents (
	id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
	title TEXT DEFAULT 'Untitled Document' NOT NULL,
	owner_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
	searchable_text TEXT DEFAULT '',
	is_public BOOLEAN DEFAULT false NOT NULL,
	created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
	updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TYPE member_role AS ENUM ('owner', 'editor', 'viewer');

CREATE TABLE public.document_members (
	id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
	document_id UUID NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
	user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
	role member_role NOT NULL,
	created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
	UNIQUE (document_id, user_id)
);

CREATE TYPE invitation_status AS ENUM ('pending', 'accepted', 'declined');

CREATE TABLE public.document_invitations (
	id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
	document_id UUID NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
	inviter_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
	invitee_email TEXT NOT NULL,
	role member_role NOT NULL,
	token UUID NOT NULL DEFAULT gen_random_uuid(),
	status invitation_status DEFAULT 'pending' NOT NULL,
	created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE public.document_versions (
	id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
	document_id UUID NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
	version_name TEXT NOT NULL,
	created_by UUID NOT NULL REFERENCES public.profiles(id),
	created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Trigger to automatically create profile on sign up
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
	INSERT INTO public.profiles (id, email, full_name, avatar_url)
	VALUES (
		new.id,
		new.email,
		new.raw_user_meta_data->>'full_name',
		new.raw_user_meta_data->>'avatar_url'
	);
	RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE TRIGGER on_auth_user_created
	AFTER INSERT ON auth.users
	FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Enable Row Level Security
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_versions ENABLE ROW LEVEL SECURITY;

-- 1. Profiles Policies
CREATE POLICY select_profiles ON public.profiles
	FOR SELECT TO authenticated USING (true);

CREATE POLICY update_profiles ON public.profiles
	FOR UPDATE TO authenticated USING (id = auth.uid());

-- 2. Documents Policies
CREATE POLICY select_documents ON public.documents
	FOR SELECT USING (
		owner_id = auth.uid() OR
		is_public = true OR
		EXISTS (
			SELECT 1 FROM public.document_members 
			WHERE document_members.document_id = public.documents.id AND document_members.user_id = auth.uid()
		)
	);

CREATE POLICY insert_documents ON public.documents
	FOR INSERT WITH CHECK (
		auth.uid() = owner_id
	);

CREATE POLICY update_documents ON public.documents
	FOR UPDATE USING (
		owner_id = auth.uid() OR
		EXISTS (
			SELECT 1 FROM public.document_members 
			WHERE document_members.document_id = public.documents.id AND document_members.user_id = auth.uid() AND document_members.role = 'editor'
		)
	);

CREATE POLICY delete_documents ON public.documents
	FOR DELETE USING (
		owner_id = auth.uid()
	);

-- 3. Document Members Policies
CREATE POLICY select_members ON public.document_members
	FOR SELECT USING (
		user_id = auth.uid() OR
		EXISTS (
			SELECT 1 FROM public.documents 
			WHERE documents.id = public.document_members.document_id AND documents.owner_id = auth.uid()
		) OR
		EXISTS (
			SELECT 1 FROM public.document_members as m
			WHERE m.document_id = public.document_members.document_id AND m.user_id = auth.uid()
		)
	);

CREATE POLICY modify_members ON public.document_members
	FOR ALL USING (
		EXISTS (
			SELECT 1 FROM public.documents 
			WHERE documents.id = public.document_members.document_id AND documents.owner_id = auth.uid()
		)
	);

-- 4. Document Invitations Policies
CREATE POLICY select_invitations ON public.document_invitations
	FOR SELECT USING (
		inviter_id = auth.uid() OR
		invitee_email = (SELECT email FROM public.profiles WHERE id = auth.uid())
	);

CREATE POLICY modify_invitations ON public.document_invitations
	FOR ALL USING (
		inviter_id = auth.uid() OR
		EXISTS (
			SELECT 1 FROM public.documents 
			WHERE documents.id = public.document_invitations.document_id AND documents.owner_id = auth.uid()
		)
	);

-- 5. Document Versions Policies
CREATE POLICY select_versions ON public.document_versions
	FOR SELECT USING (
		EXISTS (
			SELECT 1 FROM public.documents 
			WHERE documents.id = public.document_versions.document_id AND (
				documents.owner_id = auth.uid() OR documents.is_public = true OR EXISTS (
					SELECT 1 FROM public.document_members 
					WHERE document_members.document_id = documents.id AND document_members.user_id = auth.uid()
				)
			)
		)
	);

CREATE POLICY insert_versions ON public.document_versions
	FOR INSERT WITH CHECK (
		EXISTS (
			SELECT 1 FROM public.documents 
			WHERE documents.id = public.document_versions.document_id AND (
				documents.owner_id = auth.uid() OR EXISTS (
					SELECT 1 FROM public.document_members 
					WHERE document_members.document_id = documents.id AND document_members.user_id = auth.uid() AND document_members.role = 'editor'
				)
			)
		)
	);

CREATE POLICY delete_versions ON public.document_versions
	FOR DELETE USING (
		EXISTS (
			SELECT 1 FROM public.documents 
			WHERE documents.id = public.document_versions.document_id AND documents.owner_id = auth.uid()
		)
	);
