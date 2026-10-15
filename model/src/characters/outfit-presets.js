// Shared greyscale clothing presets for the viewer and reviewed game catalogue.
const preset=(id,shape,extra={})=>({id,shape,top:'#bdbdbd',bottom:'#7a7a7a',...extra});
export const OUTFITS={
 female:[
  preset('long-a-line','a-line'),
  preset('slim-long-skirt','a-line',{flare:.045,topFit:.96,sleeveFit:.88,top:'#7a7a7a',bottom:'#bdbdbd'}),
  preset('long-pleated','pleated',{flare:.09,pleat:.014}),
  preset('full-pleated','pleated',{flare:.15,pleat:.020,topFit:.97,top:'#858585',bottom:'#c4c4c4'}),
  preset('midi-a-line','a-line',{hem:.27,flare:.075,topHem:.85}),
  preset('midi-pleated','pleated',{hem:.27,flare:.12,pleat:.018,topHem:.85,top:'#8c8c8c',bottom:'#b5b5b5'}),
  preset('straight-trousers','trousers',{legFit:1}),
  preset('tapered-trousers','trousers',{legFit:.84,sleeveFit:.88,topFit:.97,top:'#7a7a7a',bottom:'#bdbdbd'}),
  preset('wide-trousers','trousers',{legFit:1.20,topFit:.97,topHem:.85}),
  preset('relaxed-trousers','trousers',{legFit:1.10,topFit:1.055,topHem:.805,top:'#858585',bottom:'#c4c4c4'}),
 ],
 male:[
  preset('crew-straight','trousers'),
  preset('crew-tapered','trousers',{legFit:.84}),
  preset('fitted-straight','trousers',{topFit:.955,sleeveFit:.86}),
  preset('fitted-tapered','trousers',{topFit:.955,sleeveFit:.86,legFit:.84}),
  preset('relaxed-straight','trousers',{topFit:1.055,topHem:.805}),
  preset('relaxed-wide','trousers',{topFit:1.055,topHem:.805,legFit:1.20}),
  preset('short-straight','trousers',{topHem:.85,topFit:1.025}),
  preset('short-wide','trousers',{topHem:.85,topFit:1.025,legFit:1.20}),
  preset('long-tapered','trousers',{topHem:.79,legFit:.88,sleeveFit:.90}),
  preset('long-relaxed','trousers',{topHem:.79,topFit:1.035,legFit:1.12}),
 ].map((outfit,index)=>({...outfit,top:index%2?'#878787':'#a8a8a8',bottom:index%2?'#bdbdbd':'#787878'})),
};
export const outfitFor=(character,id)=>OUTFITS[character]?.find(outfit=>outfit.id===id);
