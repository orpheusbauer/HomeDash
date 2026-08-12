import { Component, type ErrorInfo, type ReactNode } from 'react';
import { TriangleAlert } from 'lucide-react';

export class WidgetErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Widget isolated after a rendering error', error, info);
  }

  override render(): ReactNode {
    if (this.state.failed) {
      return (
        <div className="widget-error">
          <TriangleAlert size={26} />
          <strong>Ce widget a rencontré un problème.</strong>
          <button className="button button--ghost" onClick={() => this.setState({ failed: false })}>
            Réessayer
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
