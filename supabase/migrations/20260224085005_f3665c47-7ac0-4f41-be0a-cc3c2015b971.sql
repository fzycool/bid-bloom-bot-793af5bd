
-- Create storage bucket for proposal material files
INSERT INTO storage.buckets (id, name, public) VALUES ('proposal-materials', 'proposal-materials', false);

-- Users can upload files to their own folder
CREATE POLICY "Users can upload material files"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'proposal-materials' AND auth.uid()::text = (storage.foldername(name))[1]);

-- Users can view their own files
CREATE POLICY "Users can view own material files"
ON storage.objects FOR SELECT
USING (bucket_id = 'proposal-materials' AND auth.uid()::text = (storage.foldername(name))[1]);

-- Users can delete their own files
CREATE POLICY "Users can delete own material files"
ON storage.objects FOR DELETE
USING (bucket_id = 'proposal-materials' AND auth.uid()::text = (storage.foldername(name))[1]);
