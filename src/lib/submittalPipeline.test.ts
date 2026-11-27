import assert from "node:assert/strict";
import test from "node:test";
import { paintPackageRevisionNumber, paintSubmittalPipelineSteps } from "./submittalPipeline.ts";

const waiting = {
  submittalOrdered: true,
  submittedForApproval: true,
  revision: false,
  approved: false,
};

function labels(steps: { label: string; badge?: string }[]): string[] {
  return steps.map((step) => (step.badge ? `${step.label} · ${step.badge}` : step.label));
}

test("submitted and waiting shows no revision step", () => {
  const steps = paintSubmittalPipelineSteps(waiting, 0);
  assert.deepEqual(labels(steps), ["Ordered", "Submitted", "Approved"]);
  assert.equal(steps.find((step) => step.current)?.id, "submitted");
  assert.equal(steps.find((step) => step.id === "approved")?.done, false);
});

test("first-pass approval never inserts a revision", () => {
  const steps = paintSubmittalPipelineSteps({ ...waiting, approved: true }, 0);
  assert.deepEqual(labels(steps), ["Ordered", "Submitted", "Approved · First pass"]);
  assert.equal(steps.find((step) => step.current), undefined);
  assert.equal(steps.at(-1)?.tone, "approved");
});

test("a return inserts Revision 1 as the current step", () => {
  const steps = paintSubmittalPipelineSteps({ ...waiting, revision: true }, 0);
  assert.deepEqual(labels(steps), ["Ordered", "Submitted", "Revision 1", "Approved"]);
  const revision = steps.find((step) => step.id === "revision-1");
  assert.equal(revision?.current, true);
  assert.equal(revision?.done, false);
  assert.equal(steps.find((step) => step.id === "submitted")?.done, true);
});

test("an approved revision stays in the chain without First pass", () => {
  const steps = paintSubmittalPipelineSteps({ ...waiting, revision: true, approved: true }, 1);
  assert.deepEqual(labels(steps), ["Ordered", "Submitted", "Revision 1", "Approved"]);
  const revision = steps.find((step) => step.id === "revision-1");
  assert.equal(revision?.done, true);
  assert.equal(revision?.tone, "revision");
  assert.equal(steps.at(-1)?.badge, undefined);
});

test("match existing replaces the pipeline until a submittal starts", () => {
  const idle = { submittalOrdered: false, submittedForApproval: false, revision: false, approved: false };
  const matched = paintSubmittalPipelineSteps({ ...idle, matchExisting: true }, 0);
  assert.deepEqual(labels(matched), ["Match Existing"]);
  assert.equal(matched[0]?.status, true);

  const both = paintSubmittalPipelineSteps({ ...waiting, matchExisting: true, noPaint: true }, 2);
  assert.deepEqual(labels(both), ["Match Existing"]);

  const underway = paintSubmittalPipelineSteps({ ...waiting, matchExisting: true }, 0);
  assert.deepEqual(labels(underway), ["Ordered", "Submitted", "Approved"]);
});

test("not needed replaces the pipeline", () => {
  const steps = paintSubmittalPipelineSteps(
    { submittalOrdered: true, submittedForApproval: false, revision: false, approved: false, noPaint: true },
    0,
  );
  assert.deepEqual(labels(steps), ["Not Needed"]);
  assert.equal(steps[0]?.tone, "skipped");
});

test("a second round keeps Revision 1 done and Revision 2 current", () => {
  const steps = paintSubmittalPipelineSteps({ ...waiting, revision: true }, 2);
  assert.deepEqual(labels(steps), ["Ordered", "Submitted", "Revision 1", "Revision 2", "Approved"]);
  assert.equal(steps.find((step) => step.id === "revision-1")?.done, true);
  assert.equal(steps.find((step) => step.id === "revision-2")?.current, true);
});

test("package revision number is the highest paint revision", () => {
  assert.equal(
    paintPackageRevisionNumber({
      paint_submittal: { revision_number: 1 },
      paint_submittal_history: [{ revision_number: 0 }, { revision_number: 2 }],
    }),
    2,
  );
  assert.equal(paintPackageRevisionNumber({ paint_submittal: { revision_number: 0 } }), 0);
});
