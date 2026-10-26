import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertTestUrl, demoAddress } from '../src/scripts/epub-demo';

test('EPUB demo refuses main/remote databases and custom schema', () => {
  for (const u of ['postgresql://test@localhost/webnovel_db?schema=public','postgresql://test@example.com/webnovel_test_db','postgresql://test@localhost/webnovel_test_db?schema=private']) assert.throws(()=>assertTestUrl(u));
  assert.doesNotThrow(()=>assertTestUrl('postgresql://test@localhost/webnovel_test_db?schema=public'));
});
test('EPUB demo only serves private IPv4 with a separate port', () => {
  for (const u of ['http://0.0.0.0:4001','http://8.8.8.8:4001','http://192.168.0.5:4000','https://192.168.0.5:4001','http://test:password@192.168.0.5:4001','http://192.168.0.5:4001/api']) assert.throws(()=>demoAddress(u));
  assert.equal(demoAddress('http://192.168.0.5:4001').origin,'http://192.168.0.5:4001');
});
