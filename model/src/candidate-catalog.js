const rocketSource='https://github.com/microsoft/Microsoft-Rocketbox';
const validSource='https://github.com/google/valid-avatar-library';
export const CANDIDATES=[
 ...['F','M'].flatMap(sex=>[1,2,3].map(number=>({
  id:`valid-Asian_${sex}_${number}_Casual`,
  name:[`VALID · ${sex==='F'?'woman':'man'} ${number} · casual`,`VALID · ${sex==='F'?'女性':'男性'} ${number} · 便装`],
  age:'adult',neckline:sex==='F'&&number===1?'v':'crew',kind:'gltf',file:`human-candidates/valid/Asian_${sex}_${number}_Casual.glb`,source:validSource,
  description:['MIT · Source-labeled East Asian adult base. One casual outfit per distinct base; rig retained, station animations pending.','MIT · 来源标注的东亚成人基础角色。每个独立基础角色仅选一套便装；保留骨架，车站动作待适配。'],
 }))),
 ...[
  ['Female_Adult_03','Woman · purple top','女性 · 紫色上衣'],
  ['Female_Adult_11','Woman · sweater and skirt','女性 · 毛衣与裙装'],
  ['Male_Adult_09','Man · black T-shirt','男性 · 黑色 T 恤'],
  ['Business_Male_02','Man · blue suit','男性 · 蓝色西装'],
 ].map(([name,en,zh])=>({id:`rocketbox-${name}`,name:[en,zh],age:'adult',file:`human-candidates/rocketbox/${name}/${name}.fbx`,kind:'rocketbox',source:rocketSource,description:['MIT · Rocketbox visual selection for East Asian appearance. Rig retained; station animations pending.','MIT · 根据东亚外观挑选的 Rocketbox 角色。保留骨架；车站动作待适配。']})),
 ...[
  ['girl-01','Girl · younger · casual','女孩 · 低龄 · 便装',1.18],
  ['girl-02','Girl · older · casual','女孩 · 较年长 · 便装',1.42],
  ['boy-01','Boy · younger · casual','男孩 · 低龄 · 便装',1.22],
  ['boy-02','Boy · older · casual','男孩 · 较年长 · 便装',1.46],
 ].map(([id,en,zh,height])=>({id:`mpfb-${id}`,name:[`Generated · ${en}`,`生成 · ${zh}`],age:'child',height,kind:'gltf',file:`human-candidates/generated/${id}.glb`,source:'https://github.com/makehumancommunity/mpfb2',description:['CC0 · Generated MPFB East Asian child candidate with fitted clothing. Authored age/body targets; visual review pending.','CC0 · 使用 MPFB 生成并适配服装的东亚儿童候选。使用年龄及体型参数；待外观审核。']})),
 {
  id:'human-fall-flat-character-base',
  name:['Human Fall Flat character base','Human Fall Flat character base'],
  age:'adult',
  height:1.5,
  kind:'rocketbox',
  file:'human-candidates/human-fall-flat/HumanBody_Alt.fbx',
  source:'https://models.spriters-resource.com/pc_computer/humanfallflat/asset/340298',
  studies:false,
  description:['Extracted Human Fall Flat playable character base (Spriters Resource). Rig retained; station animations pending. FBX cleaned-up variant.','Extracted Human Fall Flat playable character base (Spriters Resource).'],
 },
];
