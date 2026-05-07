-- =====================================================
-- ImportKit v1.0.5 - Supabase Schema Setup
-- Cole este SQL no SQL Editor do Supabase Dashboard
-- =====================================================

-- Tabela de sugestões da extensão
CREATE TABLE IF NOT EXISTS public.sugestoes_extensao (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid,
  texto text NOT NULL,
  created_at timestamptz DEFAULT now(),
  votos integer DEFAULT 0
);

-- Tabela de eventos de busca Xianyu
CREATE TABLE IF NOT EXISTS public.xianyu_search_events (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid,
  query text NOT NULL,
  source_site text,
  search_page_path text,
  created_at timestamptz DEFAULT now()
);

-- Tabela de votos do roadmap
CREATE TABLE IF NOT EXISTS public.roadmap_votes (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid,
  feature_id text NOT NULL,
  created_at timestamptz DEFAULT now(),
  UNIQUE(user_id, feature_id)
);

-- Tabela de features do roadmap
CREATE TABLE IF NOT EXISTS public.roadmap_features (
  id text PRIMARY KEY,
  title text NOT NULL,
  description text,
  status text DEFAULT 'planned',
  category_id text,
  created_at timestamptz DEFAULT now()
);

-- Tabela de categorias do roadmap
CREATE TABLE IF NOT EXISTS public.roadmap_categories (
  id text PRIMARY KEY,
  name text NOT NULL,
  description text,
  created_at timestamptz DEFAULT now()
);

-- Tabela de config runtime (currency rates, quality sellers, etc)
CREATE TABLE IF NOT EXISTS public.app_runtime_config (
  key text PRIMARY KEY,
  value jsonb,
  updated_at timestamptz DEFAULT now()
);

-- View: contagem de votos por feature
CREATE OR REPLACE VIEW public.roadmap_votes_summary AS
SELECT
  feature_id,
  COUNT(*) as vote_count
FROM public.roadmap_votes
GROUP BY feature_id;

-- Enable RLS em todas as tabelas
ALTER TABLE public.sugestoes_extensao ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.xianyu_search_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.roadmap_votes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.roadmap_features ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.roadmap_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_runtime_config ENABLE ROW LEVEL SECURITY;

-- Policies de leitura pública (anon pode ler roadmap e config)
CREATE POLICY "Public read roadmap_features"
  ON public.roadmap_features FOR SELECT USING (true);
CREATE POLICY "Public read roadmap_categories"
  ON public.roadmap_categories FOR SELECT USING (true);
CREATE POLICY "Public read roadmap_votes"
  ON public.roadmap_votes FOR SELECT USING (true);
CREATE POLICY "Public read roadmap_votes_summary"
  ON public.roadmap_votes_summary FOR SELECT USING (true);
CREATE POLICY "Public read sugestoes"
  ON public.sugestoes_extensao FOR SELECT USING (true);
CREATE POLICY "Public read app_config"
  ON public.app_runtime_config FOR SELECT USING (true);

-- Policies de escrita autenticada
CREATE POLICY "Authenticated insert sugestoes"
  ON public.sugestoes_extensao FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Authenticated insert search_events"
  ON public.xianyu_search_events FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Authenticated insert votes"
  ON public.roadmap_votes FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Authenticated delete own votes"
  ON public.roadmap_votes FOR DELETE
  USING (auth.uid() = user_id);
