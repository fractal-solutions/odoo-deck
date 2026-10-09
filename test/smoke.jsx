import { render } from 'ink-testing-library';
import React from 'react';
import App from '../src/App.jsx';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const { lastFrame, stdin, unmount } = render(<App onExit={() => {}} />);
await wait(1500);

function check(token, label) {
  const frame = lastFrame();
  if (!frame || !frame.includes(token)) {
    console.error(`SMOKE FAIL: expected '${token}' (${label})`);
    console.error((frame || '').slice(0, 1500));
    process.exit(1);
  }
}

check('ODOO-DECK', 'header');
check('Actions', 'home menu');
check('Sync module sources', 'first action visible');
check('Snapshot & clone database', 'same-version clone action visible');

// tabs work from every screen via 1/2/3
stdin.write('3');
await wait(300);
check('Settings', 'settings via 3');

stdin.write('2');
await wait(300);
check('Live log', 'logs via 2 from settings');

stdin.write('3');
await wait(300);
check('Settings', 'settings via 3 from logs');

stdin.write('1');
await wait(300);
check('Sync module sources', 'home via 1');

unmount();
console.log('SMOKE TEST OK');
