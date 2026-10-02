import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
// Catch the browser's install event before React mounts (it can fire very early).
import './pwa/installEvent';
import './styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('Root element missing');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
