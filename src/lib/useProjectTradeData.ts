import { useCallback, useEffect, useState } from "react";
import { commitProjectUpdate, inferTradeDataActivity, type ProjectActivityAction } from "./projectActivity";
import { supabase } from "./supabase";
import { parseProjectTradeData, type ProjectTradeData } from "../types/tradeDocuments";

export type TradeDataSaveActivity = {
  action: ProjectActivityAction;
  summary: string;
};

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
    async (next: ProjectTradeData, activityOverride?: TradeDataSaveActivity) => {
      setSaving(true);
      setError(null);
      const activity = activityOverride ?? inferTradeDataActivity(tradeData, next);
      const err = await commitProjectUpdate({
        projectId,
        mergeData: next as Record<string, unknown>,
        activity,
      });
      setSaving(false);
      if (err) {
        setError(err);
        return false;
      }
      setTradeData(next);
      return true;
    },
    [projectId, tradeData],
  );

  return { tradeData, setTradeData, loading, saving, error, setError, load, save };
}
