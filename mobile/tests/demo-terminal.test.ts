const { assertInteractive, safeFailure } = jest.requireActual('../scripts/demo/terminal.cjs');
test.each([
  [false, true],
  [true, false],
  [false, false],
])('rejects redirected stdin=%s stdout=%s without requesting a password', (input, output) => {
  expect(() =>
    assertInteractive({ isTTY: input, setRawMode: jest.fn() }, { isTTY: output }),
  ).toThrow('LOCAL_TERMINAL_REQUIRED');
});
test('requires native raw-mode support and accepts an interactive local terminal', () => {
  expect(() => assertInteractive({ isTTY: true }, { isTTY: true })).toThrow(
    'LOCAL_TERMINAL_REQUIRED',
  );
  expect(() =>
    assertInteractive({ isTTY: true, setRawMode: jest.fn() }, { isTTY: true }),
  ).not.toThrow();
});
test('safe diagnostics distinguish terminal, confirmation, invalid input and cancellation', () => {
  for (const code of [
    'LOCAL_TERMINAL_REQUIRED',
    'CONFIRMATION_REQUIRED',
    'INVALID_PASSWORD',
    'INVALID_INPUT',
    'CANCELLED',
  ])
    expect(safeFailure({ code }, 'password-input')).toContain(`code=${code}`);
});
test('safe diagnostics never echo arbitrary underlying errors or secret properties', () => {
  const result = safeFailure(
    { message: 'PRIVATE_CREDENTIAL_VALUE', code: 'PRIVATE_TOKEN', password: 'PRIVATE_PASSWORD' },
    'password-module-load',
  );
  expect(result).toContain('code=UNCLASSIFIED');
  expect(result).toContain('phase=password-module-load');
  expect(result).not.toContain('PRIVATE');
});
