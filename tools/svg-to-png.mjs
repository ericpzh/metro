import sharp from 'sharp';
import { readdir } from 'fs/promises';
import { join, extname, basename } from 'path';

const artDir = 'C:\\Users\\ericp\\Desktop\\metro\\art';
const pngDir = 'C:\\Users\\ericp\\Desktop\\metro\\png';

const files = await readdir(artDir);
// A train refresh should not rewrite unrelated sheets' print exports.
const wanted = process.argv.slice(2).map(id => id.padStart(2, '0'));
const svgFiles = files.filter(f => extname(f).toLowerCase() === '.svg'
  && (!wanted.length || wanted.some(id => f.startsWith(`${id}-`))));
if (wanted.length && !svgFiles.length) throw new Error('No SVG sheets match the requested numbers');

console.log(`Found ${svgFiles.length} SVG files`);

for (const file of svgFiles) {
  const inputPath = join(artDir, file);
  const outputName = basename(file, '.svg') + '.png';
  const outputPath = join(pngDir, outputName);

  try {
    await sharp(inputPath, { density: 300 })
      .png()
      .toFile(outputPath);
    console.log(`✓ ${file} → ${outputName}`);
  } catch (err) {
    console.error(`✗ ${file}: ${err.message}`);
    process.exitCode = 1;
  }
}

console.log('Done!');
