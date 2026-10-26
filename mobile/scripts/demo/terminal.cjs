function assertInteractive(input, output) {
  if (!input.isTTY || !output.isTTY || typeof input.setRawMode !== 'function')
    throw new Error('LOCAL_TERMINAL_REQUIRED');
}
function safeFailure(error, phase) {
  const codes = [
    'LOCAL_TERMINAL_REQUIRED',
    'INVALID_PASSWORD',
    'INVALID_INPUT',
    'CANCELLED',
    'CONFIRMATION_REQUIRED',
    'LAN_HOST_REQUIRED',
    'TEST_DATABASE_REQUIRED',
    'FOREIGN_DATA_REFUSED',
    'PARTIAL_FIXTURE_REFUSED',
    'TEST_DATABASE_BUSY',
    'FIXTURE_LAN_CHANGED',
    'SEED_REQUIRED',
  ];
  const candidate = codes.includes(error?.code) ? error.code : error?.message;
  const code = codes.includes(candidate) ? candidate : 'UNCLASSIFIED';
  return `Demo stopped safely [phase=${phase}; code=${code}]. Credentials suppressed.`;
}
module.exports = { assertInteractive, safeFailure };
