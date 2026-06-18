import { useCallback, useEffect, useState } from "react";
import { supabase } from "./supabase";
import type { Json } from "../types/database";
import { parseProjectTradeData, type ProjectTradeData } from "../types/tradeDocuments";

export function useProjectTradeData(projectId: string) {
  const [tradeData, setTradeData] = useState<ProjectTradeData>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error: err } = await supabase
      .from("projects")
      .select("data")
      .eq("id", projectId)
      .single();
    setLoading(false);
    if (err) {
      setError(err.message);
      return;
    }
    setTradeData(parseProjectTradeData(data?.data));
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = useCallback(
    async (next: ProjectTradeData) => {
      setSaving(true);
      setError(null);
      const { error: err } = await supabase
        .from("projects")
        .update({ data: next as unknown as Json })
        .eq("id", projectId);
      setSaving(false);
      if (err) {
        setError(err.message);
        return false;
      }
      setTradeData(next);
      return true;
    },
    [projectId],
  );

  return { tradeData, setTradeData, loading, saving, error, setError, load, save };
}
