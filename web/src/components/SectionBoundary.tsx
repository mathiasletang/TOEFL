import { Component, Fragment, type ErrorInfo, type ReactNode } from "react";
import { IconAlert } from "./icons";

interface Props {
  /** Shown in the error card, e.g. "Today's session". */
  name: string;
  /** Called by Retry; the section is rendered again once it has finished (e.g. its data reloaded). */
  onRetry?: () => void | Promise<unknown>;
  children: ReactNode;
}
interface State {
  error: Error | null;
  attempt: number;
  retrying: boolean;
}

/** Keeps one broken section from blanking the whole page: shows what failed and a Retry button. */
export class SectionBoundary extends Component<Props, State> {
  override state: State = { error: null, attempt: 0, retrying: false };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[${this.props.name}]`, error, info.componentStack);
  }

  retry = async () => {
    this.setState({ retrying: true });
    try {
      await this.props.onRetry?.();
    } finally {
      this.setState((s) => ({ error: null, retrying: false, attempt: s.attempt + 1 }));
    }
  };

  override render() {
    const { error, attempt, retrying } = this.state;
    if (error)
      return (
        <section className="card p-6" role="alert" aria-label={`${this.props.name}: error`}>
          <div className="flex items-center gap-2 text-sm font-extrabold text-bad">
            <IconAlert size={16} /> {this.props.name} could not be displayed
          </div>
          <p className="mt-1 break-words text-xs text-dim">{error.message || String(error)}</p>
          <button className="btn mt-4" onClick={() => void this.retry()} disabled={retrying}>
            {retrying ? "Retrying…" : "Retry"}
          </button>
        </section>
      );
    return <Fragment key={attempt}>{this.props.children}</Fragment>;
  }
}
