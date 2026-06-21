import { useState } from "react";
import { requestRfiAssist } from "../../lib/rfiAssist";

type Props = {
  projectName: string;
  subject: string;
  question: string;
  solutionText: string;
  onApply: (question: string, solutionText?: string) => void;
  onClose: () => void;
};

export function RfiAiAssistModal({
  projectName,
  subject,
  question,
  solutionText,
  onApply,
  onClose,
}: Props) {
  const hasExistingSolution = Boolean(solutionText.trim());
  const [generateSolution, setGenerateSolution] = useState(hasExistingSolution);
  const [aiQuestion, setAiQuestion] = useState("");
  const [aiSolution, setAiSolution] = useState("");
  const [status, setStatus] = useState("Click Generate to refine your text with AI.");
  const [statusOk, setStatusOk] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [hasResult, setHasResult] = useState(false);

  const showSolution = generateSolution || hasExistingSolution;

  async function onGenerate() {
    setGenerating(true);
    setHasResult(false);
    setStatusOk(false);
    setAiQuestion("");
    setAiSolution("");
    setStatus("Sending to Claude…");

    try {
      const result = await requestRfiAssist({
        project_name: projectName,
        subject,
        question,
        solution_text: solutionText,
        generate_solution: generateSolution || hasExistingSolution,
      });
      setAiQuestion(result.question);
      setAiSolution(result.solution_text ?? "");
      setHasResult(true);
      setStatusOk(true);
      setStatus("Review the AI text, edit if needed, then click Apply to Form.");
    } catch (e) {
      setStatusOk(false);
      setStatus(e instanceof Error ? e.message : "AI assist failed");
    } finally {
      setGenerating(false);
    }
  }

  function onApplyToForm() {
    const req = aiQuestion.trim();
    const sol = aiSolution.trim();
    if (!req && !sol) {
      setStatusOk(false);
      setStatus("Generate AI text first.");
      return;
    }
    onApply(req, sol || undefined);
    setStatusOk(true);
    setStatus("Applied to form.");
  }

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="modal card stack rfi-ai-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-labelledby="rfi-ai-title"
      >
        <div className="row-between wrap rfi-ai-header">
          <div>
            <h3 id="rfi-ai-title">✦ AI Assist</h3>
            <p className="muted small">
              Project: {projectName || "—"} | Subject: {subject || "—"}
            </p>
          </div>
          {!hasExistingSolution && (
            <label className="check">
              <input
                type="checkbox"
                checked={generateSolution}
                onChange={(e) => setGenerateSolution(e.target.checked)}
              />
              Also generate Proposed Solution
            </label>
          )}
        </div>

        <div className="rfi-ai-col-labels">
          <span className="muted small">ORIGINAL (current form text)</span>
          <span className="small rfi-ai-accent-label">AI GENERATED (editable before applying)</span>
        </div>

        <div className="rfi-ai-columns">
          <div className="stack">
            <strong className="small">THE REQUEST</strong>
            <textarea rows={8} readOnly className="rfi-ai-readonly" value={question} />
          </div>
          <div className="stack">
            <strong className="small">THE REQUEST</strong>
            <textarea
              rows={8}
              value={aiQuestion}
              onChange={(e) => setAiQuestion(e.target.value)}
              placeholder="AI-generated request will appear here…"
            />
          </div>
        </div>

        {showSolution && (
          <div className="rfi-ai-columns">
            <div className="stack">
              <strong className="small">PROPOSED SOLUTION</strong>
              <textarea rows={5} readOnly className="rfi-ai-readonly" value={solutionText} />
            </div>
            <div className="stack">
              <strong className="small">PROPOSED SOLUTION</strong>
              <textarea
                rows={5}
                value={aiSolution}
                onChange={(e) => setAiSolution(e.target.value)}
                placeholder="AI-generated solution will appear here…"
              />
            </div>
          </div>
        )}

        <p className={`small ${statusOk ? "text-ok" : "muted"}`}>{status}</p>

        <div className="row-between wrap">
          <button
            type="button"
            className="btn btn-secondary"
            disabled={generating}
            onClick={() => void onGenerate()}
          >
            {generating ? "Generating…" : hasResult ? "Regenerate" : "Generate"}
          </button>
          <div className="row-gap">
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              Close
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={!hasResult || generating}
              onClick={onApplyToForm}
            >
              Apply to Form
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
