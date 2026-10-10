// Normalise Nigerian phone numbers to E.164 (+234XXXXXXXXXX).
export function normalizePhone(input) {
  const digits = String(input ?? '').replace(/[^\d+]/g, '');
  let d = digits.replace(/^\+/, '');
  if (d.startsWith('234') && d.length === 13) return `+${d}`;
  if (d.startsWith('0') && d.length === 11) return `+234${d.slice(1)}`;
  if (d.length === 10 && /^[789]/.test(d)) return `+234${d}`;
  if (digits.startsWith('+') && d.length >= 10 && d.length <= 15) return `+${d}`;
  return null;
}

export function maskPhone(phone) {
  if (!phone) return '';
  return phone.slice(0, 7) + '****' + phone.slice(-2);
}
