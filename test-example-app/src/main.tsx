import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// Only load the test sidebar and tests in development mode
if (import.meta.env.DEV) {
  // Use Vite's glob import to find all test files
  const testModules = import.meta.glob("./**/*.twd.test.ts");
  const { initTests, TWDSidebar } = await import('twd-js');
  // You need to pass the test modules, the sidebar component, and createRoot function
  initTests(testModules, <TWDSidebar open={true} position="left" />, createRoot);
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
