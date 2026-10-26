class SafeReporter {
  passed = 0;
  failed = 0;
  onTestEnd(test, result) {
    const passed = result.status === test.expectedStatus;
    if (passed) this.passed++;
    else this.failed++;
    console.log(`${passed ? 'PASS' : 'FAIL'} ${test.title}`);
    if (!passed)
      for (const note of test.annotations)
        if (note.type === 'safe-diagnostic') console.log(`SUMMARY diagnostic ${note.description}`);
    if (!passed)
      for (const error of result.errors) {
        const frame = (error.stack ?? '').match(/mobile\.spec\.cjs:(\d+):\d+/);
        if (frame) console.log(`FAIL location mobile.spec.cjs:${frame[1]}`);
      }
  }
  onEnd(result) {
    console.log(
      `SUMMARY Chromium/PostgreSQL: ${result.status}; passed=${this.passed}; failed=${this.failed}`,
    );
  }
}
module.exports = SafeReporter;
