export type BrepBuildAcceptance = {
  accepted: boolean;
};

/**
 * Return true only when the just-completed model step produced at least one
 * canonical-accepted native BRep build. A mere tool call is intentionally not
 * sufficient: rejected builds must remain eligible for another model step.
 */
export function shouldStopAfterAcceptedBrepBuild(
  attemptsByStep: ReadonlyMap<number, readonly BrepBuildAcceptance[]>,
  completedStepCount: number,
): boolean {
  if (!Number.isInteger(completedStepCount) || completedStepCount <= 0) {
    return false;
  }

  const completedStepNumber = completedStepCount - 1;
  return (
    attemptsByStep
      .get(completedStepNumber)
      ?.some((attempt) => attempt.accepted) ?? false
  );
}
