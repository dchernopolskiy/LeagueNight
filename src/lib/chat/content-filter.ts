// Basic content moderation - checks for obvious spam patterns
export function checkMessageContent(body: string): { ok: boolean; reason?: string } {
  const trimmed = body.trim();

  // Empty check
  if (!trimmed) return { ok: false, reason: "Message is empty" };

  // Spam patterns: excessive caps, repeated characters, too many links
  const capsRatio = (trimmed.match(/[A-Z]/g)?.length || 0) / trimmed.length;
  if (trimmed.length > 20 && capsRatio > 0.8) {
    return { ok: false, reason: "Please don't type in all caps" };
  }

  // Repeated character spam (e.g., "aaaaaaaaaa")
  if (/(.)\1{9,}/.test(trimmed)) {
    return { ok: false, reason: "Message contains repeated characters" };
  }

  // Too many URLs (likely spam)
  const urlCount = (trimmed.match(/https?:\/\//g) || []).length;
  if (urlCount > 3) {
    return { ok: false, reason: "Too many links in one message" };
  }

  return { ok: true };
}
