// Explicit deployment configuration only: no inherited personal-domain defaults.
export function allowedOrigins(value?: string): string[] {
  if (!value || value.length > 1000) return [];
  const items = value.split(",").map((s) => s.trim());
  if (items.length > 8) return [];
  try {
    return items.map((s) => {
      const u = new URL(s);
      if (
        u.protocol !== "https:" ||
        u.origin !== s ||
        u.username ||
        u.password ||
        /[\u0000-\u0020\u007f-\uffff*]/.test(s)
      )
        throw new Error("Invalid origin");
      return s;
    });
  } catch {
    return [];
  }
}
