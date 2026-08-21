import sharp from 'sharp'
import { readFileSync, writeFileSync } from 'fs'
const svg = readFileSync('public/favicon.svg')
for (const [size, out] of [[180,'public/apple-touch-icon.png'],[192,'public/icon-192.png'],[512,'public/icon-512.png'],[32,'public/favicon-32.png']]) {
  await sharp(svg, { density: 384 }).resize(size, size, { fit: 'contain', background: '#08090C' }).flatten({ background: '#08090C' }).png().toFile(out)
  console.log('wrote', out)
}
// .ico: a 32x32 PNG wrapped in an ICO container
const png = readFileSync('public/favicon-32.png')
const h = Buffer.alloc(22)
h.writeUInt16LE(0,0); h.writeUInt16LE(1,2); h.writeUInt16LE(1,4)
h.writeUInt8(32,6); h.writeUInt8(32,7); h.writeUInt8(0,8); h.writeUInt8(0,9)
h.writeUInt16LE(1,10); h.writeUInt16LE(32,12)
h.writeUInt32LE(png.length,14); h.writeUInt32LE(22,18)
writeFileSync('public/favicon.ico', Buffer.concat([h, png]))
console.log('wrote public/favicon.ico')
