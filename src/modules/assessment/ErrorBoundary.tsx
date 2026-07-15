// Final containment for the Assessment module — NOT a substitute for input validation. If anything
// throws during render, this shows a safe message instead of crashing the whole app. It deliberately
// does NOT log (no componentDidCatch) so no customer-derived value can leak to the console.
import { Component, type ReactNode } from "react";

interface State {
  message: string | null;
}

export class AssessmentErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { message: null };

  static getDerivedStateFromError(error: unknown): State {
    return { message: error instanceof Error ? error.message : "Unexpected error" };
  }

  render() {
    if (this.state.message !== null) {
      return (
        <div className="rounded-xl border border-red-500/40 bg-red-500/10 p-5 text-sm text-red-300">
          <div className="font-semibold text-red-200">The assessment could not be displayed.</div>
          <p className="mt-1 text-[12px]">
            Your data was processed locally and <span className="text-red-200">was not sent anywhere</span>.
            Re-check your CSV and policy inputs, then try again.
          </p>
          <p className="mt-2 text-[11px] text-red-400/80">{this.state.message}</p>
        </div>
      );
    }
    return this.props.children;
  }
}
