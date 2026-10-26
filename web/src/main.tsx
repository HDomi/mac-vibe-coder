import React from 'react';
import { createRoot } from 'react-dom/client';
import 'highlight.js/styles/github-dark.css';
import './index.css';

const root = createRoot(document.getElementById('root')!);
// Lock screen covers load this page with ?lock=main|sub. They must not import the app: its modules open
// the agent socket on import, and a cover only needs the clock, the session counts and the password field.
const lock = new URLSearchParams(location.search).get('lock');
if (lock === 'main' || lock === 'sub') {
  void import('./components/lock/LockScreen').then(({ default: LockScreen }) => root.render(<LockScreen />));
} else {
  void import('./App').then(({ default: App }) => root.render(<React.StrictMode><App /></React.StrictMode>));
}
