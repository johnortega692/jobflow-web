/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
  readonly VITE_COMPANY_NAME?: string;
  readonly VITE_COMPANY_ADDRESS?: string;
  readonly VITE_COMPANY_PHONE?: string;
  readonly VITE_LOGO_URL?: string;
  readonly VITE_SIGNER_NAME?: string;
  readonly VITE_SIGNER_EMAIL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
