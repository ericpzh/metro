import { readFileSync } from 'node:fs';
const s = readFileSync('art/_probe-car.svg', 'utf8');
for (const m of s.matchAll(/<polygon points="([^"]+)"[^>]*fill="rgb\(34,50,65\)"/g)) {
  console.log('WINDOW', m[1]);
}
// also the livery
for (const m of s.matchAll(/<polygon points="([^"]+)"[^>]*fill="rgb\(46,120,229\)"/g)) {
  console.log('LIVERY', m[1]);
}
// door glass
for (const m of s.matchAll(/<polygon points="([^"]+)"[^>]*fill="rgb\(37,56,72\)"/g)) {
  console.log('DOOR', m[1]);
}
