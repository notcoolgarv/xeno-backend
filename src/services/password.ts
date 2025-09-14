import crypto from 'crypto';

export function generateStrongPassword(length = 16) {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghijkmnopqrstuvwxyz';
  const digits = '23456789';
  const symbols = '!@#$%^&*()-_=+[]{}';
  const all = upper + lower + digits + symbols;
  if (length < 8) length = 8;
  const picks = [
    upper[Math.floor(Math.random()*upper.length)],
    lower[Math.floor(Math.random()*lower.length)],
    digits[Math.floor(Math.random()*digits.length)],
    symbols[Math.floor(Math.random()*symbols.length)]
  ];
  for (let i = picks.length; i < length; i++) {
    const idx = crypto.randomInt(0, all.length);
    picks.push(all[idx]);
  }
  for (let i = picks.length -1; i > 0; i--) {
    const j = crypto.randomInt(0, i + 1);
    [picks[i], picks[j]] = [picks[j], picks[i]];
  }
  return picks.join('');
}
