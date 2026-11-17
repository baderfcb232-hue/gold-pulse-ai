import test from 'node:test';
import assert from 'node:assert/strict';
import {trustedBrowserOrigin} from '../trusted-browser-origin.mjs';

test('NABD accepts official domain and Render origin for auth POST requests',()=>{
  for (const origin of [
    'https://nabdtrading.com',
    'https://www.nabdtrading.com',
    'https://gold-pulse-ai.onrender.com'
  ]) assert.equal(trustedBrowserOrigin(origin,'https://nabdtrading.com'),true,origin);
  assert.equal(trustedBrowserOrigin('https://nabd.example','https://nabd.example'),true);
});

test('origin policy rejects untrusted subdomains, scheme downgrade, paths and missing origin',()=>{
  const configured='https://nabdtrading.com';
  for(const origin of [
    undefined, '', 'null', 'http://nabdtrading.com',
    'https://nabdtrading.com.evil.example',
    'https://evil-nabdtrading.com',
    'https://evil.example', 'https://nabdtrading.com/auth',
    'https://nabdtrading.com@evil.example','https://nabdtrading.com?next=evil',
    'https://gold-pulse-ai.onrender.com.evil.example'
  ])assert.equal(trustedBrowserOrigin(origin,configured),false,String(origin));
});
