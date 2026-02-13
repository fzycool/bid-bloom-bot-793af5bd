-- Drop the RESTRICTIVE policy and recreate as PERMISSIVE
DROP POLICY IF EXISTS "Users can manage their own employees" ON public.employees;

CREATE POLICY "Users can manage their own employees"
ON public.employees
FOR ALL
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- Also fix resume_versions which has the same issue
DROP POLICY IF EXISTS "Users can manage their own resume versions" ON public.resume_versions;

CREATE POLICY "Users can manage their own resume versions"
ON public.resume_versions
FOR ALL
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);