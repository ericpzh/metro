import * as THREE from 'three'
import asset from '../assets/passenger-activities.json' with { type: 'json' }
import { decodePassengerBytes } from './passengerAtlas.ts'

/** Shared bind geometry and bone palettes; no live passenger skeletons. */
const read = (value: string) => decodePassengerBytes(value, asset.encoding)
const matrices = new Float32Array(read(asset.matrices).buffer)
export const PASSENGER_ACTIVITY_GARMENTS = asset.library.map(m => [m.hem,m.waist] as const)
let textures: THREE.DataTexture[] | undefined
function texture(values: Float32Array | Uint32Array): THREE.DataTexture {
  const height = Math.ceil(values.length / (1024 * 4)), pixels = new Float32Array(1024 * height * 4)
  pixels.set(values)
  const tex = new THREE.DataTexture(pixels, 1024, height, THREE.RGBAFormat, THREE.FloatType)
  tex.needsUpdate = true
  return tex
}
export function disposePassengerActivities(): void { textures?.forEach(t => t.dispose()); textures = undefined }

/** Camera and picking follow the same seated pelvis as the GPU palette. */
export function passengerActivityOffset(kind: number, time: number, height: number, out: number[]): number[] {
  out[0]=0;out[1]=0;out[2]=0
  if (kind!==1 && kind!==9) return out
  const fit=Math.max(0,Math.min(asset.fits.length-1,(height-.5)*10)),lo=Math.floor(fit),hi=Math.min(asset.fits.length-1,lo+1)
  const frame=Math.max(0,Math.min(asset.samples-1,time/asset.durations[kind]*(asset.samples-1))),a=Math.floor(frame),b=Math.min(asset.samples-1,a+1)
  const index=(f:number,t:number)=>(((f*(asset.activities.length+3)+kind)*asset.samples+t)*asset.boneCount)*16+12
  for(let axis=0;axis<3;axis++) {
    const lower=matrices[index(lo,a)+axis]*(1-(frame-a))+matrices[index(lo,b)+axis]*(frame-a)
    const upper=matrices[index(hi,a)+axis]*(1-(frame-a))+matrices[index(hi,b)+axis]*(frame-a)
    out[axis]=lower*(1-(fit-lo))+upper*(fit-lo)
  }
  return out
}

export function activityShader(detail: 'full' | 'low'): { uniforms: Record<string, { value: THREE.DataTexture }>; source: string } {
  if (!textures) textures = [texture(new Float32Array(read(asset.data).buffer)), texture(matrices)]
  const stride = detail === 'full' ? asset.corners : asset.lowCorners
  const index = detail === 'full' ? 2 : 3
  const indexTex = textures[index] ??= texture(new Uint32Array(read(detail === 'full' ? asset.indices : asset.lowIndices).buffer))
  const texel = (name: string, rows: number) => `vec4 ${name}At(float pixel) { return texture2D(${name}, vec2((mod(pixel,1024.0)+.5)/1024.0,(floor(pixel/1024.0)+.5)/${rows.toFixed(1)})); }`
  return {
    uniforms: { activityData: { value: textures[0] }, activityMatrices: { value: textures[1] }, activityIndices: { value: indexTex } },
    source: `
      attribute vec4 passengerActivity;
      attribute vec2 passengerGarment;
      uniform sampler2D activityData;
      uniform sampler2D activityMatrices;
      uniform sampler2D activityIndices;
      bool passengerUsesActivityRig() { return passengerActivity.x>.5 && passengerActivity.x!=12.0 && passengerActivity.x!=13.0; }
      ${texel('activityData', textures[0].image.height)}
      ${texel('activityMatrices', textures[1].image.height)}
      ${texel('activityIndices', indexTex.image.height)}
      float activityVertex() {
        float corner = passengerOutfit * ${stride.toFixed(1)} + (passengerVertex < ${stride.toFixed(1)} ? passengerVertex : 0.0);
        vec4 packed = activityIndicesAt(floor(corner / 4.0));
        return packed[int(mod(corner,4.0))];
      }
      mat4 activityMatrix(float rig, float action, float frame, float bone) {
        float a=floor(frame), b=min(a+1.0,${(asset.samples-1).toFixed(1)}), blend=fract(frame);
        if(action>=${asset.activities.length.toFixed(1)}) b=mod(a+1.0,${asset.samples.toFixed(1)});
        float start=(rig*${(asset.activities.length+3).toFixed(1)}+action)*${(asset.samples*asset.boneCount*4).toFixed(1)}+bone*4.0;
        float px=start+a*${(asset.boneCount*4).toFixed(1)}, py=start+b*${(asset.boneCount*4).toFixed(1)};
        return mat4(mix(activityMatricesAt(px),activityMatricesAt(py),blend),
          mix(activityMatricesAt(px+1.0),activityMatricesAt(py+1.0),blend),
          mix(activityMatricesAt(px+2.0),activityMatricesAt(py+2.0),blend),
          mix(activityMatricesAt(px+3.0),activityMatricesAt(py+3.0),blend));
      }
      mat4 activityBone(float rig, float bone) {
        float action = passengerActivity.x;
        float phase = passengerActivity.y / ${Math.max(...asset.durations).toFixed(1)};
        ${asset.durations.map((d, i) => `if (abs(action-${i.toFixed(1)})<.1) phase=passengerActivity.y/${d.toFixed(1)};`).join('\n')}
        float frame = clamp(phase,0.0,1.0)*${(asset.samples - 1).toFixed(1)};
        // Gate and door gestures leave locomotion on the travel-driven walk.
        bool arms = (bone>=7.0&&bone<=9.0)||bone>=13.0;
        if ((action==5.0||action==6.0||action==11.0)&&!arms) {
          action=${asset.activities.length.toFixed(1)}+passengerActivity.w;
          frame=mod(passengerActivity.z,1.0)*${asset.samples.toFixed(1)};
        }
        float height=length(instanceMatrix[2].xyz);
        float fit=clamp((height-.5)*10.0,0.0,${(asset.fits.length-1).toFixed(1)});
        float lower=rig*${asset.fits.length.toFixed(1)}+floor(fit), upper=rig*${asset.fits.length.toFixed(1)}+min(floor(fit)+1.0,${(asset.fits.length-1).toFixed(1)});
        return activityMatrix(lower,action,frame,bone)*(1.0-fract(fit))+activityMatrix(upper,action,frame,bone)*fract(fit);
      }
      vec3 activityPosition(bool normal) {
        float vertex=activityVertex()*4.0;
        vec4 bind=activityDataAt(vertex), weights=activityDataAt(vertex+2.0), bones=activityDataAt(vertex+3.0);
        vec4 source=normal ? vec4(activityDataAt(vertex+1.0).xyz,0.0) : vec4(bind.xyz,1.0);
        // Authored seated drape: the hip-weighted skirt bends across the lap,
        // rounds the knees and falls along the shins. Feet keep their own rig.
        if(passengerGarment.x>0.0&&(passengerActivity.x==1.0||passengerActivity.x==9.0)) {
          float hip=0.0;for(int i=0;i<4;i++)if(bones[i]<.5)hip+=weights[i];
          if(hip>.99&&bind.y<=passengerGarment.y+.001) {
            float duration=10.0, t=passengerActivity.y;
            float settle=smoothstep(1.0,2.5,t)*(1.0-smoothstep(duration-2.0,duration-1.0,t));
            float d=max(0.0,passengerGarment.y-bind.y);
            float bend=1.5707963*smoothstep(.04,.18,d)*(1.0-smoothstep(.34,.46,d));
            if(normal) {
              vec3 n=vec3(source.x,source.y*cos(bend)+source.z*sin(bend)*2.0,-source.y*sin(bend)+source.z*cos(bend));
              source.xyz=normalize(mix(source.xyz,n,settle));
            } else {
              float depth=bind.z-.035;
              vec3 drape=vec3(bind.x,passengerGarment.y+.12*smoothstep(0.0,.18,d)-max(0.0,d-.34)+depth*.5*sin(bend),
                .035+.34*smoothstep(0.0,.34,d)+depth*cos(bend));
              source.xyz=mix(bind.xyz,drape,settle);
            }
          }
        }
        vec3 p=vec3(0.0);
        for(int i=0;i<4;i++) if(weights[i]>.00001) p+=(activityBone(bind.w,bones[i])*source).xyz*weights[i];
        return vec3(p.z,p.x,p.y);
      }
      float activityRegion() { return activityDataAt(activityVertex()*4.0+1.0).w; }
    `,
  }
}
