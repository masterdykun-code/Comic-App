// Do not serialize assertions, request bodies, tokens, DB errors or stack traces.
module.exports = async function* (events) {
  for await (const event of events) {
    if (event.type === 'test:pass') yield `PASS ${event.data.name}\n`;
    if (event.type === 'test:fail') {
      let error = event.data.details?.error;
      for (let i = 0; i < 3 && error?.cause; i++) error = error.cause;
      const safe = (value) => typeof value === 'number' || typeof value === 'boolean' || (typeof value === 'string' && /^[A-Z0-9_]{1,50}$/.test(value)) || (Array.isArray(value) && value.every((v) => typeof v === 'number')) ? value : undefined;
      const line = /[a-z.-]+\.test\.ts:(\d+):(\d+)/i.exec(error?.stack ?? '');
      yield `FAIL ${event.data.name} ${JSON.stringify({code:safe(error?.code),actual:safe(error?.actual),expected:safe(error?.expected),line:line?.[1]})}\n`;
    }
    if (event.type === 'test:summary' && event.data.file === undefined) yield `SUMMARY ${JSON.stringify(event.data.counts)}\n`;
  }
};
