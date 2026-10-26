class SafeReporter {
  passed = 0;
  failed = 0;
  skipped = 0;
  onTestEnd(test, result) {
    const passed = result.status === test.expectedStatus;
    const skipped = result.status === 'skipped';
    if (skipped) this.skipped++;
    else if (passed) this.passed++;
    else this.failed++;
    console.log(`${skipped ? 'SUMMARY SKIPPED' : passed ? 'PASS' : 'FAIL'} ${test.title}`);
    // Do not serialize Playwright call logs, response bodies, passwords, tokens or headers.
    if (!passed)
      for (const error of result.errors) {
        const source = error.location;
        if (source)
          console.log(`FAIL location ${require('node:path').basename(source.file)}:${source.line}`);
        else {
          const frames = (error.stack ?? '').match(/admin\.spec\.ts:\d+:\d+/g) ?? [];
          if (frames.length) console.log(`FAIL location ${frames[0]}`);
        }
      }
  }
  onEnd(result) {
    console.log(
      `SUMMARY Chromium integration: ${result.status}; passed=${this.passed}; failed=${this.failed}; skipped=${this.skipped}`,
    );
  }
}
module.exports = SafeReporter;
