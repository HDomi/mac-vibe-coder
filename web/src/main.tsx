import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';

// Under Electron the window has macOS vibrancy; index.css clears the page background so it shows through.
if (window.vibe?.isElectron) document.documentElement.classList.add('electron');

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
