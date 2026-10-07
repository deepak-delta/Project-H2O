/** Six random digits, avoiding repeats like 111111 and runs like 123456. */
export function randomPin(): string {
  for (;;) {
    const digits = Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => String(b % 10)).join('');
    const sequential = '0123456789012345'.includes(digits) || '9876543210987654'.includes(digits);
    if (new Set(digits).size > 2 && !sequential) return digits;
  }
}
