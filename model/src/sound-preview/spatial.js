// World coordinates in metres; y is height in this standalone preview.
export const DEFAULT_MIX = {
 master: {enabled:true, volume:.55}, effects:{enabled:true, volume:.65},
 ambience:{enabled:true, volume:.7}, crowd:{enabled:true, volume:.55},
 train:{enabled:true, volume:.6}, traffic:{enabled:true, volume:.4},
};
export function sanitizeMix(value) {
 return Object.fromEntries(Object.entries(DEFAULT_MIX).map(([key, fallback]) => {
  const entry = value?.[key];
  return [key, {enabled:typeof entry?.enabled === 'boolean' ? entry.enabled : fallback.enabled,
   volume:Number.isFinite(entry?.volume) ? Math.max(0, Math.min(1, entry.volume)) : fallback.volume}];
 }));
}
export function spatialMix(listener, source, {reference=8, rolloff=1, radius=100}={}) {
 const dx=source.x-listener.x, dy=source.y-listener.y, dz=source.z-listener.z;
 const distance=Math.hypot(dx,dy,dz);
 const attenuation=reference/(reference+rolloff*(Math.max(distance,reference)-reference));
 // Fade the outer 20% to true silence (inverse distance alone never reaches zero).
 const fade=Math.max(0,Math.min(1,(radius-distance)/(radius*.2)));
 const right=dx*Math.cos(listener.bearing)-dz*Math.sin(listener.bearing);
 return {distance, gain:attenuation*fade, pan:distance ? Math.max(-1,Math.min(1,right/distance)) : 0};
}
