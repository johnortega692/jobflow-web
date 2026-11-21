-- Free plan allows one file up to 50 MB. Receipts and rental photos were
-- capped at 2 MB, and the PDF folders at 25 MB. Raise those folders to the
-- plan maximum. Folders with no extra cap already follow that 50 MB limit.
-- This does not change the shared 1 GB storage quota.

update storage.buckets
set file_size_limit = 52428800
where id in (
  'field-tools-receipts',
  'rental-calloff-photos',
  'extra-work-tag-pdfs',
  'safety-record-pdfs'
);
