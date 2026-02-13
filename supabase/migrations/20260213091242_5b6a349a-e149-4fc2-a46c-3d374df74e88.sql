
-- Add approval status to profiles
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS is_approved boolean NOT NULL DEFAULT false;

-- Update existing admin user to be approved
UPDATE public.profiles SET is_approved = true WHERE user_id IN (
  SELECT user_id FROM public.user_roles WHERE role = 'admin'
);

-- Allow admins to update any profile (for approval)
CREATE POLICY "Admins can update all profiles"
ON public.profiles
FOR UPDATE
USING (has_role(auth.uid(), 'admin'::app_role));
