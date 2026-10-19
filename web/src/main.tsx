import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import 'highlight.js/styles/github-dark.css';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
