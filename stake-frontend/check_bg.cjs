const Jimp = require('jimp');

async function main() {
  const images = ['safe.png', 'master_key.png', 'empty.png'];
  for (const imgName of images) {
    try {
      const imgPath = `public/assets/symbols/${imgName}`;
      const image = await Jimp.read(imgPath);
      const color = image.getPixelColor(0, 0);
      const rgba = Jimp.intToRGBA(color);
      console.log(`${imgName} dimensions: ${image.bitmap.width}x${image.bitmap.height}`);
      console.log(`${imgName} top-left pixel:`, rgba);
    } catch (e) {
      console.error(`Error processing ${imgName}:`, e.message);
    }
  }
}

main();
