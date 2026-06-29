// Simple auth check: user is considered logged in when loginCredentials exists in localStorage.
export function useAuth() {
  try {
    const data = localStorage.getItem('loginCredentials');
    if (!data) return false;
    const parsed = JSON.parse(data);
    return !!(parsed && parsed.accessToken);
  } catch {
    return false;
  }
}
