import { readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { passengerIsChild } from '../game/src/sim/walking.ts';

let cards;
/** Adjacent figure identities should not select adjacent colour/bag recipes. */
export function passengerArtIndex(identity, count) {
  let hash=Math.imul(Math.round(identity)^0x51ed270b,0x85ebca6b)>>>0;
  hash=Math.imul(hash^(hash>>>16),0xc2b2ae35)>>>0;
  return ((hash^(hash>>>16))>>>0)%count;
}
function load() {
  if (cards) return cards;
  const dir = resolve(process.env.PASSENGER_CARDS_DIR ?? resolve(import.meta.dirname, '../.preview/passenger-cards'));
  try {
    cards = JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map(p => ({ ...p,
      href: `data:image/png;base64,${readFileSync(join(dir, p.file)).toString('base64')}` }));
  } catch (error) {
    throw new Error(`capture humans first: node tools/render-passenger-cards.mjs (${error.message})`);
  }
  return cards;
}

/** A real human at metre scale, anchored on its feet (or floor origin in plan). */
export function passengerImage(view, x, y, pixelsPerMetre, variant = 0, walking, scale = 1, heading) {
  const age=passengerIsChild(Math.round(variant))?'child':'adult';
  const matches = load().filter(p => p.view === view && (p.age??'adult')===age && (walking === undefined || p.walking === walking));
  if(!matches.length)throw new Error(`capture ${age} humans first: npm run art:models`);
  const p = matches[passengerArtIndex(variant,matches.length)];
  const s = pixelsPerMetre / p.pixelsPerMetre * scale;
  // A plan camera looks straight down: rotating around the floor origin is an
  // exact heading change, retaining the captured stride and appearance.
  const turn = view === 'plan' && heading !== undefined
    ? ` transform="rotate(${(p.heading - heading) * 180 / Math.PI} ${x} ${y})"` : '';
  return `<image data-age="${age}" data-variant="${p.model}" data-model="passenger-human" data-pose="${p.walking ? 'walk' : 'idle'}" x="${x - p.origin[0] * s}" y="${y - p.origin[1] * s}" width="${p.width * s}" height="${p.height * s}" href="${p.href}"${turn}/>`;
}

export function passengerSpriteCount() { return load().filter(p => p.view === 'iso').length; }

/** Preserve every sprite ID/transform while embedding identical bitmap nodes once. */
export function passengerSpriteDefinitions(images) {
  const first = new Map();
  return images.map((image, i) => {
    if(first.has(image))return `<g id="human-${i}"><use href="#human-${first.get(image)}"/></g>`;
    first.set(image,i);return `<g id="human-${i}">${image}</g>`;
  }).join('');
}

/** Keep only referenced static sprites, including dependencies of aliases. */
export function prunePassengerSprites(svg) {
  const definitions=new Map();
  const body=svg.replace(/<g id="(human-\d+)">[\s\S]*?<\/g>/g,(node,id)=>{definitions.set(id,node);return ''});
  const used=new Set(),pending=[...body.matchAll(/href="#(human-\d+)"/g)].map(m=>m[1]);
  while(pending.length){const id=pending.pop();if(used.has(id))continue;used.add(id);for(const m of (definitions.get(id)??'').matchAll(/href="#(human-\d+)"/g))pending.push(m[1]);}
  return svg.replace(/<g id="(human-\d+)">[\s\S]*?<\/g>/g,(node,id)=>used.has(id)?node:'');
}

export function passengerSprites() {
  const isoScale = Math.sqrt(30 * 30 + (30 / Math.sqrt(3)) ** 2) / Math.sqrt(2 / 3);
  return passengerSpriteDefinitions(Array.from({ length: passengerSpriteCount() }, (_, i) => passengerImage('iso', 0, 0, isoScale, i)))
    + `<g id="person">${passengerImage('iso', 0, 0, isoScale, 0, true)}</g>`
    + `<g id="personBag"><use href="#human-${7 % passengerSpriteCount()}"/></g>`
    + `<g id="personSeat"><use href="#human-${14 % passengerSpriteCount()}"/></g>`;
}

let walkingCards;
/** Heading in the capture camera, rather than the drawing's world axes. */
export function walkingHeading(view, dx, dy, pixelsPerX, pixelsPerY) {
  // P(x,y) projects +X to screen-right/down. The capture camera at (+1,+1,+1)
  // projects +X to screen-left/down and +Y to screen-right/down: swap X and Y.
  return view === 'iso' ? Math.atan2(dy / pixelsPerY + dx / pixelsPerX, dy / pixelsPerY - dx / pixelsPerX)
    : dx >= 0 ? 0 : Math.PI;
}

function loadWalking() {
  if (!walkingCards) {
    const dir = resolve(process.env.PASSENGER_CARDS_DIR ?? resolve(import.meta.dirname, '../.preview/passenger-cards'));
    walkingCards = JSON.parse(readFileSync(join(dir, 'walking-index.json'), 'utf8')).map(p => ({ ...p,
      href: `data:image/png;base64,${readFileSync(join(dir, p.file)).toString('base64')}` }));
  }
  return walkingCards;
}

const usedFrames = new Map();
/** Only embed frames used by this sheet, once per appearance and heading. */
export function walkingDefinitions() {
  const definitions = [...usedFrames.values()].join('');
  usedFrames.clear();
  return definitions ? PASSENGER_WALK_CSS + definitions : '';
}

/** Frame-by-frame gait inside a path mover. CSS keeps animating in an SVG image. */
export function walkingPlanSprite(id, identity, heading, speedMetresPerSecond) {
  return walkingSprite('plan', id, identity, heading, speedMetresPerSecond, 31);
}

export function walkingSprite(view, id, identity, heading, speedMetresPerSecond, pixelsPerMetre) {
  const age=passengerIsChild(identity)?'child':'adult';
  const cards = loadWalking().filter(p => p.view === view && (p.age??'adult')===age);
  if(!cards.length)throw new Error(`capture ${age} walking humans first: npm run art:models`);
  const variants = [...new Set(cards.map(p => p.variant))];
  const variant = variants[passengerArtIndex(identity,variants.length)];
  const headings = [...new Set(cards.map(p => p.heading))];
  const delta = a => Math.abs(Math.atan2(Math.sin(a - heading), Math.cos(a - heading)));
  const capturedHeading = headings.reduce((a, b) => delta(a) <= delta(b) ? a : b);
  const frames = cards.filter(p => p.variant === variant && p.heading === capturedHeading);
  if (!(speedMetresPerSecond > 0) || !frames.length) throw new Error('walking sprite needs captured frames and positive speed');
  const duration = frames[0].stride / speedMetresPerSecond;
  const turn = view === 'plan' ? ` rotate(${-heading * 180 / Math.PI})` : '';
  return `<g id="${id}" data-age="${age}" data-variant="${frames[0].model}" data-pose="animated-walk" data-view="${view}" data-heading="${capturedHeading}" transform="scale(${pixelsPerMetre})${turn}">`
    + frames.map((p, i) => {
      const frameId = `passenger-cycle-${age}-${view}-${p.variant}-${headings.indexOf(capturedHeading)}-${p.sample}`;
      const s = 1 / p.pixelsPerMetre;
      usedFrames.set(frameId, `<image id="${frameId}" x="${-p.origin[0] * s}" y="${-p.origin[1] * s}" width="${p.width * s}" height="${p.height * s}" href="${p.href}"/>`);
      const delay = -(((frames.length - i) % frames.length) / frames.length + identity * .17) * duration;
      return `<g class="passenger-stride" style="animation-duration:${duration}s;animation-delay:${delay}s"><use href="#${frameId}"/></g>`;
    }).join('') + '</g>';
}

export const PASSENGER_WALK_CSS = `<style>
@keyframes passenger-stride {0%{opacity:1}4.166667%,100%{opacity:0}}
.passenger-stride{opacity:0;animation:passenger-stride 1s steps(1,end) infinite}
</style>`;
