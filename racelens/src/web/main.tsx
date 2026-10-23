import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';

const el = document.getElementById('root');
if (!el) throw new Error('RaceLens: #root element missing');

createRoot(el).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

// Installable app: the service worker caches the built assets and the shell so
// a phone opens RaceLens instantly. Dev builds skip it so Vite's HMR stays simple.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch((err) => console.warn('RaceLens: service worker not registered', err));
  });
}
