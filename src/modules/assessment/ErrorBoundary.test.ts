import { describe, it, expect } from "vitest";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AssessmentErrorBoundary } from "./ErrorBoundary";

describe("AssessmentErrorBoundary", () => {
  it("captures the error message via getDerivedStateFromError", () => {
    expect(AssessmentErrorBoundary.getDerivedStateFromError(new Error("boom"))).toEqual({ message: "boom" });
  });

  it("renders a safe fallback when an error has been captured", () => {
    const b = new AssessmentErrorBoundary({ children: null });
    b.state = AssessmentErrorBoundary.getDerivedStateFromError(new Error("boom"));
    const html = renderToStaticMarkup(b.render() as ReactElement);
    expect(html).toContain("could not be displayed");
    expect(html).toContain("was not sent anywhere"); // privacy reassurance in the fallback
    expect(html).toContain("boom");
  });

  it("renders children when there is no error", () => {
    const b = new AssessmentErrorBoundary({ children: createElement("span", null, "child-ok") });
    const html = renderToStaticMarkup(b.render() as ReactElement);
    expect(html).toContain("child-ok");
  });
});
