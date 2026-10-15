import {fileURLToPath} from 'node:url';
import {exportClothingVariants} from './export-clothing-variants.mjs';
import {writeAsset} from './write-asset.mjs';
const outputDirectory=new URL('../../.preview/model-outfits/glb/',import.meta.url);
const manifest=await exportClothingVariants({outputDirectory});
await writeAsset(new URL('manifest.json',outputDirectory),JSON.stringify(manifest,null,2)+'\n');
console.log(`${manifest.models.length} reviewed clothing GLBs: ${fileURLToPath(outputDirectory)}`);
