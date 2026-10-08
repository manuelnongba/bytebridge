export function invitationFrom(values: string[]): string | null {
  for (const value of values) {
    try {
      const url = new URL(value);
      if (
        url.protocol === 'myapp:' &&
        url.hostname === 'join' &&
        /^[-\w]{1,128}$/.test(url.searchParams.get('room') || '')
      )
        return url.href;
    } catch {
      /* Command-line arguments need not be URLs. */
    }
  }
  return null;
}
