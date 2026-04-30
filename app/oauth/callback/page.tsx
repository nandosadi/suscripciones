'use client';

import { useEffect } from 'react';

export default function OAuthCallback() {
  useEffect(() => {
    try {
      const hash = window.location.hash.slice(1);
      const params = new URLSearchParams(hash);
      const token = params.get('access_token');
      if (token && window.opener) {
        window.opener.postMessage(
          { type: 'google-token', token },
          window.location.origin
        );
      }
    } catch {}
    window.close();
  }, []);

  return (
    <div
      style={{
        background: '#1A1410',
        height: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: 'monospace',
        fontSize: 13,
        letterSpacing: '0.05em',
        color: 'rgba(248,245,243,0.4)',
      }}
    >
      Conectando…
    </div>
  );
}
