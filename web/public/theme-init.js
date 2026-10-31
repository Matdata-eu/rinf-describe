// Apply a forced light/dark theme before first paint (see src/theme.ts). A file of its own
// rather than an inline script, so the Content-Security-Policy can allow only scripts from
// this site (nginx.conf).
try { var t = localStorage.getItem('describe-theme'); if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t); } catch (e) {}
