// S5 · Test support: the schedule request is not the intake request.
//
// WHY THIS EXISTS. Most suites build ONE body and post it to both `/pilot/datasets` and
// `/pilot/assessments`. That was fine while the two shapes overlapped, and it stopped being fine when
// `declaredVersion` was removed from scheduling: it is REQUIRED at the intake, where it is the
// customer's own declaration about their export and is persisted as made, and it does not exist on the
// scheduling body, whose `additionalProperties: false` under `removeAdditional: false` (`app.ts`) makes
// sending it a 400 rather than a silent strip.
//
// So the divergence is named once, here, instead of eight bodies being duplicated. This is deliberately
// SUBTRACTIVE and deliberately narrow: it removes exactly the one field scheduling cannot express, so a
// suite that starts sending some other unknown field still gets the 400 it should get.
//
// NOT A PRODUCTION HELPER. Nothing in `server/services` or `src/` imports it: the real clients build the
// two requests separately, because they are two requests.
export function scheduleRequestFrom<T extends object>(intakeBody: T): Omit<T, "declaredVersion"> {
  const rest: Record<string, unknown> = { ...intakeBody };
  delete rest.declaredVersion;
  return rest as Omit<T, "declaredVersion">;
}
