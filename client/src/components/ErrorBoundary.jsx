import React from 'react';

export default class ErrorBoundary extends React.Component {
  constructor(p) {
    super(p);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidCatch(error, info) {
    console.error('QMS ErrorBoundary:', error, info);
  }
  render() {
    if (this.state.error) {
      const e = this.state.error;
      return (
        <div style={{ padding: 40, fontFamily: 'monospace', color: '#dc2626' }}>
          <h2>Render Error</h2>
          <pre style={{ whiteSpace: 'pre-wrap', background: '#fff', padding: 16, borderRadius: 8, border: '1px solid #fecaca' }}>
            {String(e && e.stack ? e.stack : e)}
          </pre>
          <button onClick={() => location.reload()} style={{ marginTop: 12, padding: '8px 16px', cursor: 'pointer' }}>Reload</button>
        </div>
      );
    }
    return this.props.children;
  }
}
